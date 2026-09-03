from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from app.database import get_db
from app.models.decision import Decision
from app.models.transaction import Transaction
from app.models.agent_verdict import AgentVerdict
from app.models.watchdog_alert import WatchdogAlert
from app.auth.dependencies import require_role
from app.models.user import User
from app.watchdog import get_agent_health

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


@router.get("/metrics")
async def get_dashboard_metrics(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin", "csr")),
):
    """Get aggregated dashboard metrics. Admin and CSR only."""
    # Total transactions
    total_result = await db.execute(select(func.count(Transaction.id)))
    total_transactions = total_result.scalar() or 0

    # Decision counts
    approved_result = await db.execute(
        select(func.count(Decision.id)).where(Decision.final_decision == "approve")
    )
    approved_count = approved_result.scalar() or 0

    denied_result = await db.execute(
        select(func.count(Decision.id)).where(Decision.final_decision == "deny")
    )
    denied_count = denied_result.scalar() or 0

    review_result = await db.execute(
        select(func.count(Decision.id)).where(Decision.final_decision == "review")
    )
    review_count = review_result.scalar() or 0

    # Average confidence
    avg_conf_result = await db.execute(
        select(func.avg(Decision.aggregated_confidence))
    )
    avg_confidence = avg_conf_result.scalar() or 0.0

    # Escalations (Active holds)
    escalation_result = await db.execute(
        select(func.count(Decision.id)).where(Decision.final_decision == "pending_human_review")
    )
    total_escalations = escalation_result.scalar() or 0

    # Total flags from agent verdicts
    # (Count verdicts that have non-empty risk_flags)
    total_flags = 0
    flags_result = await db.execute(select(AgentVerdict.risk_flags))
    for row in flags_result.scalars().all():
        if row:
            if isinstance(row, str):
                import json
                try:
                    row = json.loads(row)
                except Exception:
                    pass
            if isinstance(row, list):
                total_flags += len(row)

    # Approval rate
    total_decisions = approved_count + denied_count + review_count
    approval_rate = (approved_count / total_decisions * 100) if total_decisions > 0 else 0.0

    # Agent health
    agent_health = get_agent_health()

    # Recent decisions
    recent_result = await db.execute(
        select(Decision)
        .order_by(desc(Decision.created_at))
        .limit(10)
    )
    recent_decisions = []
    for decision in recent_result.scalars().all():
        tx_result = await db.execute(
            select(Transaction).where(Transaction.id == decision.transaction_id)
        )
        tx = tx_result.scalar_one_or_none()
        recent_decisions.append({
            "id": decision.id,
            "transaction_id": decision.transaction_id,
            "final_decision": decision.final_decision,
            "aggregated_confidence": decision.aggregated_confidence,
            "processing_time_ms": decision.processing_time_ms,
            "requires_human_approval": decision.requires_human_approval,
            "created_at": decision.created_at.isoformat(),
            "amount": float(tx.amount) if tx else 0,
            "merchant": tx.merchant_name if tx else "Unknown",
            "transaction_type": tx.transaction_type if tx else "unknown",
        })

    return {
        "total_transactions": total_transactions,
        "approved_count": approved_count,
        "denied_count": denied_count,
        "review_count": review_count,
        "approval_rate": round(approval_rate, 1),
        "avg_confidence": round(float(avg_confidence), 3),
        "total_flags": total_flags,
        "total_escalations": total_escalations,
        "agent_health": agent_health,
        "recent_decisions": recent_decisions,
    }
