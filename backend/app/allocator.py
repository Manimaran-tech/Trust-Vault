"""
Capital allocation.

Deciding that an opportunity exists is not deciding how much capital it
deserves. This module answers the second question: given an edge estimate,
the instrument's volatility, what the desk already holds, and the human-defined
ceilings, how much notional should be committed.

Sizing is volatility-targeted and then clipped by every binding constraint in
turn. The result reports which constraint bound, so the decision record shows
not just the size but the reason for it.
"""
import logging
import math
from dataclasses import dataclass, field

from app.config import get_settings
from app.market.indicators import (
    MOMENTUM_LONG_TICKS,
    MOMENTUM_SHORT_TICKS,
    estimate_slippage_bps,
)
from app.market.types import Observation

logger = logging.getLogger(__name__)
settings = get_settings()

# Cap on the Kelly fraction. Full Kelly is far too aggressive against an
# estimated edge, so the desk sizes to a fraction of it.
KELLY_FRACTION = 0.25
MIN_NOTIONAL = 100.0

# How long the desk expects to hold a position, measured in observation ticks.
# The edge estimate is projected across this horizon, so it must match the
# cadence at which the loop actually reassesses and exits.
EXPECTED_HOLD_TICKS = 300

# Fraction of observed drift assumed to persist over that horizon. Momentum
# decays; assuming full persistence is how a backtest flatters itself.
MOMENTUM_PERSISTENCE = 0.20

# Contribution of a maximally bullish or bearish news score, as a fraction.
SENTIMENT_WEIGHT = 0.0010


@dataclass
class Allocation:
    """How much capital an opportunity gets, and what limited it."""

    symbol: str
    side: str
    notional: float
    quantity: float
    expected_edge_bps: float
    expected_slippage_bps: float
    expected_cost_bps: float
    net_edge_bps: float
    binding_constraint: str
    stop_price: float
    target_price: float
    rationale: str
    considered: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "side": self.side,
            "notional": round(self.notional, 2),
            "quantity": self.quantity,
            "expected_edge_bps": round(self.expected_edge_bps, 2),
            "expected_slippage_bps": round(self.expected_slippage_bps, 2),
            "expected_cost_bps": round(self.expected_cost_bps, 2),
            "net_edge_bps": round(self.net_edge_bps, 2),
            "binding_constraint": self.binding_constraint,
            "stop_price": round(self.stop_price, 8),
            "target_price": round(self.target_price, 8),
            "rationale": self.rationale,
            "considered": self.considered,
        }


def estimate_edge_bps(obs: Observation, side: str) -> float:
    """
    Expected return from holding this side over the intended holding period,
    in basis points.

    Momentum is observed over a window of ticks, so it is first converted to a
    per-tick drift rate and then projected across the expected holding horizon.
    Without that step the estimate silently means "the return over whatever
    window the indicator happened to use", which is not a quantity the desk can
    size a position against.

    Momentum decays, so only a fraction is assumed to persist. The whole
    estimate is then discounted for uncertainty: the same nominal drift is worth
    less when volatility is high, because more of it is noise.

    This is an input to sizing, not a price prediction. It is checked against
    execution cost before anything acts on it.
    """
    direction = 1 if side == "long" else -1

    # Per-tick drift implied by each momentum window.
    short_rate = obs.momentum_short / MOMENTUM_SHORT_TICKS
    long_rate = obs.momentum_long / MOMENTUM_LONG_TICKS

    # Blend the horizons, favouring the recent one, and project across the
    # holding period.
    blended_rate = 0.7 * short_rate + 0.3 * long_rate
    projected = blended_rate * EXPECTED_HOLD_TICKS * MOMENTUM_PERSISTENCE * direction

    # News contribution, deliberately small relative to price evidence.
    sentiment_component = 0.0
    if obs.news_sentiment is not None:
        sentiment_component = SENTIMENT_WEIGHT * obs.news_sentiment * direction

    raw_edge = projected + sentiment_component

    # Uncertainty discount. Square root rather than linear: it penalises high
    # volatility without collapsing the estimate to nothing the moment an
    # instrument trades above target.
    if obs.volatility > 0:
        confidence_scalar = min(1.0, math.sqrt(settings.TARGET_VOL / obs.volatility))
    else:
        # Volatility not yet measurable: discount heavily rather than assume.
        confidence_scalar = 0.25

    return raw_edge * confidence_scalar * 10_000


