"""Capital, positions, ledger and adaptation endpoints."""
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import adaptation, market_orchestrator, portfolio_service
from app.auth.dependencies import get_current_user, require_role
from app.database import get_db
from app.ledger import ledger
from app.payments import payment_gateway
from app.market.feed import market_feed
from app.models.agent_performance import AgentPerformance
from app.models.portfolio import Portfolio
from app.allocator import estimate_edge_bps
from app.config import get_settings
from app.models.position import Fill, LedgerEntry, Position
from app.models.user import User

settings = get_settings()

router = APIRouter(prefix="/api/portfolio", tags=["Portfolio"])


@router.get("")
async def get_portfolio(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Capital state marked to the current market.

    Positions whose instrument has no fresh quote are marked at entry and
    listed in `positions_marked_at_entry`, so NAV is never quietly derived
    from prices that no longer exist.
    """
    portfolio = await portfolio_service.get_or_create_portfolio(db)
    return await portfolio_service.compute_state(db, portfolio, market_feed.snapshot())


@router.get("/positions")
async def list_positions(
    status: str = Query("open", pattern="^(open|closed|all)$"),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    portfolio = await portfolio_service.get_or_create_portfolio(db)
    stmt = (
        select(Position)
        .where(Position.portfolio_id == portfolio.id)
        .order_by(desc(Position.opened_at))
        .limit(limit)
    )
    if status != "all":
        stmt = stmt.where(Position.status == status)

    result = await db.execute(stmt)
    snapshot = market_feed.snapshot()

    positions = []
    for p in result.scalars().all():
        obs = snapshot.get(p.symbol)
        positions.append(
            {
                "id": p.id,
                "symbol": p.symbol,
                "side": p.side,
                "status": p.status,
                "quantity": float(p.quantity),
                "entry_price": float(p.entry_price),
                "exit_price": float(p.exit_price) if p.exit_price else None,
                "mark_price": obs.price if obs else None,
                "notional": float(p.notional),
                "realized_pnl": float(p.realized_pnl),
                "fees_paid": float(p.fees_paid),
                "slippage_paid": float(p.slippage_paid),
                "stop_price": float(p.stop_price) if p.stop_price else None,
                "target_price": float(p.target_price) if p.target_price else None,
                "entry_volatility": p.entry_volatility,
                "expected_edge_bps": p.expected_edge_bps,
                "reassessment_count": p.reassessment_count,
                "close_reason": p.close_reason,
                "thesis": p.thesis,
                "opening_decision_id": p.opening_decision_id,
                "opened_at": p.opened_at.isoformat(),
                "closed_at": p.closed_at.isoformat() if p.closed_at else None,
            }
        )
    return positions


@router.post("/positions/open")
async def open_position_manually(
    symbol: str = Query(..., min_length=1, description="Instrument to trade"),
    side: str = Query("long", pattern="^(long|short)$"),
    notional: float | None = Query(
        None,
        gt=0,
        description=(
            "Notional to commit. Omit to let the allocator size it. A value "
            "above what the limits permit is clipped, not honoured."
        ),
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin", "csr")),
):
    """
    Put a specific opening action to the quorum.

    The operator chooses what is considered; the experts still decide whether it
    happens. A manual proposal is subject to every limit, cost check and veto
    that an agent-raised one is, and is recorded with trigger "manual" so the
    audit trail shows who initiated it.
    """
    symbol = symbol.strip().upper()
    snapshot = market_feed.snapshot()
    obs = snapshot.get(symbol)

    if obs is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No observation for {symbol}. Available: "
                f"{', '.join(market_feed.symbols)}"
            ),
        )
    if not obs.is_tradeable:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{symbol} is not trading — its price has not moved across the "
                f"observation window. There is no volatility to size against and "
                f"no spread to cost, so any edge estimate would be an artefact."
            ),
        )

    portfolio = await portfolio_service.get_or_create_portfolio(db)

    decision = await market_orchestrator.evaluate_action(
        db, portfolio, symbol, side, "open", snapshot,
        trigger="manual",
        override_notional=notional,
    )

    return {
        "decision_id": decision.id,
        "symbol": decision.symbol,
        "side": decision.side,
        "final_decision": decision.final_decision,
        "confidence": decision.aggregated_confidence,
        "notional": float(decision.proposed_notional),
        "binding_constraint": decision.binding_constraint,
        "executed": decision.executed,
        "position_id": decision.position_id,
        "execution_error": decision.execution_error,
        "summary": decision.explainability_summary,
        "voting_breakdown": decision.voting_breakdown,
        "processing_time_ms": decision.processing_time_ms,
    }


@router.post("/positions/{position_id}/close")
async def close_position_manually(
    position_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin", "csr")),
):
    """
    Close one named position.

    Routed through the quorum like any other exit, so fees, slippage and the
    ledger entries are recorded exactly as they would be for an agent-initiated
    close. A manual exit does not produce a tidier set of books than reality.
    """
    result = await db.execute(select(Position).where(Position.id == position_id))
    position = result.scalar_one_or_none()

    if position is None:
        raise HTTPException(status_code=404, detail="Position not found")
    if position.status != "open":
        raise HTTPException(
            status_code=409, detail=f"Position is already {position.status}"
        )

    snapshot = market_feed.snapshot()
    obs = snapshot.get(position.symbol)
    if obs is None:
        raise HTTPException(
            status_code=409,
            detail=f"No current price for {position.symbol}; cannot value the exit.",
        )

    portfolio = await portfolio_service.get_or_create_portfolio(db)
    decision = await market_orchestrator.evaluate_action(
        db, portfolio, position.symbol, position.side, "close", snapshot,
        trigger="manual_close",
        existing_position=position,
        reassessment_of=position.opening_decision_id,
    )

    return {
        "decision_id": decision.id,
        "final_decision": decision.final_decision,
        "executed": decision.executed,
        "execution_error": decision.execution_error,
        "summary": decision.explainability_summary,
        "voting_breakdown": decision.voting_breakdown,
    }


@router.get("/instruments")
async def list_instruments(current_user: User = Depends(get_current_user)):
    """
    What the desk can currently trade, and why anything is excluded.

    Returned per instrument rather than as a bare list so the UI can disable a
    choice and say what is wrong with it, instead of offering a trade that will
    be rejected.
    """
    snapshot = market_feed.snapshot()
    status = market_feed.status()

    instruments = []
    for symbol in market_feed.symbols:
        obs = snapshot.get(symbol)
        if obs is None:
            instruments.append(
                {"symbol": symbol, "tradeable": False, "reason": "no observation yet"}
            )
            continue

        stale = obs.is_stale(settings.MARKET_STALENESS_SECONDS)
        reason = None
        if stale:
            reason = f"observation is {obs.age_seconds:.0f}s old"
        elif obs.is_static:
            reason = "price has not moved across the window; not trading"

        instruments.append(
            {
                "symbol": symbol,
                "tradeable": obs.is_tradeable and not stale,
                "reason": reason,
                "price": obs.price,
                "spread_bps": round(obs.spread_bps, 3),
                "volatility": obs.volatility,
                "momentum_short": obs.momentum_short,
                "depth_quote": obs.depth_quote,
                "age_seconds": round(obs.age_seconds, 2),
                "edge_long_bps": round(estimate_edge_bps(obs, "long"), 2),
                "edge_short_bps": round(estimate_edge_bps(obs, "short"), 2),
            }
        )

    return {"instruments": instruments, "market_state": status["market_state"]}


@router.get("/fills")
async def list_fills(
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Execution record: expected cost against realised cost, per fill.

    This is the measurable gap between identifying an opportunity and
    capturing it.
    """
    result = await db.execute(
        select(Fill).order_by(desc(Fill.executed_at)).limit(limit)
    )
    return [
        {
            "id": f.id,
            "position_id": f.position_id,
            "symbol": f.symbol,
            "side": f.side,
            "quantity": float(f.quantity),
            "reference_price": float(f.reference_price),
            "fill_price": float(f.fill_price),
            "expected_slippage_bps": f.expected_slippage_bps,
            "realized_slippage_bps": f.realized_slippage_bps,
            "slippage_error_bps": round(
                f.realized_slippage_bps - f.expected_slippage_bps, 3
            ),
            "fee": float(f.fee),
            "venue": f.venue,
            "executed_at": f.executed_at.isoformat(),
        }
        for f in result.scalars().all()
    ]


@router.get("/ledger")
async def get_ledger_entries(
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Raw double-entry rows, newest first."""
    portfolio = await portfolio_service.get_or_create_portfolio(db)
    result = await db.execute(
        select(LedgerEntry)
        .where(LedgerEntry.portfolio_id == portfolio.id)
        .order_by(desc(LedgerEntry.created_at))
        .limit(limit)
    )
    return [
        {
            "id": e.id,
            "transfer_id": e.transfer_id,
            "account": e.account,
            "amount": float(e.amount),
            "currency": e.currency,
            "entry_type": e.entry_type,
            "description": e.description,
            "position_id": e.position_id,
            "provider": e.provider,
            "external_ref": e.external_ref,
            "settlement_provider": e.settlement_provider,
            "settlement_ref": e.settlement_ref,
            "is_paper": e.is_paper,
            "created_at": e.created_at.isoformat(),
        }
        for e in result.scalars().all()
    ]


@router.get("/ledger/trial-balance")
async def get_trial_balance(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Account balances and the integrity check.

    `balanced` is false if any movement was written unpaired. It is surfaced
    rather than corrected, because a book that does not balance is a bug to
    investigate, not a number to adjust.
    """
    portfolio = await portfolio_service.get_or_create_portfolio(db)
    balance = await ledger.trial_balance(db, portfolio.id)
    balance["settlement"] = await ledger.settlement_summary(db, portfolio.id)
    balance["payment_gateway"] = payment_gateway.status()
    balance["currency"] = portfolio.base_currency
    balance["book_of_record"] = (
        "local double-entry — Stitch publishes a payments API, not a ledger, "
        "so the book stays here and the rail is recorded on every entry"
    )
    return balance


@router.get("/ledger/rail")
async def verify_settlement_rail(
    current_user: User = Depends(get_current_user),
):
    """
    Verify the settlement rail live.

    This does not read configuration back: where the rail supports it, the
    credential is exercised against the provider right now, so a green badge
    means an authenticated round trip actually succeeded a moment ago.
    """
    status = payment_gateway.status()
    verify = getattr(payment_gateway, "verify", None)
    if verify is None:
        status["verification"] = {
            "connected": False,
            "detail": (
                "Paper settlement has no external endpoint to verify. "
                "No funds move and no provider is contacted."
            ),
        }
        return status

    status["verification"] = await verify()
    return status


# --------------------------------------------------------------------- #
# Constraints
# --------------------------------------------------------------------- #

@router.get("/constraints")
async def get_constraints(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    portfolio = await portfolio_service.get_or_create_portfolio(db)
    return {
        "constraints": portfolio.constraints or portfolio_service.default_constraints(),
        "halted": portfolio.halted,
        "halt_reason": portfolio.halt_reason,
    }


@router.put("/constraints")
async def update_constraints(
    updates: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """
    Change the envelope the agent operates inside.

    Values outside their permitted range are rejected individually and reported
    in `rejected`, so a single bad field never silently drops a whole update.
    """
    portfolio = await portfolio_service.get_or_create_portfolio(db)
    return await portfolio_service.set_constraints(db, portfolio, updates)


@router.post("/halt")
async def halt_desk(
    reason: str = Query("Halted by operator", min_length=3),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Block new positions. Existing positions can still be closed."""
    portfolio = await portfolio_service.get_or_create_portfolio(db)
    portfolio.halted = True
    portfolio.halt_reason = f"{reason} (by {current_user.username})"
    return {"halted": True, "halt_reason": portfolio.halt_reason}


@router.post("/resume")
async def resume_desk(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    portfolio = await portfolio_service.get_or_create_portfolio(db)
    portfolio.halted = False
    portfolio.halt_reason = None
    return {"halted": False}


@router.post("/flatten")
async def flatten_positions(
    reason: str = Query("Flattened by operator", min_length=3),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """
    Close every open position at the current market.

    Each close still runs through the execution layer, so fees, slippage and
    ledger entries are recorded exactly as they would be for an agent-initiated
    exit — a manual flatten does not produce a cleaner set of books than reality.
    """
    portfolio = await portfolio_service.get_or_create_portfolio(db)
    snapshot = market_feed.snapshot()
    positions = await portfolio_service.open_positions(db, portfolio.id)

    closed, skipped = [], []
    for pos in positions:
        obs = snapshot.get(pos.symbol)
        if obs is None or obs.is_stale(60.0):
            skipped.append(
                {"symbol": pos.symbol, "reason": "no fresh price to close against"}
            )
            continue
        decision = await market_orchestrator.evaluate_action(
            db, portfolio, pos.symbol, pos.side, "close", snapshot,
            trigger="operator_flatten", existing_position=pos,
        )
        closed.append({"symbol": pos.symbol, "decision_id": decision.id})

    return {"closed": closed, "skipped": skipped, "reason": reason}


# --------------------------------------------------------------------- #
# Adaptation
# --------------------------------------------------------------------- #

@router.get("/agents/performance")
async def get_agent_performance(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Each expert's realised track record and its current consensus weight.

    A weight that has moved away from its baseline is direct evidence the
    system adapted to outcomes rather than running a fixed strategy.
    """
    result = await db.execute(select(AgentPerformance).order_by(AgentPerformance.agent_name))
    records = list(result.scalars().all())
    return [
        {
            "agent_name": r.agent_name,
            "base_weight": r.base_weight,
            "current_weight": r.current_weight,
            "weight_drift": round(r.current_weight - r.base_weight, 4),
            "votes_cast": r.votes_cast or 0,
            "positions_influenced": r.positions_influenced,
            "correct_calls": r.correct_calls,
            "incorrect_calls": r.incorrect_calls,
            "hit_rate": round(r.hit_rate, 3),
            "hallucinations_detected": r.hallucinations_detected or 0,
            "hallucination_rate": round((r.hallucinations_detected or 0) / r.votes_cast, 4) if r.votes_cast else 0.0,
            "min_samples": settings.ADAPTATION_MIN_SAMPLES,
            "attributed_pnl": float(r.attributed_pnl),
            "avg_confidence_when_right": round(r.avg_confidence_when_right, 3),
            "avg_confidence_when_wrong": round(r.avg_confidence_when_wrong, 3),
            "adaptive": r.agent_name not in adaptation.NON_ADAPTIVE_AGENTS,
            "last_adapted_at": r.last_adapted_at.isoformat()
            if r.last_adapted_at
            else None,
        }
        for r in records
    ]
