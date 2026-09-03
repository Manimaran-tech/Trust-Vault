"""
AI Agent Orchestrator — manages the full multi-agent evaluation pipeline.

Dispatches transactions to expert agents, collects verdicts, runs consensus,
applies governance (with real spend totals), triggers watchdog, and persists
an immutable (hash-chained) audit trail.
"""
import asyncio
import hashlib
import time
import logging
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.agents import (
    IdentityAgent, FraudAgent, RiskAgent,
    ComplianceAgent, PolicyAgent, ExplainabilityAgent,
    GraphRiskAgent,
)
from app.consensus import compute_consensus
from app.governance import run_governance_checks
from app.watchdog import analyze_verdicts
from app.models.transaction import Transaction
from app.models.decision import Decision
from app.models.agent_verdict import AgentVerdict
from app.models.audit_log import AuditLog
from app.models.watchdog_alert import WatchdogAlert

logger = logging.getLogger(__name__)

# Instantiate expert agents
identity_agent = IdentityAgent()
fraud_agent = FraudAgent()
risk_agent = RiskAgent()
compliance_agent = ComplianceAgent()
policy_agent = PolicyAgent()
explainability_agent = ExplainabilityAgent()
graph_risk_agent = GraphRiskAgent()

CORE_AGENTS = [identity_agent, fraud_agent, risk_agent, compliance_agent, policy_agent, graph_risk_agent]

# In-memory tracker for latest audit hash per transaction (for chain continuity)
_last_audit_hash: dict[str, str] = {}


