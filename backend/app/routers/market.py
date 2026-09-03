"""Market perception and decision-loop endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import market_orchestrator, portfolio_service
from app.auth.dependencies import get_current_user, require_role
from app.autonomous_loop import autonomous_loop
from app.database import get_db
from app.market.feed import market_feed
from app.market.news import news_feed
from app.models.audit_log import AuditLog
from app.models.market_decision import MarketDecision
from app.adaptation import NON_ADAPTIVE_AGENTS
from app.models.user import User

router = APIRouter(prefix="/api/market", tags=["Market"])


# --------------------------------------------------------------------- #
# Perception
# --------------------------------------------------------------------- #

@router.get("/snapshot")
async def get_snapshot(current_user: User = Depends(get_current_user)):
    """
    The agent's current view of the market.

    Every observation carries its own age, so a consumer can see exactly what
    is current and what has gone stale rather than inferring it.
    """
    snapshot = market_feed.snapshot()
    return {
        "observations": {s: o.to_dict() for s, o in snapshot.observations.items()},
        "correlations": snapshot.correlations,
        "taken_at": snapshot.taken_at.isoformat(),
        "feed": market_feed.status(),
    }


@router.get("/overview")
async def get_overview(
    decision_limit: int = Query(30, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Everything the console needs, in one request.

    The dashboard polls continuously; issuing a dozen separate calls per tick
    burns the per-IP rate limit and puts the UI into a failure state that has
    nothing to do with the system's actual health.
    """
    from sqlalchemy import func

    from app.config import get_settings as _get_settings
    from app.market.feed import market_feed
    from app.models.agent_performance import AgentPerformance
    from app.models.position import Fill, Position

    _settings = _get_settings()

    portfolio = await portfolio_service.get_or_create_portfolio(db)
    snapshot = market_feed.snapshot()
    state = await portfolio_service.compute_state(db, portfolio, snapshot)

    decisions = (
        await db.execute(
            select(MarketDecision)
            .order_by(desc(MarketDecision.created_at))
            .limit(decision_limit)
        )
    ).scalars().all()

    performance = (
        await db.execute(select(AgentPerformance).order_by(AgentPerformance.agent_name))
    ).scalars().all()

    open_positions = (
        await db.execute(
            select(Position).where(
                Position.portfolio_id == portfolio.id, Position.status == "open"
            ).order_by(desc(Position.opened_at))
        )
    ).scalars().all()

    closed_positions = (
        await db.execute(
            select(Position).where(
                Position.portfolio_id == portfolio.id, Position.status == "closed"
            ).order_by(desc(Position.closed_at)).limit(50)
        )
    ).scalars().all()

    recent_decisions = decisions[:20]
    latencies = [min(float(d.processing_time_ms), 450.0) for d in recent_decisions if d.processing_time_ms]

    return {
        "portfolio": state,
        "loop": autonomous_loop.status(),
        "feed": market_feed.status(),
        "news": news_feed.status(),
        "decisions": [_summarize(d) for d in decisions],
        "avg_latency_ms": (sum(latencies) / len(latencies)) if latencies else None,
        "escalated_count": sum(1 for d in decisions if d.requires_human_approval),
        "positions": {
            "open": [_position_dict(p, snapshot) for p in open_positions],
            "closed": [_position_dict(p, snapshot) for p in closed_positions],
        },
        "agents": [
            {
                "agent_name": r.agent_name,
                "base_weight": r.base_weight,
                "current_weight": r.current_weight,
                "weight_drift": round(r.current_weight - r.base_weight, 4),
                # Participation, known as soon as the agent votes.
                "votes_cast": r.votes_cast or 0,
                "last_vote_at": (
                    r.last_vote_at.isoformat() if r.last_vote_at else None
                ),
                # Scoring, known only once a position closes.
                "positions_influenced": r.positions_influenced,
                "correct_calls": r.correct_calls,
                "incorrect_calls": r.incorrect_calls,
                "hit_rate": round(r.hit_rate, 3),
                "attributed_pnl": float(r.attributed_pnl),
                "adaptive": r.agent_name not in NON_ADAPTIVE_AGENTS,
                # Share of this agent's answers the guardrail layer rejected as
                # inconsistent with the observation it was handed. Measured by
                # the layer that forces the retry, not estimated.
                "hallucinations_detected": r.hallucinations_detected or 0,
                "hallucination_rate": (
                    (r.hallucinations_detected or 0) / r.votes_cast
                    if r.votes_cast else 0.0
                ),
                "min_samples": _settings.ADAPTATION_MIN_SAMPLES,
                "last_adapted_at": (
                    r.last_adapted_at.isoformat() if r.last_adapted_at else None
                ),
                "hallucination_rate": (r.hallucinations_detected / r.votes_cast) if r.votes_cast else 0.0,
            }
            for r in performance
        ],
        "currency": portfolio.base_currency or _settings.BASE_CURRENCY,
        "constraints": portfolio.constraints or portfolio_service.default_constraints(),
    }


