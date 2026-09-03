"""
Portfolio state.

Derives NAV, exposure and drawdown from the ledger and the open positions, and
renders the capital picture the expert agents reason over. Also owns the
drawdown circuit breaker — the one place the desk stops itself.
"""
import logging
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.execution import unrealized_pnl
from app.ledger import ACCOUNT_CASH, ledger
from app.market.types import MarketSnapshot
from app.models.portfolio import Portfolio
from app.models.position import Position

logger = logging.getLogger(__name__)
settings = get_settings()

DEFAULT_PORTFOLIO_NAME = "autonomous-desk"


def default_constraints() -> dict:
    """The human-defined envelope the agent operates inside."""
    return {
        "max_exposure_pct": settings.MAX_EXPOSURE_PCT,
        "max_position_pct": settings.MAX_POSITION_PCT,
        "max_drawdown_pct": settings.MAX_DRAWDOWN_PCT,
        "target_vol": settings.TARGET_VOL,
        "min_edge_bps": settings.MIN_EDGE_BPS,
        "fee_bps": settings.FEE_BPS,
    }


async def get_or_create_portfolio(
    db: AsyncSession, name: str = DEFAULT_PORTFOLIO_NAME
) -> Portfolio:
    result = await db.execute(select(Portfolio).where(Portfolio.name == name))
    portfolio = result.scalar_one_or_none()
    if portfolio:
        return portfolio

    capital = Decimal(str(settings.STARTING_CAPITAL))
    portfolio = Portfolio(
        name=name,
        base_currency=settings.BASE_CURRENCY,
        starting_capital=capital,
        cash=capital,
        peak_nav=capital,
        constraints=default_constraints(),
    )
    db.add(portfolio)
    await db.flush()

    # Opening capital is a real ledger movement, not an assumed balance.
    await ledger.post_transfer(
        db,
        portfolio.id,
        "external_funding",
        ACCOUNT_CASH,
        capital,
        "initial_funding",
        f"Opening capital for {name}",
    )
    logger.info(
        f"[Portfolio] created '{name}' with {settings.BASE_CURRENCY} {capital:,.2f}"
    )
    return portfolio


async def open_positions(db: AsyncSession, portfolio_id: str) -> list[Position]:
    result = await db.execute(
        select(Position).where(
            Position.portfolio_id == portfolio_id, Position.status == "open"
        )
    )
    return list(result.scalars().all())


async def compute_state(
    db: AsyncSession, portfolio: Portfolio, snapshot: MarketSnapshot
) -> dict:
    """
    The capital picture, marked to the current market.

    Positions whose instrument has no fresh observation are marked at entry and
    flagged, rather than silently marked at a stale price.
    """
    positions = await open_positions(db, portfolio.id)
    cash = Decimal(str(portfolio.cash))

    gross_exposure = Decimal("0")
    total_unrealized = Decimal("0")
    unmarked: list[str] = []
    rendered: list[dict] = []

    for pos in positions:
        obs = snapshot.get(pos.symbol)
        if obs and not obs.is_stale(settings.MARKET_STALENESS_SECONDS):
            mark = obs.price
        else:
            mark = float(pos.entry_price)
            unmarked.append(pos.symbol)

        upnl = unrealized_pnl(pos, mark)
        notional = pos.quantity * Decimal(str(mark))
        gross_exposure += abs(notional)
        total_unrealized += upnl

        entry_value = pos.quantity * pos.entry_price
        rendered.append(
            {
                "id": pos.id,
                "symbol": pos.symbol,
                "side": pos.side,
                "quantity": float(pos.quantity),
                "entry_price": float(pos.entry_price),
                "mark_price": mark,
                "notional": float(notional),
                "unrealized_pnl": float(upnl),
                "unrealized_pnl_pct": float(upnl / entry_value) if entry_value else 0.0,
                "stop_price": float(pos.stop_price) if pos.stop_price else None,
                "target_price": float(pos.target_price) if pos.target_price else None,
                "age_seconds": (
                    datetime.now(timezone.utc) - _aware(pos.opened_at)
                ).total_seconds(),
                "reassessment_count": pos.reassessment_count,
                "thesis": pos.thesis,
                "marked_at_entry": pos.symbol in unmarked,
            }
        )

    nav = cash + gross_exposure + total_unrealized
    peak = max(Decimal(str(portfolio.peak_nav)), nav)
    drawdown = float((peak - nav) / peak) if peak > 0 else 0.0
    constraints = portfolio.constraints or default_constraints()

    return {
        "portfolio_id": portfolio.id,
        # Every figure below is in this currency. The console formats from it
        # rather than assuming dollars.
        "currency": portfolio.base_currency or settings.BASE_CURRENCY,
        "nav": float(nav),
        "cash": float(cash),
        "gross_exposure": float(gross_exposure),
        "exposure_pct": float(gross_exposure / nav) if nav > 0 else 0.0,
        "unrealized_pnl": float(total_unrealized),
        "realized_pnl": float(portfolio.realized_pnl),
        "total_fees_paid": float(portfolio.total_fees_paid),
        "total_slippage_paid": float(portfolio.total_slippage_paid),
        "peak_nav": float(peak),
        "drawdown_pct": drawdown,
        "open_position_count": len(positions),
        "positions": rendered,
        "positions_marked_at_entry": unmarked,
        "halted": portfolio.halted,
        "halt_reason": portfolio.halt_reason,
        "starting_capital": float(portfolio.starting_capital),
        "return_pct": (
            float((nav - portfolio.starting_capital) / portfolio.starting_capital)
            if portfolio.starting_capital
            else 0.0
        ),
        # Constraints travel with the state so every decision records the limits
        # it was made under.
        "max_exposure_pct": constraints.get("max_exposure_pct", settings.MAX_EXPOSURE_PCT),
        "max_position_pct": constraints.get("max_position_pct", settings.MAX_POSITION_PCT),
        "max_drawdown_pct": constraints.get("max_drawdown_pct", settings.MAX_DRAWDOWN_PCT),
        "constraints": constraints,
    }