async def process_transaction(transaction_dict: dict, db: AsyncSession) -> dict:
    """
    Full multi-agent evaluation pipeline for a transaction.

    Pipeline:
    1. Dispatch to 5 core expert agents in parallel
    2. Run explainability agent with all verdicts
    3. Compute consensus decision
    4. Query real spend totals and run governance checks
    5. Analyze with watchdog
    6. Persist everything to database (with hash-chained audit)
    7. Return complete result

    Returns the full decision result dict.
    """
    pipeline_start = time.time()
    transaction_id = transaction_dict.get("id", "unknown")

    logger.info(f"[Orchestrator] Starting pipeline for transaction {transaction_id[:8]}")

    # --- Step 1: Log transaction received ---
    await _log_audit(db, transaction_id, "transaction_received", {
        "amount": str(transaction_dict.get("amount")),
        "type": transaction_dict.get("transaction_type"),
        "merchant": transaction_dict.get("merchant_name"),
    }, "Transaction received and queued for multi-agent evaluation")

    # --- Step 2: Dispatch to core agents in parallel ---
    from app.ws_manager import ws_manager
    logger.info(f"[Orchestrator] Dispatching to {len(CORE_AGENTS)} core agents")
    
    async def run_agent_with_broadcast(agent, tx):
        await ws_manager.broadcast({
            "type": "expert_started",
            "data": {
                "transaction_id": transaction_id,
                "agent": agent.name,
                "quorum": "governance",
            }
        })
        res = await agent.evaluate(tx)
        await ws_manager.broadcast({
            "type": "expert_finished",
            "data": {
                "transaction_id": transaction_id,
                "agent": agent.name,
                "quorum": "governance",
                "decision": res.get("decision", "error"),
                "confidence": res.get("confidence", 0.0),
                "mode": res.get("evaluation_mode"),
            }
        })
        return res

    core_verdicts = await asyncio.gather(
        *[run_agent_with_broadcast(agent, transaction_dict) for agent in CORE_AGENTS],
        return_exceptions=True,
    )

    # Handle any exceptions
    valid_verdicts = []
    for i, verdict in enumerate(core_verdicts):
        if isinstance(verdict, Exception):
            logger.error(f"Agent {CORE_AGENTS[i].name} failed: {verdict}")
            valid_verdicts.append({
                "agent_name": CORE_AGENTS[i].name,
                "decision": "review",
                "confidence": 0.3,
                "reasoning": f"Agent evaluation failed: {str(verdict)}",
                "risk_flags": ["agent_failure"],
                "processing_time_ms": 0,
                "raw_response": str(verdict),
            })
        else:
            valid_verdicts.append(verdict)

    # Log each agent's verdict
    for verdict in valid_verdicts:
        await _log_audit(db, transaction_id, "agent_evaluation", {
            "agent": verdict["agent_name"],
            "decision": verdict["decision"],
            "confidence": verdict["confidence"],
            "risk_flags": verdict.get("risk_flags", []),
        }, f"{verdict['agent_name']} agent: {verdict['decision']} ({verdict['confidence']:.0%})",
        agent_name=verdict["agent_name"])

    # --- Step 3: Run explainability agent with all prior verdicts ---
    logger.info(f"[Orchestrator] Running explainability synthesis")
    explainability_verdict = await explainability_agent.evaluate(transaction_dict, valid_verdicts)
    all_verdicts = valid_verdicts + [explainability_verdict]

    await _log_audit(db, transaction_id, "explainability_synthesis", {
        "summary_length": len(explainability_verdict["reasoning"]),
    }, "Explainability agent synthesized comprehensive assessment",
    agent_name="explainability")

    # --- Step 4: Compute consensus ---
    logger.info(f"[Orchestrator] Computing consensus decision")
    consensus = compute_consensus(all_verdicts)

    await _log_audit(db, transaction_id, "consensus_reached", {
        "decision": consensus["final_decision"],
        "confidence": consensus["aggregated_confidence"],
        "dissenters": len(consensus["dissenting_opinions"]),
    }, f"Consensus: {consensus['final_decision']} ({consensus['aggregated_confidence']:.0%})",
    severity="warning" if consensus["final_decision"] != "approve" else "info")

    # --- Step 5: Run governance checks with REAL spend totals ---
    logger.info(f"[Orchestrator] Running governance checks")

    # Query actual daily and monthly spend from the database
    daily_spend, monthly_spend = await _get_user_spend_totals(
        db, transaction_dict.get("user_id", "")
    )

    governance = run_governance_checks(
        transaction_dict,
        consensus["final_decision"],
        daily_spend=float(daily_spend),
        monthly_spend=float(monthly_spend),
    )

    # Governance can override the consensus decision
    final_decision = governance.get("overridden_decision") or consensus["final_decision"]
    requires_human = governance.get("requires_human_approval", False)

    # Escalation to human review only happens on ambiguous cases (not on explicit AI DENY)
    if requires_human and final_decision != "deny":
        final_decision = "pending_human_review"
    elif final_decision == "deny":
        requires_human = False

    if governance.get("overridden_decision"):
        await _log_audit(db, transaction_id, "governance_override", {
            "original": consensus["final_decision"],
            "overridden_to": governance["overridden_decision"],
            "reason": governance.get("escalation_reason"),
        }, f"Governance overrode consensus from {consensus['final_decision']} to {governance['overridden_decision']}",
        severity="critical")

    await _log_audit(db, transaction_id, "governance_check", {
        "passed": governance["passed"],
        "checks_count": len(governance["checks"]),
        "requires_human": requires_human,
        "daily_spend": float(daily_spend),
        "monthly_spend": float(monthly_spend),
    }, f"Governance: {'PASSED' if governance['passed'] else 'FAILED'}, "
       f"Human approval: {'required' if requires_human else 'not required'}")

    # --- Step 6: Watchdog analysis ---
    watchdog_alerts = analyze_verdicts(all_verdicts, final_decision)

    for alert in watchdog_alerts:
        watchdog_record = WatchdogAlert(
            alert_type=alert["alert_type"],
            severity=alert["severity"],
            agent_name=alert.get("agent_name"),
            description=alert["description"],
            details=alert.get("details", {}),
            anomaly_score=alert.get("anomaly_score"),
        )
        db.add(watchdog_record)

        await _log_audit(db, transaction_id, "watchdog_alert", {
            "alert_type": alert["alert_type"],
            "severity": alert["severity"],
            "agent": alert.get("agent_name"),
        }, f"Watchdog: {alert['description']}",
        severity="warning" if alert["severity"] in ("low", "medium") else "critical")

    # --- Step 7: Persist decision and verdicts ---
    pipeline_time = (time.time() - pipeline_start) * 1000

    decision_record = Decision(
        transaction_id=transaction_id,
        final_decision=final_decision,
        aggregated_confidence=consensus["aggregated_confidence"],
        voting_breakdown=consensus["voting_breakdown"],
        dissenting_opinions=consensus["dissenting_opinions"],
        governance_result={
            "passed": governance["passed"],
            "checks": governance["checks"],
            "requires_human": requires_human,
            "escalation_reason": governance.get("escalation_reason"),
        },
        explainability_summary=explainability_verdict["reasoning"],
        requires_human_approval=requires_human,
        processing_time_ms=round(pipeline_time, 2),
    )
    db.add(decision_record)
    await db.flush()
    await db.refresh(decision_record)

    # Persist individual agent verdicts
    for verdict in all_verdicts:
        verdict_record = AgentVerdict(
            decision_id=decision_record.id,
            agent_name=verdict["agent_name"],
            decision=verdict["decision"],
            confidence=verdict["confidence"],
            reasoning=verdict["reasoning"],
            risk_flags=verdict.get("risk_flags", []),
            raw_llm_response=verdict.get("raw_response", ""),
            processing_time_ms=verdict.get("processing_time_ms", 0),
        )
        db.add(verdict_record)

    # Update transaction status
    result = await db.execute(
        select(Transaction).where(Transaction.id == transaction_id)
    )
    tx_record = result.scalar_one_or_none()
    if tx_record:
        if final_decision == "pending_human_review":
            tx_record.status = "pending_human_review"
        else:
            tx_record.status = final_decision if final_decision != "review" else "escalated"
        tx_record.processed_at = datetime.now(timezone.utc)

    await _log_audit(db, transaction_id, "decision_final", {
        "final_decision": final_decision,
        "confidence": consensus["aggregated_confidence"],
        "processing_time_ms": round(pipeline_time, 2),
        "requires_human": requires_human,
        "watchdog_alerts": len(watchdog_alerts),
    }, f"FINAL: {final_decision.upper()} in {pipeline_time:.0f}ms",
    severity="info" if final_decision == "approve" else "warning")

    await db.flush()

    logger.info(
        f"[Orchestrator] Pipeline complete for {transaction_id[:8]}: "
        f"{final_decision} in {pipeline_time:.0f}ms"
    )

    return {
        "transaction_id": transaction_id,
        "final_decision": final_decision,
        "aggregated_confidence": consensus["aggregated_confidence"],
        "voting_breakdown": consensus["voting_breakdown"],
        "dissenting_opinions": consensus["dissenting_opinions"],
        "governance": {
            "passed": governance["passed"],
            "checks": governance["checks"],
            "requires_human_approval": requires_human,
            "escalation_reason": governance.get("escalation_reason"),
        },
        "explainability_summary": explainability_verdict["reasoning"],
        "agent_verdicts": [
            {
                "agent_name": v["agent_name"],
                "decision": v["decision"],
                "confidence": v["confidence"],
                "reasoning": v["reasoning"],
                "risk_flags": v.get("risk_flags", []),
                "processing_time_ms": v.get("processing_time_ms", 0),
            }
            for v in all_verdicts
        ],
        "watchdog_alerts": watchdog_alerts,
        "processing_time_ms": round(pipeline_time, 2),
        "decision_id": decision_record.id,
    }


