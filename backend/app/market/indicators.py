"""
Rolling market statistics derived from the tick stream.

Everything here is computed from observed prices — there are no fabricated
numbers. When a window has too few samples to support a statistic, the
statistic reports 0.0 and callers treat the instrument as unmodelled rather
than pretending to know its volatility.
"""
import math
import time
from collections import defaultdict, deque

# Ticks arrive roughly once per second; annualise from that base.
# Seconds of trading in a year. Read from configuration rather than fixed at
# a calendar year, because an instrument that trades 6h15m a day does not
# accumulate variance while the exchange is shut, and pretending it does
# inflates every annualised figure the desk sizes against.
def _trading_seconds_per_year() -> float:
    from app.config import get_settings

    return get_settings().TRADING_SECONDS_PER_YEAR
MOMENTUM_SHORT_TICKS = 20
MOMENTUM_LONG_TICKS = 100
MIN_SAMPLES = 10


class RollingStats:
    """Per-symbol rolling price history and the statistics derived from it."""

    def __init__(self, window: int = 120):
        self.window = window
        self._prices: dict[str, deque] = defaultdict(lambda: deque(maxlen=window))
        self._returns: dict[str, deque] = defaultdict(lambda: deque(maxlen=window))
        # Arrival times, so the annualisation factor is measured rather than
        # assumed. A book ticker can fire many times per second; assuming one
        # tick per second overstates annualised volatility by orders of
        # magnitude and makes every opportunity look untradeable.
        self._timestamps: dict[str, deque] = defaultdict(lambda: deque(maxlen=window))

    def update(self, symbol: str, price: float) -> None:
        """Record a new price and its log return."""
        if price <= 0:
            return
        prices = self._prices[symbol]
        if prices:
            prev = prices[-1]
            if prev > 0:
                self._returns[symbol].append(math.log(price / prev))
        prices.append(price)
        self._timestamps[symbol].append(time.time())

    def seconds_per_tick(self, symbol: str) -> float:
        """
        Mean interval between observations, measured from arrival times.

        Falls back to one second only when there is not yet enough history to
        measure.
        """
        ts = self._timestamps[symbol]
        if len(ts) < 2:
            return 1.0
        span = ts[-1] - ts[0]
        if span <= 0:
            return 1.0
        return span / (len(ts) - 1)

    def distinct_prices(self, symbol: str) -> int:
        """
        How many different prices appear in the window.

        One distinct price across a full window means the instrument is not
        trading — a closed market, a halt, or a dead feed. It is not the same
        as low volatility, and must not be reported as such.
        """
        return len(set(self._prices[symbol]))

    def is_static(self, symbol: str, min_samples: int = MIN_SAMPLES) -> bool:
        """True when enough samples have arrived and none of them differ."""
        prices = self._prices[symbol]
        return len(prices) >= min_samples and len(set(prices)) == 1

    def sample_count(self, symbol: str) -> int:
        return len(self._returns[symbol])

    def sigma(self, symbol: str) -> float:
        """Standard deviation of per-tick log returns."""
        rets = self._returns[symbol]
        if len(rets) < MIN_SAMPLES:
            return 0.0
        mean = sum(rets) / len(rets)
        var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
        return math.sqrt(var)

    def volatility(self, symbol: str, seconds_per_tick: float | None = None) -> float:
        """
        Annualised realised volatility as a fraction (0.20 == 20%).

        Scales per-tick sigma by the square root of the number of ticks in a
        year, using the observed tick interval rather than an assumed one.
        """
        s = self.sigma(symbol)
        if s == 0.0:
            return 0.0
        spt = (
            seconds_per_tick
            if seconds_per_tick is not None
            else self.seconds_per_tick(symbol)
        )
        ticks_per_year = _trading_seconds_per_year() / max(spt, 1e-9)
        return s * math.sqrt(ticks_per_year)

    def momentum(self, symbol: str, ticks: int) -> float:
        """Fractional price change over the trailing `ticks` prices."""
        prices = self._prices[symbol]
        if len(prices) < 2:
            return 0.0
        lookback = min(ticks, len(prices) - 1)
        past = prices[-1 - lookback]
        if past <= 0:
            return 0.0
        return (prices[-1] - past) / past

    def momentum_short(self, symbol: str) -> float:
        return self.momentum(symbol, MOMENTUM_SHORT_TICKS)

    def momentum_long(self, symbol: str) -> float:
        return self.momentum(symbol, MOMENTUM_LONG_TICKS)

    def correlation(self, a: str, b: str) -> float:
        """Pearson correlation of the overlapping return histories of a and b."""
        if a == b:
            return 1.0
        ra, rb = list(self._returns[a]), list(self._returns[b])
        n = min(len(ra), len(rb))
        if n < MIN_SAMPLES:
            return 0.0
        ra, rb = ra[-n:], rb[-n:]
        ma, mb = sum(ra) / n, sum(rb) / n
        cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
        va = sum((x - ma) ** 2 for x in ra)
        vb = sum((y - mb) ** 2 for y in rb)
        if va <= 0 or vb <= 0:
            return 0.0
        return max(-1.0, min(1.0, cov / math.sqrt(va * vb)))

    def correlation_matrix(self, symbols: list[str]) -> dict[str, dict[str, float]]:
        return {
            a: {b: round(self.correlation(a, b), 4) for b in symbols}
            for a in symbols
        }


def estimate_slippage_bps(notional: float, depth_quote: float, spread_bps: float) -> float:
    """
    Model the cost of crossing the book for `notional`.

    Half the quoted spread is paid immediately. Beyond that, impact grows with
    the square root of the order's size relative to resting depth — the standard
    concave impact shape. With no visible depth we assume the book is thin and
    charge a punitive estimate rather than assuming free execution.
    """
    half_spread = spread_bps / 2
    if depth_quote <= 0:
        return half_spread + 100.0
    participation = notional / depth_quote
    impact_bps = 10.0 * math.sqrt(max(participation, 0.0))
    return half_spread + impact_bps