async def update_high_water_mark(
    db: AsyncSession, portfolio: Portfolio, state: dict
) -> None:
    nav = Decimal(str(state["nav"]))
    if nav > portfolio.peak_nav:
        portfolio.peak_nav = nav


async def check_drawdown_breaker(
    db: AsyncSession, portfolio: Portfolio, state: dict
) -> bool:
    """
    Halt the desk when losses from the high-water mark breach the limit.

    Halting blocks new positions only. Existing risk can still be closed —
    trapping the desk in its positions would make the breaker actively harmful.
    Returns True when the desk is halted.
    """
    limit = (portfolio.constraints or {}).get(
        "max_drawdown_pct", settings.MAX_DRAWDOWN_PCT
    )
    drawdown = state["drawdown_pct"]

    if drawdown >= limit and not portfolio.halted:
        portfolio.halted = True
        portfolio.halt_reason = (
            f"Drawdown of {drawdown:.2%} breached the {limit:.0%} limit at "
            f"{datetime.now(timezone.utc).isoformat()}. New positions are blocked; "
            f"existing positions may still be closed."
        )
        logger.error(f"[Portfolio] HALTED — {portfolio.halt_reason}")
        return True

    # Recover only once well clear of the limit, so the desk cannot oscillate
    # in and out of halt on noise.
    if portfolio.halted and drawdown < limit * 0.7:
        logger.info(
            f"[Portfolio] drawdown recovered to {drawdown:.2%}; resuming from halt"
        )
        portfolio.halted = False
        portfolio.halt_reason = None
        return False

    return portfolio.halted


async def set_constraints(
    db: AsyncSession, portfolio: Portfolio, updates: dict
) -> dict:
    """
    Apply a human constraint change.

    Values are clamped to sane bounds so a mistyped or misheard instruction —
    a voice command in particular — cannot hand the agent unlimited leverage.
    """
    bounds = {
        "max_exposure_pct": (0.0, 1.0),
        "max_position_pct": (0.0, 0.5),
        "max_drawdown_pct": (0.01, 0.5),
        "target_vol": (0.01, 2.0),
        "min_edge_bps": (0.0, 500.0),
        "fee_bps": (0.0, 200.0),
    }

    current = dict(portfolio.constraints or default_constraints())
    applied, rejected = {}, {}

    for key, value in updates.items():
        if key not in bounds:
            rejected[key] = "unknown constraint"
            continue
        try:
            value = float(value)
        except (TypeError, ValueError):
            rejected[key] = "not a number"
            continue
        low, high = bounds[key]
        if not (low <= value <= high):
            rejected[key] = f"outside permitted range {low}-{high}"
            continue
        current[key] = value
        applied[key] = value

    if applied:
        portfolio.constraints = current
        logger.info(f"[Portfolio] constraints updated: {applied}")

    return {"applied": applied, "rejected": rejected, "constraints": current}


def _aware(dt: datetime) -> datetime:
    """Treat a naive timestamp from the database as UTC."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