def allocate(
    symbol: str,
    side: str,
    obs: Observation,
    nav: float,
    cash: float,
    current_exposure_pct: float,
    correlated_notional: float = 0.0,
    constraints: dict | None = None,
) -> Allocation:
    """
    Size a candidate position.

    A returned notional of 0 means no size survives the constraints — that is a
    legitimate outcome and the binding_constraint field says which limit caused it.
    """
    c = constraints or {}
    max_exposure_pct = c.get("max_exposure_pct", settings.MAX_EXPOSURE_PCT)
    max_position_pct = c.get("max_position_pct", settings.MAX_POSITION_PCT)
    target_vol = c.get("target_vol", settings.TARGET_VOL)

    edge_bps = estimate_edge_bps(obs, side)
    considered: dict[str, float] = {}

    if edge_bps <= 0:
        return _no_allocation(
            symbol, side, edge_bps, "no_positive_edge",
            f"Estimated edge of {edge_bps:.1f} bps is not positive for a {side} position.",
        )

    # --- 1. Volatility-targeted base size ---
    # Commit capital such that the position's own volatility contribution sits
    # at the desk's target. Higher volatility therefore buys less.
    if obs.volatility > 0:
        vol_scalar = target_vol / obs.volatility
        base_notional = nav * min(vol_scalar, 1.0) * max_position_pct
        considered["vol_target_notional"] = base_notional
    else:
        # Volatility unmeasurable — take a deliberately small probe rather than
        # sizing blind.
        base_notional = nav * max_position_pct * 0.25
        considered["vol_target_notional"] = base_notional

    # --- 2. Fractional Kelly on the edge estimate ---
    # Kelly is edge divided by variance, and both must be measured over the
    # same horizon. The edge is a return over the expected holding period, so
    # the denominator must be the variance over that period too — using
    # annualised variance against a five-minute edge understates the fraction
    # by orders of magnitude and collapses every position to a rounding error.
    edge_fraction = edge_bps / 10_000
    if obs.sigma > 0:
        horizon_variance = (obs.sigma ** 2) * EXPECTED_HOLD_TICKS
    elif obs.volatility > 0:
        # Fall back to scaling annualised variance down to the holding period.
        seconds_per_year = 365 * 24 * 60 * 60
        horizon_variance = (obs.volatility ** 2) * (
            EXPECTED_HOLD_TICKS / seconds_per_year
        )
    else:
        # Volatility unmeasurable; assume a wide variance so Kelly stays small.
        horizon_variance = 1e-4

    kelly = max(0.0, edge_fraction / horizon_variance) * KELLY_FRACTION
    kelly_notional = nav * min(kelly, max_position_pct)
    considered["kelly_fraction"] = round(kelly, 6)
    considered["horizon_variance"] = horizon_variance
    considered["kelly_notional"] = kelly_notional

    notional = min(base_notional, kelly_notional)
    binding = "kelly" if kelly_notional < base_notional else "volatility_target"

    # --- 3. Clip by the hard constraints, tracking which one binds ---
    position_cap = nav * max_position_pct
    if notional > position_cap:
        notional, binding = position_cap, "max_position_pct"
    considered["position_cap"] = position_cap

    exposure_headroom = max(0.0, (max_exposure_pct - current_exposure_pct) * nav)
    if notional > exposure_headroom:
        notional, binding = exposure_headroom, "max_exposure_pct"
    considered["exposure_headroom"] = exposure_headroom

    # A correlated cluster is held to the single-position ceiling, since it
    # behaves as one bet.
    if correlated_notional > 0:
        cluster_headroom = max(0.0, position_cap * 1.5 - correlated_notional)
        considered["cluster_headroom"] = cluster_headroom
        if notional > cluster_headroom:
            notional, binding = cluster_headroom, "correlated_cluster"

    if notional > cash:
        notional, binding = cash, "available_cash"
    considered["cash"] = cash

    # --- 4. Check the edge still survives execution cost at this size ---
    slippage_bps = estimate_slippage_bps(notional, obs.depth_quote, obs.spread_bps)
    cost_bps = slippage_bps + settings.FEE_BPS
    net_edge_bps = edge_bps - cost_bps

    if notional < MIN_NOTIONAL:
        return _no_allocation(
            symbol, side, edge_bps, binding,
            f"Size collapsed to ${notional:,.2f} under the {binding} constraint, "
            f"below the ${MIN_NOTIONAL:,.0f} minimum.",
            slippage_bps, cost_bps,
        )

    if net_edge_bps < settings.MIN_EDGE_BPS:
        return _no_allocation(
            symbol, side, edge_bps, "edge_below_cost",
            f"At ${notional:,.0f} the {cost_bps:.1f} bps execution cost leaves "
            f"{net_edge_bps:.1f} bps, below the {settings.MIN_EDGE_BPS:.0f} bps minimum.",
            slippage_bps, cost_bps,
        )

    # --- 5. Risk envelope, scaled to the instrument's own volatility ---
    price = obs.price
    daily_vol = obs.volatility / math.sqrt(365) if obs.volatility > 0 else 0.01
    direction = 1 if side == "long" else -1
    stop_price = price * (1 - direction * 2 * daily_vol)
    target_price = price * (1 + direction * 3 * daily_vol)

    quantity = notional / price if price > 0 else 0.0

    return Allocation(
        symbol=symbol,
        side=side,
        notional=notional,
        quantity=quantity,
        expected_edge_bps=edge_bps,
        expected_slippage_bps=slippage_bps,
        expected_cost_bps=cost_bps,
        net_edge_bps=net_edge_bps,
        binding_constraint=binding,
        stop_price=stop_price,
        target_price=target_price,
        rationale=(
            f"Sized to ${notional:,.0f} ({notional / nav:.2%} of NAV), bound by "
            f"{binding}. Edge {edge_bps:.1f} bps less {cost_bps:.1f} bps cost leaves "
            f"{net_edge_bps:.1f} bps net. Stop at {stop_price:,.4f} (2 daily sigma), "
            f"target {target_price:,.4f} (3 daily sigma)."
        ),
        considered={k: round(v, 2) for k, v in considered.items()},
    )


def _no_allocation(
    symbol: str,
    side: str,
    edge_bps: float,
    binding: str,
    rationale: str,
    slippage_bps: float = 0.0,
    cost_bps: float = 0.0,
) -> Allocation:
    return Allocation(
        symbol=symbol,
        side=side,
        notional=0.0,
        quantity=0.0,
        expected_edge_bps=edge_bps,
        expected_slippage_bps=slippage_bps,
        expected_cost_bps=cost_bps,
        net_edge_bps=edge_bps - cost_bps,
        binding_constraint=binding,
        stop_price=0.0,
        target_price=0.0,
        rationale=rationale,
    )
