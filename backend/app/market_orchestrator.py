"""
The market decision pipeline.

One pass over one candidate action, in the order the problem statement lays out:

  observe    — take a fresh market reading and the current capital picture
  interpret  — allocate capital to the opportunity, or find that none survives
  reason     — six domain experts vote independently
  assess     — weighted consensus, with the adapted weights
  act        — execute, or decline, or escalate
  record     — hash-chained audit entry for every step

Outcome observation and adaptation happen when the resulting position closes,
in `record_position_outcome`.
"""
import asyncio
import hashlib
import logging
import time
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import adaptation, portfolio_service
from app.agents.market import (
    CorrelationAgent,
    ExposureAgent,
    LiquidityAgent,
    MarketExplainabilityAgent,
    SentimentAgent,
    SignalAgent,
    VolatilityAgent,
)
from app.allocator import allocate
from app.config import get_settings
from app.consensus import compute_consensus
from app.execution import ExecutionError, close_position, open_position
from app.market.feed import market_feed
from app.market.types import MarketSnapshot, Observation
from app.models.audit_log import AuditLog
from app.models.market_decision import MarketDecision
from app.models.portfolio import Portfolio
from app.models.position import Position
from app.models.watchdog_alert import WatchdogAlert
from app.watchdog import analyze_verdicts
from app.ws_manager import ws_manager

logger = logging.getLogger(__name__)
settings = get_settings()

signal_agent = SignalAgent()
sentiment_agent = SentimentAgent()
volatility_agent = VolatilityAgent()
exposure_agent = ExposureAgent()
liquidity_agent = LiquidityAgent()
correlation_agent = CorrelationAgent()
explainability_agent = MarketExplainabilityAgent()

MARKET_EXPERTS = [
    signal_agent,
    sentiment_agent,
    volatility_agent,
    exposure_agent,
    liquidity_agent,
    correlation_agent,
]

# Continues the hash chain per subject.
_last_audit_hash: dict[str, str] = {}


