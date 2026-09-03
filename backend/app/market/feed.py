"""
Continuous market perception.

A single long-lived task keeps a live view of every configured instrument.
The rest of the system never blocks on the network: it reads the latest
snapshot, which carries the age of each reading so a stale view can be
recognised as stale instead of silently trusted.

Providers:
  binance — public spot bookTicker + 24h ticker websocket, no API key
  replay  — deterministic synthetic walk, for offline demos and tests
"""
import asyncio
import json
import logging
import math
import random
from datetime import datetime, timezone

from app.config import get_settings
from app.market.indicators import RollingStats
from app.market.types import MarketSnapshot, Observation

logger = logging.getLogger(__name__)
settings = get_settings()

BINANCE_WS = "wss://stream.binance.com:9443/stream?streams="

# Starting levels for the offline generator, so a simulated series sits in the
# right range for the instrument it claims to be. These are approximate recent
# levels, not quotes — the replay provider is explicitly synthetic and the UI
# labels it as such.
REPLAY_REFERENCE_PRICES = {
    # NSE equities, in rupees
    "RELIANCE": 1287.0,
    "TCS": 3120.0,
    "HDFCBANK": 1710.0,
    "INFY": 1520.0,
    "ICICIBANK": 1265.0,
    "SBIN": 815.0,
    "WIPRO": 245.0,
    "AXISBANK": 1120.0,
    "ITC": 415.0,
    "BHARTIARTL": 1640.0,
    # Crypto pairs, in dollars
    "BTCUSDT": 96000.0,
    "ETHUSDT": 3400.0,
    "SOLUSDT": 195.0,
}
# Rolling one-minute turnover, in rupees, at roughly the level each of these
# names actually trades at on NSE. The generator previously emitted the same
# 0.5-5 crore band for every instrument, which made RELIANCE and WIPRO look
# equally liquid and gave the liquidity agent nothing real to discriminate on.
REPLAY_TURNOVER_PER_MINUTE = {
    "RELIANCE": 5.2e7,
    "HDFCBANK": 4.6e7,
    "ICICIBANK": 3.4e7,
    "TCS": 2.1e7,
    "INFY": 2.6e7,
    "SBIN": 3.0e7,
    "AXISBANK": 1.8e7,
    "BHARTIARTL": 2.2e7,
    "ITC": 1.9e7,
    "WIPRO": 6.0e6,
    "BTCUSDT": 4.0e8,
    "ETHUSDT": 1.6e8,
    "SOLUSDT": 4.0e7,
}

RECONNECT_DELAY_SECONDS = 3
MAX_RECONNECT_DELAY_SECONDS = 60


