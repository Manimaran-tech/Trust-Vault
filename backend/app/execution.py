"""
Market execution.

Identifying an opportunity and capturing it are different problems. This module
handles the second: it crosses the book at a realistic price, charges fees and
slippage, writes the resulting cash movements to the ledger, and records what
was expected versus what was actually paid.

Every open and close flows through here, so the difference between the desk's
modelled cost and its realised cost is always measurable rather than assumed.
"""
import logging
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.ledger import (
    ACCOUNT_CASH,
    ACCOUNT_FEES,
    ACCOUNT_PNL,
    ACCOUNT_POSITIONS,
    ACCOUNT_SLIPPAGE,
    ledger,
)
from app.market.indicators import estimate_slippage_bps
from app.market.types import Observation
from app.models.portfolio import Portfolio
from app.models.position import Fill, Position

logger = logging.getLogger(__name__)
settings = get_settings()


class ExecutionError(Exception):
    """Raised when an order cannot be executed at all."""


async def open_position(
    db: AsyncSession,
    portfolio: Portfolio,
    symbol: str,
    side: str,
    quantity: float,
    obs: Observation,
    expected_slippage_bps: float,
    expected_edge_bps: float,
    stop_price: float,
    target_price: float,
    thesis: str,
    decision_id: str | None,
    agent_votes: dict | None = None,
) -> Position:
    """Cross the book to establish a position, then record the money movement."""
    if quantity <= 0:
        raise ExecutionError("Refusing to execute a non-positive quantity")
    if obs.price <= 0:
        raise ExecutionError("No usable reference price")

    reference_price = obs.price
    notional = quantity * reference_price

    fill_price, realized_slippage_bps = _cross_book(
        side="buy" if side == "long" else "sell",
        reference_price=reference_price,
        notional=notional,
        obs=obs,
    )

    gross = Decimal(str(quantity * fill_price))
    fee = gross * Decimal(str(settings.FEE_BPS / 10_000))
    slippage_cost = Decimal(str(abs(fill_price - reference_price) * quantity))

    if gross + fee > portfolio.cash:
        raise ExecutionError(
            f"Fill of ${gross:,.2f} plus ${fee:,.2f} fee exceeds available cash of "
            f"${portfolio.cash:,.2f}"
        )

    position = Position(
        portfolio_id=portfolio.id,
        symbol=symbol,
        side=side,
        quantity=Decimal(str(quantity)),
        entry_price=Decimal(str(fill_price)),
        notional=gross,
        fees_paid=fee,
        slippage_paid=slippage_cost,
        status="open",
        entry_volatility=obs.volatility,
        entry_sigma=obs.sigma,
        entry_spread_bps=obs.spread_bps,
        expected_edge_bps=expected_edge_bps,
        stop_price=Decimal(str(stop_price)) if stop_price else None,
        target_price=Decimal(str(target_price)) if target_price else None,
        opening_decision_id=decision_id,
        entry_agent_votes=agent_votes or {},
        thesis=thesis,
    )
    db.add(position)
    await db.flush()

    db.add(
        Fill(
            position_id=position.id,
            symbol=symbol,
            side="buy" if side == "long" else "sell",
            quantity=Decimal(str(quantity)),
            reference_price=Decimal(str(reference_price)),
            fill_price=Decimal(str(fill_price)),
            expected_slippage_bps=expected_slippage_bps,
            realized_slippage_bps=realized_slippage_bps,
            fee=fee,
            venue=ledger.name,
        )
    )

    # Cash leaves, position value arrives; the fee is a separate movement so it
    # is never buried inside the position's cost basis.
    await ledger.post_transfer(
        db, portfolio.id, ACCOUNT_CASH, ACCOUNT_POSITIONS, gross,
        "position_open",
        f"Open {side} {quantity:.8f} {symbol} @ {fill_price:,.4f}",
        position_id=position.id,
    )
    await ledger.post_transfer(
        db, portfolio.id, ACCOUNT_CASH, ACCOUNT_FEES, fee,
        "execution_fee",
        f"Fee on opening {symbol}",
        position_id=position.id,
    )
    if slippage_cost > 0:
        await ledger.post_transfer(
            db, portfolio.id, ACCOUNT_POSITIONS, ACCOUNT_SLIPPAGE, slippage_cost,
            "slippage",
            f"Slippage on opening {symbol}",
            position_id=position.id,
        )

    portfolio.cash -= gross + fee
    portfolio.total_fees_paid += fee
    portfolio.total_slippage_paid += slippage_cost

    logger.info(
        f"[Execution] OPEN {side} {quantity:.6f} {symbol} @ {fill_price:,.4f} "
        f"(ref {reference_price:,.4f}, slippage {realized_slippage_bps:.1f} bps "
        f"vs {expected_slippage_bps:.1f} expected)"
    )
    return position