async def _get_user_spend_totals(db: AsyncSession, user_id: str) -> tuple[Decimal, Decimal]:
    """Query actual daily and monthly spend totals for a user.

    Returns (daily_spend, monthly_spend) as Decimal values.
    """
    now = datetime.now(timezone.utc)
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    try:
        # Daily spend
        daily_result = await db.execute(
            select(func.coalesce(func.sum(Transaction.amount), 0))
            .where(
                Transaction.user_id == user_id,
                Transaction.status.in_(["approved", "processing"]),
                Transaction.created_at >= start_of_day,
            )
        )
        daily_spend = daily_result.scalar() or Decimal("0")

        # Monthly spend
        monthly_result = await db.execute(
            select(func.coalesce(func.sum(Transaction.amount), 0))
            .where(
                Transaction.user_id == user_id,
                Transaction.status.in_(["approved", "processing"]),
                Transaction.created_at >= start_of_month,
            )
        )
        monthly_spend = monthly_result.scalar() or Decimal("0")

        return Decimal(str(daily_spend)), Decimal(str(monthly_spend))

    except Exception as e:
        logger.warning(f"Failed to query spend totals: {e}. Using 0.")
        return Decimal("0"), Decimal("0")


def _compute_audit_hash(event_type: str, event_data: str, description: str, prev_hash: str) -> str:
    """Compute SHA-256 hash for an audit log entry."""
    content = f"{event_type}|{event_data}|{description}|{prev_hash}"
    return hashlib.sha256(content.encode()).hexdigest()


async def _log_audit(
    db: AsyncSession,
    transaction_id: str,
    event_type: str,
    event_data: dict,
    description: str,
    severity: str = "info",
    agent_name: str = None,
):
    """Helper to create an immutable, hash-chained audit log entry."""
    # Get the previous hash for this transaction's chain
    prev_hash = _last_audit_hash.get(transaction_id, "")

    # Compute the entry hash
    entry_hash = _compute_audit_hash(
        event_type, str(event_data), description, prev_hash
    )

    log = AuditLog(
        transaction_id=transaction_id,
        event_type=event_type,
        event_data=event_data,
        description=description,
        severity=severity,
        agent_name=agent_name,
        prev_hash=prev_hash if prev_hash else None,
        entry_hash=entry_hash,
    )
    db.add(log)

    # Update the chain tracker
    _last_audit_hash[transaction_id] = entry_hash