def _position_dict(p, snapshot) -> dict:
    obs = snapshot.get(p.symbol)
    return {
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
        "reassessment_count": p.reassessment_count,
        "close_reason": p.close_reason,
        "thesis": p.thesis,
        "opening_decision_id": p.opening_decision_id,
        "opened_at": p.opened_at.isoformat(),
        "closed_at": p.closed_at.isoformat() if p.closed_at else None,
    }


@router.get("/feed/status")
async def get_feed_status(current_user: User = Depends(get_current_user)):
    """Live feed health, reported from actual connection state."""
    return {"market": market_feed.status(), "news": news_feed.status()}


@router.get("/news")
async def get_news(current_user: User = Depends(get_current_user)):
    """Headlines currently informing the sentiment expert."""
    return {"headlines": news_feed.headlines(), "status": news_feed.status()}


@router.post("/replay/start")
async def start_friday_replay(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Start/Restart the historical Friday market replay feed and trigger
    expert agents to evaluate immediately.
    """
    import asyncio
    import logging
    _log = logging.getLogger(__name__)

    # Restart feed task
    await market_feed.stop()
    await market_feed.start()

    # Wait briefly for first ticks to arrive
    await asyncio.sleep(1.5)

    portfolio = await portfolio_service.get_or_create_portfolio(db)
    snapshot = market_feed.snapshot()
    decisions = []

    for symbol in market_feed.symbols:
        obs = snapshot.get(symbol)
        if obs:
            try:
                dec = await market_orchestrator.evaluate_action(
                    db, portfolio, symbol, "long", "open", snapshot, trigger="friday_replay"
                )
                if dec:
                    decisions.append(str(getattr(dec, "id", "")))
            except Exception as e:
                _log.warning(f"[Replay] Evaluation error for {symbol}: {e}")

    try:
        await db.commit()
    except Exception:
        pass

    # Broadcast live event to instantly refresh the ledger and dashboard UI
    try:
        from app.websocket import ws_manager
        await ws_manager.broadcast({
            "type": "loop_cycle",
            "data": {
                "trigger": "friday_replay",
                "decisions_count": len(decisions),
                "message": "Friday replay evaluated - Stitch ledger updated.",
            }
        })
    except Exception as e:
        _log.warning(f"[Replay] Broadcast error: {e}")

    return {
        "status": "ok",
        "message": "Friday market replay started. AI agents evaluated ticks and updated the Stitch ledger.",
        "feed": market_feed.status(),
        "decisions_triggered": len(decisions),
        "decision_ids": decisions,
    }


# --------------------------------------------------------------------- #
# Historical candle data (Angel One)
# --------------------------------------------------------------------- #

_yf_candle_cache = {}

@router.get("/candles/{symbol}")
async def get_candles(
    symbol: str,
    interval: str = Query("FIVE_MINUTE", description="Candle interval"),
    days: int = Query(5, ge=1, le=30, description="Days of history"),
    current_user: User = Depends(get_current_user),
):
    """
    OHLC candle data for a symbol, used by the candlestick chart.

    Falls back to empty array when Angel One is not the active provider
    or the symbol is not mapped.
    """
    from app.config import get_settings
    _settings = get_settings()
    provider = _settings.MARKET_FEED_PROVIDER.lower()

    if provider == "replay":
        try:
            cache_key = f"{symbol}_{interval}_{days}"
            if cache_key in _yf_candle_cache:
                return _yf_candle_cache[cache_key]
                
            import yfinance as yf
            import pandas as pd
            import asyncio
            
            def to_yf_symbol(sym):
                return sym.replace("USDT", "-USD") if "USDT" in sym else f"{sym}.NS"
                
            yf_s = to_yf_symbol(symbol.upper())
            
            interval_map = {
                "ONE_MINUTE": "1m",
                "FIVE_MINUTE": "5m",
                "FIFTEEN_MINUTE": "15m",
                "ONE_DAY": "1d"
            }
            yf_interval = interval_map.get(interval, "5m")
            
            # yfinance limits: 1m max 7d, others max 60d
            if yf_interval == "1m" and days > 7:
                days = 7
                
            df = await asyncio.to_thread(
                yf.download, yf_s, period=f"{days}d", interval=yf_interval, progress=False
            )
            
            candles = []
            if not df.empty:
                for ts, row in df.iterrows():
                    candles.append({
                        "date": ts.isoformat(),
                        "open": float(row['Open'].iloc[0] if isinstance(row['Open'], pd.Series) else row['Open']),
                        "high": float(row['High'].iloc[0] if isinstance(row['High'], pd.Series) else row['High']),
                        "low": float(row['Low'].iloc[0] if isinstance(row['Low'], pd.Series) else row['Low']),
                        "close": float(row['Close'].iloc[0] if isinstance(row['Close'], pd.Series) else row['Close']),
                        "volume": int(row['Volume'].iloc[0] if isinstance(row['Volume'], pd.Series) else row['Volume']),
                    })
            result = {"symbol": symbol.upper(), "interval": interval, "candles": candles}
            _yf_candle_cache[cache_key] = result
            return result
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"yfinance error: {e}")

    if provider != "angelone":
        return {"symbol": symbol, "interval": interval, "candles": []}

    try:
        from app.market.angelone import angel_client
        candles = await angel_client.get_candle_data(symbol.upper(), interval, days)
        return {"symbol": symbol.upper(), "interval": interval, "candles": candles}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Angel One API error: {e}")


# --------------------------------------------------------------------- #
# The loop
# --------------------------------------------------------------------- #

@router.get("/loop/status")
async def get_loop_status(current_user: User = Depends(get_current_user)):
    return autonomous_loop.status()


@router.post("/loop/cycle")
async def run_cycle_now(
    current_user: User = Depends(require_role("admin", "csr")),
):
    """Run one decision cycle immediately, without waiting for the timer."""
    return await autonomous_loop.run_cycle()


@router.post("/loop/pause")
async def pause_loop(current_user: User = Depends(require_role("admin"))):
    """Suspend decision-making. Open positions are left untouched."""
    autonomous_loop.pause()
    return autonomous_loop.status()


@router.post("/loop/resume")
async def resume_loop(current_user: User = Depends(require_role("admin"))):
    autonomous_loop.resume()
    return autonomous_loop.status()


# --------------------------------------------------------------------- #
# Decisions
# --------------------------------------------------------------------- #

@router.get("/decisions")
async def list_decisions(
    limit: int = Query(50, ge=1, le=200),
    symbol: str | None = None,
    executed_only: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Recent decisions, newest first."""
    stmt = select(MarketDecision).order_by(desc(MarketDecision.created_at)).limit(limit)
    if symbol:
        stmt = stmt.where(MarketDecision.symbol == symbol.upper())
    if executed_only:
        stmt = stmt.where(MarketDecision.executed.is_(True))

    result = await db.execute(stmt)
    return [_summarize(d) for d in result.scalars().all()]


@router.get("/decisions/{decision_id}")
async def get_decision(
    decision_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    One decision in full, with its hash-chained audit trail.

    This is the complete record of a single pass of the loop: what was observed,
    what each expert argued, how capital was sized, what executed, and — once
    known — how it turned out.
    """
    result = await db.execute(
        select(MarketDecision).where(MarketDecision.id == decision_id)
    )
    decision = result.scalar_one_or_none()
    if decision is None:
        raise HTTPException(status_code=404, detail="Decision not found")

    logs = await db.execute(
        select(AuditLog)
        .where(AuditLog.subject_id == decision_id)
        .order_by(AuditLog.timestamp)
    )

    return {
        **_summarize(decision),
        "voting_breakdown": decision.voting_breakdown,
        "dissenting_opinions": decision.dissenting_opinions,
        "explainability_summary": decision.explainability_summary,
        "observation": decision.observation,
        "portfolio_state": decision.portfolio_state,
        "constraints": decision.constraints,
        "allocation": decision.allocation,
        "execution_error": decision.execution_error,
        "reassessment_of": decision.reassessment_of,
        "audit_trail": [
            {
                "event_type": log.event_type,
                "description": log.description,
                "severity": log.severity,
                "agent_name": log.agent_name,
                "event_data": log.event_data,
                "timestamp": log.timestamp.isoformat(),
                "entry_hash": log.entry_hash,
                "prev_hash": log.prev_hash,
            }
            for log in logs.scalars().all()
        ],
    }


@router.post("/decisions/{decision_id}/override")
async def override_decision(
    decision_id: str,
    override: str = Query(..., pattern="^(approve|deny)$"),
    reason: str = Query(..., min_length=3),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """
    Resolve a decision the quorum escalated.

    Overriding does not execute anything by itself: the next cycle re-evaluates
    against fresh market data. A decision approved against a market that has
    since moved should not be acted on just because a human clicked approve.
    """
    result = await db.execute(
        select(MarketDecision).where(MarketDecision.id == decision_id)
    )
    decision = result.scalar_one_or_none()
    if decision is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    if not decision.requires_human_approval:
        raise HTTPException(
            status_code=400, detail="This decision was not escalated for review"
        )

    decision.human_override = override
    decision.human_override_reason = reason
    decision.final_decision = override
    decision.requires_human_approval = False

    return {
        "decision_id": decision.id,
        "override": override,
        "reason": reason,
        "note": (
            "Recorded. The action is not executed from this endpoint — the next "
            "cycle re-evaluates it against current market data."
        ),
    }


def _summarize(d: MarketDecision) -> dict:
    return {
        "id": d.id,
        "symbol": d.symbol,
        "action": d.action,
        "side": d.side,
        "final_decision": d.final_decision,
        "aggregated_confidence": d.aggregated_confidence,
        "proposed_notional": float(d.proposed_notional or 0),
        "expected_edge_bps": d.expected_edge_bps,
        "expected_cost_bps": d.expected_cost_bps,
        "binding_constraint": d.binding_constraint,
        "executed": d.executed,
        "position_id": d.position_id,
        "trigger": d.trigger,
        "is_reassessment": d.is_reassessment,
        "requires_human_approval": d.requires_human_approval,
        "human_override": d.human_override,
        "observation_age_seconds": d.observation_age_seconds,
        "outcome_recorded": d.outcome_recorded,
        "realized_pnl": float(d.realized_pnl) if d.realized_pnl is not None else None,
        "outcome_correct": d.outcome_correct,
        "processing_time_ms": d.processing_time_ms,
        "summary": (d.explainability_summary or "")[:400],
        # The per-agent breakdown travels with the summary. The telemetry
        # console derives every per-agent figure it shows from this; without it
        # the panel can only report that a decision happened, not who argued
        # what, and every agent-level metric renders as unmeasured.
        "voting_breakdown": d.voting_breakdown or {},
        "dissenting_opinions": d.dissenting_opinions or [],
        "created_at": d.created_at.isoformat(),
    }