async def close_position(
    db: AsyncSession,
    portfolio: Portfolio,
    position: Position,
    obs: Observation,
    reason: str,
    decision_id: str | None = None,
) -> Position:
    """Unwind a position and realise its P&L."""
    if position.status != "open":
        raise ExecutionError(f"Position {position.id[:8]} is already {position.status}")
    if obs.price <= 0:
        raise ExecutionError("No usable reference price to close against")

    quantity = float(position.quantity)
    reference_price = obs.price
    notional = quantity * reference_price
    expected_slippage_bps = estimate_slippage_bps(
        notional, obs.depth_quote, obs.spread_bps
    )

    # Closing crosses the book the other way.
    fill_price, realized_slippage_bps = _cross_book(
        side="sell" if position.side == "long" else "buy",
        reference_price=reference_price,
        notional=notional,
        obs=obs,
    )

    proceeds = Decimal(str(quantity * fill_price))
    fee = proceeds * Decimal(str(settings.FEE_BPS / 10_000))
    slippage_cost = Decimal(str(abs(fill_price - reference_price) * quantity))

    entry_value = position.quantity * position.entry_price
    if position.side == "long":
        gross_pnl = proceeds - entry_value
    else:
        gross_pnl = entry_value - proceeds
    net_pnl = gross_pnl - fee

    db.add(
        Fill(
            position_id=position.id,
            symbol=position.symbol,
            side="sell" if position.side == "long" else "buy",
            quantity=position.quantity,
            reference_price=Decimal(str(reference_price)),
            fill_price=Decimal(str(fill_price)),
            expected_slippage_bps=expected_slippage_bps,
            realized_slippage_bps=realized_slippage_bps,
            fee=fee,
            venue=ledger.name,
        )
    )

    await ledger.post_transfer(
        db, portfolio.id, ACCOUNT_POSITIONS, ACCOUNT_CASH, entry_value,
        "position_close",
        f"Close {position.side} {quantity:.8f} {position.symbol} @ {fill_price:,.4f}",
        position_id=position.id,
    )
    await ledger.post_transfer(
        db, portfolio.id, ACCOUNT_CASH, ACCOUNT_FEES, fee,
        "execution_fee",
        f"Fee on closing {position.symbol}",
        position_id=position.id,
    )
    if gross_pnl != 0:
        # A gain credits cash from P&L; a loss runs the same movement in reverse.
        if gross_pnl > 0:
            await ledger.post_transfer(
                db, portfolio.id, ACCOUNT_PNL, ACCOUNT_CASH, gross_pnl,
                "realized_gain", f"Realised gain on {position.symbol}",
                position_id=position.id,
            )
        else:
            await ledger.post_transfer(
                db, portfolio.id, ACCOUNT_CASH, ACCOUNT_PNL, -gross_pnl,
                "realized_loss", f"Realised loss on {position.symbol}",
                position_id=position.id,
            )

    position.status = "closed"
    position.exit_price = Decimal(str(fill_price))
    position.realized_pnl = net_pnl
    position.fees_paid += fee
    position.slippage_paid += slippage_cost
    position.closed_at = datetime.now(timezone.utc)
    position.close_reason = reason
    position.closing_decision_id = decision_id

    portfolio.cash += entry_value + gross_pnl - fee
    portfolio.realized_pnl += net_pnl
    portfolio.total_fees_paid += fee
    portfolio.total_slippage_paid += slippage_cost

    logger.info(
        f"[Execution] CLOSE {position.side} {position.symbol} @ {fill_price:,.4f} "
        f"P&L {float(net_pnl):+,.2f} ({reason})"
    )
    return position


def _cross_book(
    side: str, reference_price: float, notional: float, obs: Observation
) -> tuple[float, float]:
    """
    Determine the price actually achieved.

    A buy lifts the offer and pays impact above mid; a sell hits the bid and
    pays impact below. The desk never fills at mid, which is precisely the gap
    between a decision and its outcome.
    """
    slippage_bps = estimate_slippage_bps(notional, obs.depth_quote, obs.spread_bps)
    direction = 1 if side == "buy" else -1
    fill_price = reference_price * (1 + direction * slippage_bps / 10_000)
    return fill_price, slippage_bps


def unrealized_pnl(position: Position, mark_price: float) -> Decimal:
    """Mark an open position to the current price."""
    quantity = position.quantity
    entry = position.entry_price
    mark = Decimal(str(mark_price))
    if position.side == "long":
        return quantity * (mark - entry)
    return quantity * (entry - mark)