async def evaluate_action(
    db: AsyncSession,
    portfolio: Portfolio,
    symbol: str,
    side: str,
    action: str,
    snapshot: MarketSnapshot,
    trigger: str = "scheduled",
    existing_position: Position | None = None,
    reassessment_of: str | None = None,
    override_notional: float | None = None,
) -> MarketDecision:
    """
    Run one full pass of the loop and persist the result.

    `override_notional` lets an operator propose a specific size. It is a
    request, not an instruction: the value is still clipped by every capital
    limit, and the quorum still decides whether the action happens at all.
    """
    started = time.time()
    obs = snapshot.get(symbol)

    if obs is None:
        return await _record_no_observation(db, portfolio, symbol, side, action, trigger)

    state = await portfolio_service.compute_state(db, portfolio, snapshot)

    # --- Interpret: how much capital does this deserve? ---
    if action == "open":
        allocation = allocate(
            symbol=symbol,
            side=side,
            obs=obs,
            nav=state["nav"],
            cash=state["cash"],
            current_exposure_pct=state["exposure_pct"],
            correlated_notional=_correlated_notional(symbol, side, state, snapshot),
            constraints=state["constraints"],
        )
        proposed_notional = allocation.notional
        expected_edge_bps = allocation.expected_edge_bps

        # An operator-supplied size may only reduce what the allocator granted.
        # Allowing it to exceed the limits would make the constraints advisory.
        if override_notional is not None and allocation.notional > 0:
            requested = min(override_notional, allocation.notional)
            if requested < override_notional:
                logger.info(
                    f"[Orchestrator] operator requested ${override_notional:,.0f} on "
                    f"{symbol}; clipped to ${requested:,.0f} by "
                    f"{allocation.binding_constraint}"
                )
            allocation.notional = requested
            allocation.quantity = requested / obs.price if obs.price > 0 else 0.0
            allocation.rationale = (
                f"Operator requested ${override_notional:,.0f}; "
                f"sized to ${requested:,.0f}. {allocation.rationale}"
            )
            proposed_notional = requested
    else:
        # Closing is sized by the position itself, not by the allocator.
        allocation = None
        proposed_notional = (
            float(existing_position.notional) if existing_position else 0.0
        )
        expected_edge_bps = 0.0

    # No size survives the constraints. That is a real decision with a real
    # reason, so it is recorded rather than silently skipped.
    if action == "open" and allocation and allocation.notional <= 0:
        return await _record_no_allocation(
            db, portfolio, symbol, side, obs, state, allocation, trigger, started
        )

    proposal = {
        "symbol": symbol,
        "side": side,
        "action": action,
        "observation": obs.to_dict(),
        "correlations": snapshot.correlations,
        "portfolio": state,
        "proposed_notional": proposed_notional,
        "expected_edge_bps": expected_edge_bps,
        "existing_position": _render_existing(existing_position, state),
    }

    # --- Reason: the six experts vote independently and in parallel ---
    await ws_manager.broadcast(
        {
            "type": "market_evaluation_started",
            "data": {
                "symbol": symbol,
                "side": side,
                "action": action,
                "notional": proposed_notional,
                "trigger": trigger,
            },
        }
    )

    verdicts = await _run_experts(proposal, symbol)

    explain = await explainability_agent.evaluate(proposal, verdicts)
    all_verdicts = verdicts + [explain]

    # --- Assess: consensus under weights that reflect realised track record ---
    weights = await adaptation.current_weights(db)
    consensus = compute_consensus(all_verdicts, weights=weights)
    final_decision = consensus["final_decision"]

    # Ambiguity on a live capital commitment escalates rather than resolving
    # itself by guesswork.
    requires_human = final_decision == "review" and action == "open"
    if requires_human:
        final_decision = "pending_human_review"

    decision = MarketDecision(
        portfolio_id=portfolio.id,
        symbol=symbol,
        action=action,
        side=side,
        final_decision=final_decision,
        aggregated_confidence=consensus["aggregated_confidence"],
        voting_breakdown=consensus["voting_breakdown"],
        dissenting_opinions=consensus["dissenting_opinions"],
        explainability_summary=explain["reasoning"],
        observation=obs.to_dict(),
        observation_age_seconds=obs.age_seconds,
        portfolio_state=_slim_state(state),
        constraints=state["constraints"],
        allocation=allocation.to_dict() if allocation else {},
        proposed_notional=Decimal(str(proposed_notional)),
        expected_edge_bps=expected_edge_bps,
        expected_cost_bps=allocation.expected_cost_bps if allocation else 0.0,
        binding_constraint=allocation.binding_constraint if allocation else None,
        trigger=trigger,
        is_reassessment=reassessment_of is not None,
        reassessment_of=reassessment_of,
        requires_human_approval=requires_human,
    )
    db.add(decision)
    await db.flush()

    # Participation is known now; whether each vote was right is not known
    # until the position closes. Recording the first immediately keeps the
    # adaptation view populated during the window before anything has closed.
    try:
        await adaptation.record_votes(db, consensus["voting_breakdown"])
    except Exception as e:
        logger.warning(f"[Orchestrator] could not record vote participation: {e}")

    await _audit(
        db, decision.id, "market_observation",
        {
            "symbol": symbol,
            "price": obs.price,
            "age_seconds": round(obs.age_seconds, 3),
            "volatility": obs.volatility,
            "spread_bps": round(obs.spread_bps, 2),
            "depth_quote": obs.depth_quote,
        },
        f"Observed {symbol} at {obs.price:,.4f} ({obs.age_seconds:.1f}s old)",
    )
    for v in all_verdicts:
        await _audit(
            db, decision.id, "agent_evaluation",
            {
                "agent": v["agent_name"],
                "decision": v["decision"],
                "confidence": v["confidence"],
                "mode": v.get("evaluation_mode"),
                "risk_flags": v.get("risk_flags", []),
            },
            f"{v['agent_name']}: {v['decision']} ({v['confidence']:.0%})",
            agent_name=v["agent_name"],
        )
    if allocation:
        await _audit(
            db, decision.id, "capital_allocation", allocation.to_dict(),
            allocation.rationale,
        )
    await _audit(
        db, decision.id, "consensus_reached",
        {
            "decision": final_decision,
            "confidence": consensus["aggregated_confidence"],
            "dissenters": len(consensus["dissenting_opinions"]),
            "weights_used": consensus["consensus_details"].get("weights_used", {}),
        },
        f"Consensus: {final_decision} ({consensus['aggregated_confidence']:.0%})",
        severity="warning" if final_decision != "approve" else "info",
    )

    # --- Watchdog: behavioural monitoring over the quorum ---
    for alert in analyze_verdicts(all_verdicts, consensus["final_decision"]):
        db.add(
            WatchdogAlert(
                alert_type=alert["alert_type"],
                severity=alert["severity"],
                agent_name=alert.get("agent_name"),
                description=alert["description"],
                details=alert.get("details", {}),
                anomaly_score=alert.get("anomaly_score"),
            )
        )
        await _audit(
            db, decision.id, "watchdog_alert",
            {"alert_type": alert["alert_type"], "severity": alert["severity"]},
            f"Watchdog: {alert['description']}",
            severity="warning",
        )

    # --- Act ---
    if final_decision == "approve":
        await _execute(db, portfolio, decision, obs, allocation, existing_position, all_verdicts)

    decision.processing_time_ms = round((time.time() - started) * 1000, 2)

    await _audit(
        db, decision.id, "decision_final",
        {
            "decision": final_decision,
            "executed": decision.executed,
            "notional": float(decision.proposed_notional),
            "processing_time_ms": decision.processing_time_ms,
        },
        f"FINAL: {final_decision.upper()} {action} {side or ''} {symbol} "
        f"in {decision.processing_time_ms:.0f}ms",
        severity="info" if final_decision == "approve" else "warning",
    )
    await db.flush()

    await ws_manager.broadcast(
        {
            "type": "market_decision",
            "data": {
                "decision_id": decision.id,
                "symbol": symbol,
                "action": action,
                "side": side,
                "final_decision": final_decision,
                "confidence": consensus["aggregated_confidence"],
                "notional": float(decision.proposed_notional),
                "executed": decision.executed,
                "trigger": trigger,
                "summary": explain["reasoning"][:400],
                "voting_breakdown": consensus["voting_breakdown"],
                "processing_time_ms": decision.processing_time_ms,
            },
        }
    )

    # Narrate the action aloud. Failure here must never affect the decision.
    if decision.executed:
        asyncio.create_task(_narrate(decision, explain["reasoning"]))

    return decision


