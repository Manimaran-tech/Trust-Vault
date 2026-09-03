from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.database import get_db
from app.models.decision import Decision
from app.models.agent_verdict import AgentVerdict
from app.models.transaction import Transaction
from app.schemas.decision import DecisionResponse, DecisionDetailResponse, AgentVerdictResponse
from app.auth.dependencies import get_current_user, require_role
from app.models.user import User

router = APIRouter(prefix="/api/decisions", tags=["Decisions"])


@router.get("/", response_model=list[DecisionResponse])
async def list_decisions(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List decisions. Card members see only decisions on their own transactions.
    CSR and Admin see all. Includes joined transaction details."""
    query = select(Decision).order_by(desc(Decision.created_at))

    # Card members can only see decisions on their own transactions
    if current_user.role == "card_member":
        query = (
            query.join(Transaction, Decision.transaction_id == Transaction.id)
            .where(Transaction.user_id == current_user.id)
        )

    query = query.limit(limit).offset(offset)
    result = await db.execute(query)
    decisions = result.scalars().all()

    # Enrich each decision with transaction details
    enriched = []
    for d in decisions:
        tx_result = await db.execute(
            select(Transaction).where(Transaction.id == d.transaction_id)
        )
        tx = tx_result.scalar_one_or_none()
        resp = DecisionResponse(
            id=d.id,
            transaction_id=d.transaction_id,
            final_decision=d.final_decision,
            aggregated_confidence=d.aggregated_confidence,
            requires_human_approval=d.requires_human_approval,
            human_override=d.human_override,
            explainability_summary=d.explainability_summary,
            processing_time_ms=d.processing_time_ms,
            created_at=d.created_at,
            amount=float(tx.amount) if tx else None,
            merchant_name=tx.merchant_name if tx else None,
            merchant_country=tx.merchant_country if tx else None,
            transaction_type=tx.transaction_type if tx else None,
        )
        enriched.append(resp)
    return enriched


@router.get("/{decision_id}", response_model=DecisionDetailResponse)
async def get_decision_detail(
    decision_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get full decision detail with agent verdicts and audit trail."""
    result = await db.execute(
        select(Decision).where(Decision.id == decision_id)
    )
    decision = result.scalar_one_or_none()
    if not decision:
        raise HTTPException(status_code=404, detail="Decision not found")

    # Card members can only see decisions on their own transactions
    if current_user.role == "card_member":
        tx_result = await db.execute(
            select(Transaction).where(Transaction.id == decision.transaction_id)
        )
        tx = tx_result.scalar_one_or_none()
        if not tx or tx.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied")

    # Get agent verdicts
    verdicts_result = await db.execute(
        select(AgentVerdict).where(AgentVerdict.decision_id == decision_id)
    )
    verdicts = verdicts_result.scalars().all()

    # Get transaction
    tx_result = await db.execute(
        select(Transaction).where(Transaction.id == decision.transaction_id)
    )
    transaction = tx_result.scalar_one_or_none()

    tx_dict = None
    if transaction:
        tx_dict = {
            "id": transaction.id,
            "transaction_type": transaction.transaction_type,
            "amount": float(transaction.amount),
            "currency": transaction.currency,
            "merchant_name": transaction.merchant_name,
            "merchant_category": transaction.merchant_category,
            "card_member_name": transaction.card_member_name,
            "status": transaction.status,
            "created_at": transaction.created_at.isoformat(),
        }

    return DecisionDetailResponse(
        id=decision.id,
        transaction_id=decision.transaction_id,
        final_decision=decision.final_decision,
        aggregated_confidence=decision.aggregated_confidence,
        voting_breakdown=decision.voting_breakdown,
        dissenting_opinions=decision.dissenting_opinions or [],
        governance_result=decision.governance_result or {},
        explainability_summary=decision.explainability_summary,
        requires_human_approval=decision.requires_human_approval,
        human_override=decision.human_override,
        human_override_reason=decision.human_override_reason,
        processing_time_ms=decision.processing_time_ms,
        created_at=decision.created_at,
        agent_verdicts=[AgentVerdictResponse.model_validate(v) for v in verdicts],
        transaction=tx_dict,
    )


@router.post("/{decision_id}/override")
async def override_decision(
    decision_id: str,
    override_decision: str,
    reason: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("csr", "admin")),
):
    """CSR or Admin can override a decision. Requires reason."""
    result = await db.execute(
        select(Decision).where(Decision.id == decision_id)
    )
    decision = result.scalar_one_or_none()
    if not decision:
        raise HTTPException(status_code=404, detail="Decision not found")

    if override_decision not in ("approve", "deny"):
        raise HTTPException(status_code=400, detail="Override must be 'approve' or 'deny'")

    if not reason or len(reason.strip()) < 10:
        raise HTTPException(status_code=400, detail="Override reason must be at least 10 characters")

    decision.human_override = override_decision
    decision.human_override_reason = f"[{current_user.username}] {reason}"
    await db.flush()

    # Update transaction status
    tx_result = await db.execute(
        select(Transaction).where(Transaction.id == decision.transaction_id)
    )
    transaction = tx_result.scalar_one_or_none()
    if transaction:
        transaction.status = override_decision

        if override_decision == "deny":
            client_ip = (transaction.metadata_json or {}).get("client_ip")
            if client_ip and client_ip != "unknown":
                from app.models.blocklist import IPBlocklist
                import redis.asyncio as redis
                from app.config import get_settings
                settings = get_settings()
                import logging
                logger = logging.getLogger(__name__)
                
                # Add to DB
                block_entry = IPBlocklist(ip_address=client_ip, reason=f"Human override to deny decision {decision_id}")
                db.add(block_entry)
                
                # Add to Redis
                try:
                    r = redis.from_url(settings.REDIS_URL, decode_responses=True)
                    await r.sadd("blocked_ips", client_ip)
                except Exception as e:
                    logger.error(f"Failed to cache blocked IP in Redis: {e}")

    return {"message": f"Decision overridden to {override_decision}", "by": current_user.username}
