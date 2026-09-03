"""
The autonomous decision loop.

A single long-running task that keeps the desk current. Each cycle it:

  1. takes a fresh snapshot of the market
  2. marks the book and checks the drawdown breaker
  3. reassesses every open position — a decision made two minutes ago is not
     assumed to still hold
  4. looks for new opportunities among instruments the desk is not yet in
  5. lets outcomes from anything that closed feed back into agent weights

Reassessment is deliberately not on a fixed timer alone. A position is re-run
when price has moved materially in sigma terms, when it hits its stop or target,
when its data goes stale, or when it has simply not been examined recently —
whichever comes first. That is what makes this a loop that responds to the
market rather than a scheduler that happens to run near it.
"""
import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app import market_orchestrator, portfolio_service
from app.allocator import estimate_edge_bps
from app.config import get_settings
from app.database import async_session_factory
from app.market.feed import market_feed
from app.market.types import MarketSnapshot, Observation
from app.models.portfolio import Portfolio
from app.models.position import Position
from app.ws_manager import ws_manager

logger = logging.getLogger(__name__)
settings = get_settings()

# A position is re-examined at least this often even when nothing has moved.
MAX_SECONDS_BETWEEN_REASSESSMENTS = 300
# Do not chase the same instrument repeatedly within one cooldown.
NEW_ENTRY_COOLDOWN_SECONDS = 60