async def _run_experts(proposal: dict, symbol: str) -> list[dict]:
    """Dispatch the quorum in parallel, converting failures into abstentions."""

    async def run(agent):
        await ws_manager.broadcast(
            {
                "type": "expert_started",
                "data": {"agent": agent.name, "quorum": "market", "symbol": symbol},
            }
        )
        result = await agent.evaluate(proposal)
        await ws_manager.broadcast(
            {
                "type": "expert_finished",
                "data": {
                    "agent": agent.name,
                    "quorum": "market",
                    "symbol": symbol,
                    "decision": result.get("decision", "error"),
                    "confidence": result.get("confidence", 0.0),
                    "mode": result.get("evaluation_mode"),
                },
            }
        )
        return result

    raw = await asyncio.gather(
        *[run(a) for a in MARKET_EXPERTS], return_exceptions=True
    )

    verdicts = []
    for agent, result in zip(MARKET_EXPERTS, raw):
        if isinstance(result, Exception):
            logger.error(f"Expert {agent.name} raised: {result}")
            verdicts.append(
                {
                    "agent_name": agent.name,
                    "decision": "review",
                    "confidence": 0.2,
                    "reasoning": f"Expert failed: {result}",
                    "risk_flags": ["agent_failure"],
                    "processing_time_ms": 0.0,
                    "raw_response": "",
                    "evaluation_mode": "abstain",
                }
            )
        else:
            verdicts.append(result)
    return verdicts