class MarketFeed:
    """Owns the live market view and the rolling statistics behind it."""

    def __init__(self):
        self.symbols = [
            s.strip().upper()
            for s in settings.MARKET_SYMBOLS.split(",")
            if s.strip()
        ]
        self.provider = settings.MARKET_FEED_PROVIDER.lower()
        self.stats = RollingStats(window=settings.MARKET_VOL_WINDOW)
        self._observations: dict[str, Observation] = {}
        self._task: asyncio.Task | None = None
        self._running = False
        self._tick_count = 0
        self._connected = False
        self._last_error: str | None = None
        self._subscribers: list[asyncio.Queue] = []

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._run())
        logger.info(
            f"[MarketFeed] started provider={self.provider} symbols={self.symbols}"
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
        self._connected = False
        logger.info("[MarketFeed] stopped")

    async def _run(self) -> None:
        """Supervise the provider loop, reconnecting with backoff."""
        delay = RECONNECT_DELAY_SECONDS
        while self._running:
            try:
                if self.provider == "binance":
                    await self._run_binance()
                elif self.provider == "angelone":
                    await self._run_angelone()
                else:
                    await self._run_replay()
                delay = RECONNECT_DELAY_SECONDS
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self._connected = False
                self._last_error = str(e)
                logger.warning(
                    f"[MarketFeed] {self.provider} stream dropped: {e}. "
                    f"Reconnecting in {delay}s"
                )
                await asyncio.sleep(delay)
                delay = min(delay * 2, MAX_RECONNECT_DELAY_SECONDS)

    # ------------------------------------------------------------------ #
    # Providers
    # ------------------------------------------------------------------ #

    async def _run_binance(self) -> None:
        """Consume Binance's combined bookTicker and 24h ticker streams."""
        import websockets

        streams = "/".join(
            f"{s.lower()}@bookTicker/{s.lower()}@ticker" for s in self.symbols
        )
        url = BINANCE_WS + streams

        async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
            self._connected = True
            self._last_error = None
            logger.info(f"[MarketFeed] connected to Binance ({len(self.symbols)} symbols)")

            async for raw in ws:
                if not self._running:
                    break
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                payload = msg.get("data") or {}
                symbol = (payload.get("s") or "").upper()
                if symbol not in self.symbols:
                    continue

                if "b" in payload and "a" in payload:
                    # bookTicker: best bid/ask and the size resting at each.
                    bid = float(payload["b"])
                    ask = float(payload["a"])
                    bid_qty = float(payload.get("B", 0) or 0)
                    ask_qty = float(payload.get("A", 0) or 0)
                    mid = (bid + ask) / 2 if bid > 0 and ask > 0 else 0.0
                    depth_quote = (bid_qty * bid) + (ask_qty * ask)
                    self._ingest(symbol, price=mid, bid=bid, ask=ask, depth_quote=depth_quote)
                elif "q" in payload:
                    # 24h ticker: rolling quote volume.
                    self._merge_volume(symbol, float(payload.get("q", 0) or 0))

    async def _run_replay(self) -> None:
        """
        Historical Replay Provider using yfinance intraday data.
        
        Fetches the last 5 days of 1-minute data, isolates the most recent 
        trading day, and plays it back chronologically (1 second = 1 minute).
        """
        import yfinance as yf
        import pandas as pd
        
        self._connected = True
        self._last_error = None
        logger.info(f"[MarketFeed] Historical replay provider active for {self.symbols}")
        
        def to_yf_symbol(sym):
            if "USDT" in sym:
                return sym.replace("USDT", "-USD")
            return f"{sym}.NS"
            
        yf_symbols = [to_yf_symbol(s) for s in self.symbols]
        data_by_symbol = {}
        
        for s, yf_s in zip(self.symbols, yf_symbols):
            try:
                # Run synchronously in a thread to avoid blocking the event loop
                df = await asyncio.to_thread(
                    yf.download, yf_s, period="5d", interval="1m", progress=False
                )
                if not df.empty:
                    data_by_symbol[s] = df
            except Exception as e:
                logger.warning(f"Failed to fetch historical data for {s}: {e}")
                
        if not data_by_symbol:
            logger.error("No historical data found. Halting replay.")
            return

        # Find the most recent active trading date across all symbols
        all_dates = set()
        for df in data_by_symbol.values():
            for ts in df.index:
                all_dates.add(ts.date())
        
        if not all_dates:
            return
            
        target_date = max(all_dates)
        logger.info(f"[MarketFeed] Replaying historical data for date: {target_date}")
        
        # Filter to only the target date and collect all timestamps
        all_timestamps = set()
        for s, df in data_by_symbol.items():
            day_df = df[df.index.date == target_date]
            data_by_symbol[s] = day_df
            for ts in day_df.index:
                all_timestamps.add(ts)
                
        all_timestamps = sorted(list(all_timestamps))
        
        for ts in all_timestamps:
            if not self._running:
                break
                
            for s in self.symbols:
                if s not in data_by_symbol:
                    continue
                df = data_by_symbol[s]
                
                # Forward fill: use the last known price at or before this timestamp
                past_data = df[df.index <= ts]
                if past_data.empty:
                    continue
                    
                row = past_data.iloc[-1]
                # yfinance returns pandas Series for row, some columns might be multi-index depending on version
                price = float(row['Close'].iloc[0] if isinstance(row['Close'], pd.Series) else row['Close'])
                vol = float(row['Volume'].iloc[0] if isinstance(row['Volume'], pd.Series) else row['Volume'])
                
                # Estimate a tiny spread since yfinance doesn't provide order book
                spread = price * 0.0004
                # Approximate depth based on historical 1m volume
                depth_quote = price * (vol if vol > 0 else 5000)
                
                self._ingest(
                    s,
                    price=price,
                    bid=price - spread / 2,
                    ask=price + spread / 2,
                    depth_quote=depth_quote,
                )
                if vol > 0:
                    self._merge_volume(s, price * vol)
                    
            # Time Compression: 1 real-world second = 1 market minute
            await asyncio.sleep(1.0)
            
        logger.info("[MarketFeed] Historical replay finished. Market closed.")

    async def _run_angelone(self) -> None:
        """
        Angel One SmartAPI — poll LTP and quote data for Indian equities.

        Uses the REST quote API on a 2-second loop rather than the binary
        WebSocket, because the REST endpoint is simpler to maintain and the
        2-second granularity is more than adequate for the decision loop's
        15–30 second cycle.
        """
        from app.market.angelone import angel_client, SYMBOL_MAP

        if not await angel_client.login():
            raise RuntimeError("Angel One authentication failed")

        self._connected = True
        self._last_error = None
        tradeable = [s for s in self.symbols if s in SYMBOL_MAP]
        logger.info(
            f"[MarketFeed] connected to Angel One ({len(tradeable)} symbols: {tradeable})"
        )

        if not tradeable:
            logger.error(
                "[MarketFeed] No configured symbols found in Angel One SYMBOL_MAP. "
                f"Configured: {self.symbols}, Available: {list(SYMBOL_MAP.keys())}"
            )
            raise RuntimeError("No tradeable symbols for Angel One")

        exchange_tokens = {
            "NSE": [SYMBOL_MAP[s]["token"] for s in tradeable]
        }

        while self._running:
            try:
                import httpx as _httpx

                async with _httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.post(
                        "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/",
                        headers={
                            "Content-Type": "application/json",
                            "Accept": "application/json",
                            "X-UserType": "USER",
                            "X-SourceID": "WEB",
                            "X-ClientLocalIP": "127.0.0.1",
                            "X-ClientPublicIP": "127.0.0.1",
                            "X-MACAddress": "00:00:00:00:00:00",
                            "X-PrivateKey": settings.ANGEL_API_KEY,
                            "Authorization": f"Bearer {angel_client.jwt_token}",
                        },
                        json={
                            "mode": "FULL",
                            "exchangeTokens": exchange_tokens,
                        },
                    )

                    if resp.status_code == 401:
                        logger.warning("[MarketFeed] Angel One token expired, re-authenticating...")
                        if not await angel_client.login():
                            raise RuntimeError("Angel One re-auth failed")
                        continue

                    resp.raise_for_status()
                    data = resp.json()

                    if data.get("status") and data.get("data", {}).get("fetched"):
                        from app.market.angelone import TOKEN_TO_SYMBOL

                        for item in data["data"]["fetched"]:
                            token = item.get("symbolToken")
                            symbol = TOKEN_TO_SYMBOL.get(token)
                            if not symbol:
                                continue

                            ltp = float(item.get("ltp", 0))
                            if ltp <= 0:
                                continue

                            # Angel One FULL mode provides best bid/ask and depth
                            best_bid = float(item.get("depth", {}).get("buy", [{}])[0].get("price", ltp) or ltp)
                            best_ask = float(item.get("depth", {}).get("sell", [{}])[0].get("price", ltp) or ltp)
                            # Approximate depth from top-of-book
                            bid_qty = float(item.get("depth", {}).get("buy", [{}])[0].get("quantity", 0) or 0)
                            ask_qty = float(item.get("depth", {}).get("sell", [{}])[0].get("quantity", 0) or 0)
                            depth_quote = (bid_qty * best_bid) + (ask_qty * best_ask)

                            self._ingest(
                                symbol,
                                price=ltp,
                                bid=best_bid,
                                ask=best_ask,
                                depth_quote=depth_quote,
                            )

                            # Volume from the quote
                            vol = float(item.get("tradeVolume", 0) or 0)
                            if vol > 0:
                                self._merge_volume(symbol, vol * ltp)  # approx quote volume

            except asyncio.CancelledError:
                raise
            except Exception as e:
                self._last_error = str(e)
                logger.warning(f"[MarketFeed] Angel One poll error: {e}")

            await asyncio.sleep(2.0)  # Poll every 2 seconds

    # ------------------------------------------------------------------ #
    # Ingest
    # ------------------------------------------------------------------ #

    def _ingest(
        self,
        symbol: str,
        price: float,
        bid: float,
        ask: float,
        depth_quote: float,
    ) -> None:
        """Record a tick and refresh every derived statistic for the symbol."""
        if price <= 0:
            return

        self.stats.update(symbol, price)
        self._tick_count += 1

        prev = self._observations.get(symbol)
        obs = Observation(
            symbol=symbol,
            price=price,
            observed_at=datetime.now(timezone.utc),
            bid=bid,
            ask=ask,
            depth_quote=depth_quote,
            volume_quote=prev.volume_quote if prev else 0.0,
            volatility=self.stats.volatility(symbol),
            momentum_short=self.stats.momentum_short(symbol),
            momentum_long=self.stats.momentum_long(symbol),
            sigma=self.stats.sigma(symbol),
            is_static=self.stats.is_static(symbol),
            news_sentiment=prev.news_sentiment if prev else None,
            news_headline=prev.news_headline if prev else None,
        )
        self._observations[symbol] = obs
        self._publish(obs)

    def _merge_volume(self, symbol: str, volume_quote: float) -> None:
        obs = self._observations.get(symbol)
        if obs:
            obs.volume_quote = volume_quote

    def attach_news(self, symbol: str, sentiment: float, headline: str) -> None:
        """Let the news feed decorate the current observation for a symbol."""
        obs = self._observations.get(symbol)
        if obs:
            obs.news_sentiment = sentiment
            obs.news_headline = headline

    def _publish(self, obs: Observation) -> None:
        """Push to any live subscriber without ever blocking the feed."""
        for q in list(self._subscribers):
            try:
                q.put_nowait(obs)
            except asyncio.QueueFull:
                pass

    def subscribe(self, maxsize: int = 100) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=maxsize)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        if q in self._subscribers:
            self._subscribers.remove(q)

    # ------------------------------------------------------------------ #
    # Reads
    # ------------------------------------------------------------------ #

    def snapshot(self) -> MarketSnapshot:
        """The agent's current view of the world."""
        return MarketSnapshot(
            observations=dict(self._observations),
            correlations=self.stats.correlation_matrix(self.symbols),
        )

    def status(self) -> dict:
        """
        Honest health reporting — no invented uptime figures.

        Reports poll freshness and market liveness separately. A feed can be
        perfectly healthy while every instrument on it is frozen because the
        exchange is closed, and conflating the two hides the reason the desk
        is idle.
        """
        fresh = [
            s
            for s, o in self._observations.items()
            if not o.is_stale(settings.MARKET_STALENESS_SECONDS)
        ]
        static = [s for s, o in self._observations.items() if o.is_static]
        tradeable = [s for s in fresh if s not in static]

        if not self._observations:
            market_state = "no_data"
        elif static and len(static) == len(self._observations):
            market_state = "closed"
        elif static:
            market_state = "partially_halted"
        else:
            market_state = "open"

        return {
            "provider": self.provider,
            "connected": self._connected,
            "symbols": self.symbols,
            "symbols_fresh": fresh,
            "symbols_stale": [s for s in self.symbols if s not in fresh],
            # Prices that have not moved across the whole window.
            "symbols_static": static,
            # Fresh and actually moving — the set the desk can act on.
            "symbols_tradeable": tradeable,
            "market_state": market_state,
            "market_state_detail": _MARKET_STATE_DETAIL.get(market_state, ""),
            "ticks_received": self._tick_count,
            "subscribers": len(self._subscribers),
            "last_error": self._last_error,
            "staleness_threshold_seconds": settings.MARKET_STALENESS_SECONDS,
        }


_MARKET_STATE_DETAIL = {
    "open": "Prices are moving; the desk can evaluate opportunities.",
    "closed": (
        "Every instrument is returning an unchanged price. The exchange is "
        "most likely closed, so there is no volatility to size against and no "
        "spread to cost. The desk will not trade until prices move."
    ),
    "partially_halted": (
        "Some instruments are frozen while others trade. The frozen ones are "
        "excluded from opportunity scanning."
    ),
    "no_data": "No observations received yet.",
}


market_feed = MarketFeed()