class AutonomousLoop:
    """Owns the continuous observe-reason-act-adapt cycle."""

    def __init__(self):
        self._task: asyncio.Task | None = None
        self._running = False
        self._cycles = 0
        self._last_cycle_at: datetime | None = None
        self._last_error: str | None = None
        self._last_entry_attempt: dict[str, datetime] = {}
        self._paused = False

    # ---------------------------------------------------------------- #
    # Lifecycle
    # ---------------------------------------------------------------- #

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._run())
        logger.info(
            f"[AutonomousLoop] started, cycle every "
            f"{settings.DECISION_INTERVAL_SECONDS}s"
        )

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("[AutonomousLoop] stopped")

    def pause(self) -> None:
        """Suspend decision-making without tearing down the loop."""
        self._paused = True
        logger.info("[AutonomousLoop] paused by operator")

    def resume(self) -> None:
        self._paused = False
        logger.info("[AutonomousLoop] resumed by operator")

    async def _run(self) -> None:
        while self._running:
            try:
                if not self._paused:
                    await self.run_cycle()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self._last_error = str(e)
                logger.exception(f"[AutonomousLoop] cycle failed: {e}")
            await asyncio.sleep(settings.DECISION_INTERVAL_SECONDS)

    # ---------------------------------------------------------------- #
    # One cycle
    # ---------------------------------------------------------------- #

    async def run_cycle(self) -> dict:
        """Run a single pass. Also callable on demand from the API."""
        snapshot = market_feed.snapshot()
        if not snapshot.observations:
            return {"status": "waiting_for_market_data", "decisions": 0}

        async with async_session_factory() as db:
            try:
                portfolio = await portfolio_service.get_or_create_portfolio(db)
                state = await portfolio_service.compute_state(db, portfolio, snapshot)
                await portfolio_service.update_high_water_mark(db, portfolio, state)
                halted = await portfolio_service.check_drawdown_breaker(
                    db, portfolio, state
                )

                decisions = []
                # Open risk is reassessed first, and is reassessed even when the
                # desk is halted — the breaker blocks new exposure, it does not
                # trap existing exposure.
                decisions += await self._reassess_open(db, portfolio, snapshot)

                if not halted:
                    decisions += await self._seek_new(db, portfolio, snapshot)

                await db.commit()

                self._cycles += 1
                self._last_cycle_at = datetime.now(timezone.utc)
                self._last_error = None

                await ws_manager.broadcast(
                    {
                        "type": "loop_cycle",
                        "data": {
                            "cycle": self._cycles,
                            "decisions": len(decisions),
                            "halted": halted,
                            "nav": state["nav"],
                            "exposure_pct": state["exposure_pct"],
                            "open_positions": state["open_position_count"],
                        },
                    }
                )
                return {
                    "status": "halted" if halted else "ok",
                    "cycle": self._cycles,
                    "decisions": len(decisions),
                    "decision_ids": decisions,
                }

            except Exception:
                await db.rollback()
                raise

    # ---------------------------------------------------------------- #
    # Reassessment of open risk
    # ---------------------------------------------------------------- #

    async def _reassess_open(
        self, db: AsyncSession, portfolio: Portfolio, snapshot: MarketSnapshot
    ) -> list[str]:
        positions = await portfolio_service.open_positions(db, portfolio.id)
        decision_ids = []

        for pos in positions:
            obs = snapshot.get(pos.symbol)
            trigger = self._reassessment_trigger(pos, obs)
            if trigger is None:
                continue

            pos.reassessment_count += 1
            pos.last_reassessed_at = datetime.now(timezone.utc)

            # A stop or target is a mechanical exit. It is deliberately not put
            # to a vote: the risk envelope was agreed when the position was
            # opened, and re-debating it at the moment it binds is exactly how a
            # stop-loss fails to protect anything.
            if trigger in ("stop_hit", "target_hit"):
                decision = await market_orchestrator.execute_mechanical_exit(
                    db, portfolio, pos, obs, trigger
                )
                decision_ids.append(decision.id)
                continue

            # Otherwise the quorum re-argues whether the thesis still holds.
            decision = await market_orchestrator.evaluate_action(
                db, portfolio, pos.symbol, pos.side, "close", snapshot,
                trigger=trigger, existing_position=pos,
                reassessment_of=pos.opening_decision_id,
            )
            decision_ids.append(decision.id)

        return decision_ids

    def _reassessment_trigger(
        self, pos: Position, obs: Observation | None
    ) -> str | None:
        """
        Decide whether this position needs re-examining, and say why.

        Returning None means conditions have not materially changed since the
        last look.
        """
        if obs is None:
            return "observation_lost"

        if obs.is_stale(settings.MARKET_STALENESS_SECONDS):
            # The desk cannot see the instrument it is exposed to.
            return "data_stale"

        price = obs.price
        entry = float(pos.entry_price)

        if pos.stop_price:
            stop = float(pos.stop_price)
            if (pos.side == "long" and price <= stop) or (
                pos.side == "short" and price >= stop
            ):
                return "stop_hit"

        if pos.target_price:
            target = float(pos.target_price)
            if (pos.side == "long" and price >= target) or (
                pos.side == "short" and price <= target
            ):
                return "target_hit"

        # Material move measured in the instrument's own volatility, not in
        # absolute percent — a 1% move means different things in different books.
        sigma = pos.entry_sigma or obs.sigma
        if sigma > 0 and entry > 0:
            move_in_sigmas = abs((price - entry) / entry) / sigma
            if move_in_sigmas >= settings.REASSESS_SIGMA_TRIGGER:
                return "material_price_move"

        # Adverse news arriving after entry invalidates part of the thesis.
        if obs.news_sentiment is not None:
            direction = 1 if pos.side == "long" else -1
            if obs.news_sentiment * direction <= -0.5:
                return "adverse_news"

        last = pos.last_reassessed_at or pos.opened_at
        if last:
            last = last if last.tzinfo else last.replace(tzinfo=timezone.utc)
            age = (datetime.now(timezone.utc) - last).total_seconds()
            if age >= MAX_SECONDS_BETWEEN_REASSESSMENTS:
                return "periodic_review"

        return None

    # ---------------------------------------------------------------- #
    # New opportunities
    # ---------------------------------------------------------------- #

    async def _seek_new(
        self, db: AsyncSession, portfolio: Portfolio, snapshot: MarketSnapshot
    ) -> list[str]:
        """
        Rank the instruments the desk is not yet in, and put the best candidate
        to the quorum.

        Only one new proposal per cycle: each entry changes the exposure picture
        every subsequent decision depends on, so proposing several against a
        single stale capital state would let the desk over-commit.
        """
        positions = await portfolio_service.open_positions(db, portfolio.id)
        held = {p.symbol for p in positions}
        now = datetime.now(timezone.utc)

        # Read the live constraint, not the startup default. The allocator sizes
        # against the portfolio's current constraints, so scanning against a
        # stale env value would silently ignore an operator's change.
        constraints = portfolio.constraints or portfolio_service.default_constraints()
        min_edge_bps = constraints.get("min_edge_bps", settings.MIN_EDGE_BPS)

        candidates = []
        for obs in snapshot.fresh(settings.MARKET_STALENESS_SECONDS):
            if obs.symbol in held:
                continue

            # A frozen price produces a meaningless edge estimate: no
            # volatility to discount by and no spread to cost against. Skip it
            # rather than compute a number from a market that is not open.
            if not obs.is_tradeable:
                continue

            last_attempt = self._last_entry_attempt.get(obs.symbol)
            if last_attempt and (now - last_attempt).total_seconds() < NEW_ENTRY_COOLDOWN_SECONDS:
                continue

            # Score both directions and keep whichever has an edge worth voting on.
            for side in ("long", "short"):
                edge = estimate_edge_bps(obs, side)
                if edge > min_edge_bps:
                    candidates.append((edge, obs.symbol, side))

        if not candidates:
            return []

        candidates.sort(reverse=True)
        edge, symbol, side = candidates[0]
        self._last_entry_attempt[symbol] = now

        logger.info(
            f"[AutonomousLoop] best candidate {side} {symbol} "
            f"at {edge:.1f} bps estimated edge"
        )
        decision = await market_orchestrator.evaluate_action(
            db, portfolio, symbol, side, "open", snapshot, trigger="opportunity_scan",
        )
        return [decision.id]

    # ---------------------------------------------------------------- #
    # Status
    # ---------------------------------------------------------------- #

    def status(self) -> dict:
        return {
            "running": self._running,
            "paused": self._paused,
            "cycles_completed": self._cycles,
            "last_cycle_at": self._last_cycle_at.isoformat()
            if self._last_cycle_at
            else None,
            "interval_seconds": settings.DECISION_INTERVAL_SECONDS,
            "sigma_trigger": settings.REASSESS_SIGMA_TRIGGER,
            "max_seconds_between_reassessments": MAX_SECONDS_BETWEEN_REASSESSMENTS,
            "last_error": self._last_error,
        }


autonomous_loop = AutonomousLoop()