async def _execute(
    db: AsyncSession,
    portfolio: Portfolio,
    decision: MarketDecision,
    obs: Observation,
    allocation,
    existing_position: Position | None,
    verdicts: list[dict],
) -> None:
    """Carry out an approved action, recording any failure on the decision."""
    try:
        if decision.action == "open" and allocation:
            position = await open_position(
                db=db,
                portfolio=portfolio,
                symbol=decision.symbol,
                side=decision.side,
                quantity=allocation.quantity,
                obs=obs,
                expected_slippage_bps=allocation.expected_slippage_bps,
                expected_edge_bps=allocation.expected_edge_bps,
                stop_price=allocation.stop_price,
                target_price=allocation.target_price,
                thesis=decision.explainability_summary,
                decision_id=decision.id,
                agent_votes={
                    v["agent_name"]: {
                        "decision": v["decision"],
                        "confidence": v["confidence"],
                    }
                    for v in verdicts
                },
            )
            decision.executed = True
            decision.position_id = position.id
            await _audit(
                db, decision.id, "execution",
                {
                    "position_id": position.id,
                    "fill_price": float(position.entry_price),
                    "reference_price": obs.price,
                    "quantity": float(position.quantity),
                    "fees": float(position.fees_paid),
                    "slippage": float(position.slippage_paid),
                },
                f"Opened {decision.side} {float(position.quantity):.6f} "
                f"{decision.symbol} at {float(position.entry_price):,.4f} "
                f"(reference {obs.price:,.4f})",
            )

        elif decision.action == "close" and existing_position:
            closed = await close_position(
                db=db,
                portfolio=portfolio,
                position=existing_position,
                obs=obs,
                reason=decision.trigger,
                decision_id=decision.id,
            )
            decision.executed = True
            decision.position_id = closed.id
            await _audit(
                db, decision.id, "execution",
                {
                    "position_id": closed.id,
                    "exit_price": float(closed.exit_price),
                    "realized_pnl": float(closed.realized_pnl),
                    "reason": decision.trigger,
                },
                f"Closed {closed.side} {closed.symbol} at "
                f"{float(closed.exit_price):,.4f}, P&L "
                f"{float(closed.realized_pnl):+,.2f}",
            )
            await record_position_outcome(db, closed)

    except ExecutionError as e:
        # The decision stands as approved; execution is what failed. Recording
        # them separately is the point — an opportunity identified is not an
        # opportunity captured.
        decision.executed = False
        decision.execution_error = str(e)
        logger.warning(f"[Orchestrator] execution failed: {e}")
        await _audit(
            db, decision.id, "execution_failed", {"error": str(e)},
            f"Approved but not executed: {e}", severity="critical",
        )


