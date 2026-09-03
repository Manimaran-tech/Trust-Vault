"""
Core value types for the market perception layer.

An Observation is the atomic unit the agent perceives. Every field an expert
agent is allowed to reason over lives here, including the observation's own
age — because the problem demands the agent distinguish a current reading
from one that no longer represents prevailing conditions.
"""
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional


@dataclass
class Observation:
    """A single point-in-time view of one instrument."""

    symbol: str
    price: float
    observed_at: datetime

    # --- Liquidity ---
    bid: float = 0.0
    ask: float = 0.0
    # Aggregate size resting within 10 bps of mid, in quote currency.
    depth_quote: float = 0.0
    # Notional traded over the trailing rolling window.
    volume_quote: float = 0.0

    # --- Derived state (filled in by the indicator layer) ---
    # Annualised realised volatility over MARKET_VOL_WINDOW ticks.
    volatility: float = 0.0
    # Return over the short and long momentum windows, as a fraction.
    momentum_short: float = 0.0
    momentum_long: float = 0.0
    # Rolling standard deviation of tick returns, used for the sigma trigger.
    sigma: float = 0.0

    # True when the price has not changed across the whole rolling window,
    # which means the instrument is not trading. Distinct from a stale poll:
    # the data is current, the market is shut.
    is_static: bool = False

    # --- Context ---
    news_sentiment: Optional[float] = None  # -1..1, None when no coverage
    news_headline: Optional[str] = None

    @property
    def spread_bps(self) -> float:
        """Quoted spread in basis points of mid. 0 when no book is available."""
        if self.bid <= 0 or self.ask <= 0:
            return 0.0
        mid = (self.bid + self.ask) / 2
        if mid <= 0:
            return 0.0
        return (self.ask - self.bid) / mid * 10_000

    @property
    def age_seconds(self) -> float:
        """How long ago this observation was taken."""
        return (datetime.now(timezone.utc) - self.observed_at).total_seconds()

    def is_stale(self, max_age_seconds: float) -> bool:
        """True when this reading is too old to justify an action."""
        return self.age_seconds > max_age_seconds

    @property
    def is_tradeable(self) -> bool:
        """
        Whether this instrument can support an action at all.

        A static price offers no volatility to size against and no spread to
        cost, so any edge computed from it is an artefact.
        """
        return not self.is_static and self.price > 0

    def to_dict(self) -> dict:
        d = asdict(self)
        d["observed_at"] = self.observed_at.isoformat()
        d["spread_bps"] = round(self.spread_bps, 3)
        d["age_seconds"] = round(self.age_seconds, 3)
        d["is_tradeable"] = self.is_tradeable
        return d


@dataclass
class MarketSnapshot:
    """Every instrument the agent can currently see, plus cross-asset state."""

    observations: dict[str, Observation] = field(default_factory=dict)
    # symbol -> symbol -> Pearson correlation of recent returns
    correlations: dict[str, dict[str, float]] = field(default_factory=dict)
    taken_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def get(self, symbol: str) -> Optional[Observation]:
        return self.observations.get(symbol)

    def fresh(self, max_age_seconds: float) -> list[Observation]:
        """Observations current enough to act on."""
        return [o for o in self.observations.values() if not o.is_stale(max_age_seconds)]

    def to_dict(self) -> dict:
        return {
            "observations": {s: o.to_dict() for s, o in self.observations.items()},
            "correlations": self.correlations,
            "taken_at": self.taken_at.isoformat(),
        }