async def execute_mechanical_exit(
    db: AsyncSession,
    portfolio: Portfolio,
    position: Position,
    obs: Observation,
    trigger: str,
) -> MarketDecision:
    """
    Execute a stop or target exit without a vote.

    The risk envelope was agreed by the quorum when the position was opened.
    Re-opening that argument at the exact moment the stop binds is how a stop
    stops protecting anything, so this path deliberately bypasses consensus.
    The decision is still recorded in full, with the same audit chain, so the
    exit is as auditable as any other.
    """
    started = time.time()
    state = await portfolio_service.compute_state(db, portfolio, market_feed.snapshot())

    decision = MarketDecision(
        portfolio_id=portfolio.id,
        symbol=position.symbol,
        action="close",
        side=position.side,
        final_decision="approve",
        aggregated_confidence=1.0,
        voting_breakdown={},
        explainability_summary=(
            f"{'Stop' if trigger == 'stop_hit' else 'Target'} reached at "
            f"{obs.price:,.4f} against a level of "
            f"{float(position.stop_price if trigger == 'stop_hit' else position.target_price):,.4f} "
            f"set when the position was opened. Executed without a vote: the risk "
            f"envelope was agreed at entry and is not re-argued at the moment it binds."
        ),
        observation=obs.to_dict(),
        observation_age_seconds=obs.age_seconds,
        portfolio_state=_slim_state(state),
        constraints=state["constraints"],
        proposed_notional=position.notional,
        trigger=trigger,
        is_reassessment=True,
        reassessment_of=position.opening_decision_id,
    )
    db.add(decision)
    await db.flush()

    await _audit(
        db, decision.id, "mechanical_exit",
        {
            "trigger": trigger,
            "price": obs.price,
            "stop_price": float(position.stop_price) if position.stop_price else None,
            "target_price": float(position.target_price) if position.target_price else None,
        },
        f"{trigger.replace('_', ' ').title()} on {position.symbol} at {obs.price:,.4f}; "
        f"exiting without a vote.",
        severity="warning" if trigger == "stop_hit" else "info",
    )

    try:
        closed = await close_position(
            db=db,
            portfolio=portfolio,
            position=position,
            obs=obs,
            reason=trigger,
            decision_id=decision.id,
        )
        decision.executed = True
        decision.position_id = closed.id
        await _audit(
            db, decision.id, "execution",
            {
                "position_id": closed.id,
                "exit_price": float(closed.exit_price),
                "realized_pnl": float(closed.realized_pnl),
                "reason": trigger,
            },
            f"Closed {closed.side} {closed.symbol} at {float(closed.exit_price):,.4f}, "
            f"P&L {float(closed.realized_pnl):+,.2f}",
        )
        await record_position_outcome(db, closed)
    except ExecutionError as e:
        decision.executed = False
        decision.execution_error = str(e)
        logger.error(f"[Orchestrator] mechanical exit failed: {e}")
        await _audit(
            db, decision.id, "execution_failed", {"error": str(e)},
            f"Stop or target reached but the exit could not be executed: {e}",
            severity="critical",
        )

    decision.processing_time_ms = round((time.time() - started) * 1000, 2)
    await db.flush()

    await ws_manager.broadcast(
        {
            "type": "market_decision",
            "data": {
                "decision_id": decision.id,
                "symbol": position.symbol,
                "action": "close",
                "side": position.side,
                "final_decision": decision.final_decision,
                "confidence": 1.0,
                "notional": float(decision.proposed_notional),
                "executed": decision.executed,
                "trigger": trigger,
                "summary": decision.explainability_summary[:400],
                "voting_breakdown": {},
                "processing_time_ms": decision.processing_time_ms,
            },
        }
    )

    if decision.executed:
        asyncio.create_task(_narrate(decision, decision.explainability_summary))

    return decision


async def record_position_outcome(db: AsyncSession, position: Position) -> dict:
    """
    Close the loop: score the agents that voted on this position and let the
    result move their weight in future decisions.
    """
    result = await adaptation.record_outcome(db, position)
    weight_changes = await adaptation.adapt_weights(db)

    if position.opening_decision_id:
        found = await db.execute(
            select(MarketDecision).where(
                MarketDecision.id == position.opening_decision_id
            )
        )
        opening = found.scalar_one_or_none()
        if opening:
            opening.outcome_recorded = True
            opening.realized_pnl = position.realized_pnl
            opening.outcome_correct = float(position.realized_pnl) > 0
            opening.agents_scored = result.get("scored", 0)

            await _audit(
                db, opening.id, "outcome_observed",
                {
                    "realized_pnl": float(position.realized_pnl),
                    "profitable": opening.outcome_correct,
                    "agents_scored": result.get("scored", 0),
                    "weight_changes": weight_changes,
                },
                f"Outcome on {position.symbol}: "
                f"{float(position.realized_pnl):+,.2f}. "
                f"{result.get('scored', 0)} agents scored, weights updated.",
            )

    await ws_manager.broadcast(
        {
            "type": "outcome_observed",
            "data": {
                "symbol": position.symbol,
                "realized_pnl": float(position.realized_pnl),
                "close_reason": position.close_reason,
                "weight_changes": weight_changes,
            },
        }
    )
    return {"outcome": result, "weight_changes": weight_changes}


# --------------------------------------------------------------------- #
# Recording paths that do not reach the quorum
# --------------------------------------------------------------------- #

async def _record_no_observation(
    db, portfolio, symbol, side, action, trigger
) -> MarketDecision:
    decision = MarketDecision(
        portfolio_id=portfolio.id,
        symbol=symbol,
        action=action,
        side=side,
        final_decision="deny",
        aggregated_confidence=1.0,
        voting_breakdown={},
        explainability_summary=(
            f"No observation available for {symbol}. The desk does not act on "
            f"instruments it cannot currently see."
        ),
        trigger=trigger,
    )
    db.add(decision)
    await db.flush()
    await _audit(
        db, decision.id, "decision_final",
        {"decision": "deny", "reason": "no_observation"},
        f"Declined {action} {symbol}: no market observation available",
        severity="warning",
    )
    return decision


async def _record_no_allocation(
    db, portfolio, symbol, side, obs, state, allocation, trigger, started
) -> MarketDecision:
    decision = MarketDecision(
        portfolio_id=portfolio.id,
        symbol=symbol,
        action="open",
        side=side,
        final_decision="deny",
        aggregated_confidence=0.9,
        voting_breakdown={},
        explainability_summary=allocation.rationale,
        observation=obs.to_dict(),
        observation_age_seconds=obs.age_seconds,
        portfolio_state=_slim_state(state),
        constraints=state["constraints"],
        allocation=allocation.to_dict(),
        proposed_notional=Decimal("0"),
        expected_edge_bps=allocation.expected_edge_bps,
        expected_cost_bps=allocation.expected_cost_bps,
        binding_constraint=allocation.binding_constraint,
        trigger=trigger,
        processing_time_ms=round((time.time() - started) * 1000, 2),
    )
    db.add(decision)
    await db.flush()
    await _audit(
        db, decision.id, "capital_allocation", allocation.to_dict(),
        allocation.rationale, severity="info",
    )
    await _audit(
        db, decision.id, "decision_final",
        {"decision": "deny", "binding_constraint": allocation.binding_constraint},
        f"No capital allocated to {side} {symbol}: {allocation.binding_constraint}",
    )
    return decision


# --------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------- #

def _correlated_notional(
    symbol: str, side: str, state: dict, snapshot: MarketSnapshot
) -> float:
    """Notional already held that moves with this proposal in the same direction."""
    correlations = snapshot.correlations.get(symbol, {})
    total = 0.0
    for pos in state.get("positions", []):
        rho = correlations.get(pos["symbol"], 0.0)
        effective = rho if pos["side"] == side else -rho
        if effective >= CorrelationAgent.HIGH_CORRELATION:
            total += abs(pos["notional"])
    return total


def _render_existing(position: Position | None, state: dict) -> dict | None:
    if position is None:
        return None
    for p in state.get("positions", []):
        if p["id"] == position.id:
            return p
    return {
        "id": position.id,
        "symbol": position.symbol,
        "side": position.side,
        "quantity": float(position.quantity),
        "entry_price": float(position.entry_price),
        "reassessment_count": position.reassessment_count,
        "thesis": position.thesis,
    }


def _slim_state(state: dict) -> dict:
    """Store the capital picture without duplicating the full position list."""
    return {k: v for k, v in state.items() if k not in ("positions", "constraints")}


def _compute_audit_hash(event_type, event_data, description, prev_hash) -> str:
    content = f"{event_type}|{event_data}|{description}|{prev_hash}"
    return hashlib.sha256(content.encode()).hexdigest()


async def _audit(
    db: AsyncSession,
    subject_id: str,
    event_type: str,
    event_data: dict,
    description: str,
    severity: str = "info",
    agent_name: str = None,
) -> None:
    """Append a hash-chained audit entry for a market decision."""
    prev_hash = _last_audit_hash.get(subject_id, "")
    entry_hash = _compute_audit_hash(
        event_type, str(event_data), description, prev_hash
    )
    db.add(
        AuditLog(
            transaction_id=None,
            subject_id=subject_id,
            subject_type="market_decision",
            event_type=event_type,
            event_data=event_data,
            description=description,
            severity=severity,
            agent_name=agent_name,
            prev_hash=prev_hash or None,
            entry_hash=entry_hash,
        )
    )
    _last_audit_hash[subject_id] = entry_hash


async def _narrate(decision: MarketDecision, reasoning: str) -> None:
    """Speak the action. Voice is a reporting channel, never a decision path."""
    try:
        from app.voice import narrate_decision

        await narrate_decision(decision, reasoning)
    except Exception as e:
        logger.debug(f"[Orchestrator] narration skipped: {e}")
