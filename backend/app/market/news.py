"""
Heterogeneous information: headlines scored for sentiment and attached to
the instruments they concern.

Price and book data alone are homogeneous. The problem requires the agent to
process news and signals too, so this polls a public headline source and asks
the LLM to score each item, then decorates the live observations.
"""
import asyncio
import logging
import re
from datetime import datetime, timezone

import httpx

from app.config import get_settings
from app.market.feed import market_feed

logger = logging.getLogger(__name__)
settings = get_settings()

# Public, key-free crypto headline feed. Swap per asset class as needed.
NEWS_URL = "https://api.coingecko.com/api/v3/news"
REQUEST_TIMEOUT = 10.0
MAX_HEADLINES = 12

# Maps ticker roots to the words a headline is likely to use.
SYMBOL_ALIASES = {
    "BTC": ("bitcoin", "btc"),
    "ETH": ("ethereum", "ether", "eth"),
    "SOL": ("solana", "sol"),
    "XRP": ("ripple", "xrp"),
    "ADA": ("cardano", "ada"),
    "DOGE": ("dogecoin", "doge"),
}

NEWS_SENTIMENT_PROMPT = """You are a financial news sentiment analyst.

Score the market impact of headlines on the named instruments. Judge likely
short-horizon price impact, not whether the news is pleasant.

Respond ONLY with JSON in exactly this shape:
{"decision": "approve", "confidence": 0.0, "reasoning": "<one sentence>", "risk_flags": [], "scores": {"<SYMBOL>": <float between -1 and 1>}}

Use "decision": "approve" always — it is ignored here. Put the real answer in
"scores". A score of -1 is severely bearish, 0 is neutral, +1 is severely
bullish. Only include symbols the headlines actually bear on."""


class NewsFeed:
    """Polls headlines, scores them, and decorates live observations."""

    def __init__(self):
        self._task: asyncio.Task | None = None
        self._running = False
        self._headlines: list[dict] = []
        self._last_poll: datetime | None = None
        self._last_error: str | None = None

    async def start(self) -> None:
        if self._running or not settings.NEWS_FEED_ENABLED:
            return
        self._running = True
        self._task = asyncio.create_task(self._run())
        logger.info("[NewsFeed] started")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("[NewsFeed] stopped")

    async def _run(self) -> None:
        while self._running:
            try:
                await self._poll_once()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self._last_error = str(e)
                logger.warning(f"[NewsFeed] poll failed: {e}")
            await asyncio.sleep(settings.NEWS_POLL_SECONDS)

    async def _poll_once(self) -> None:
        headlines = await self._fetch_headlines()
        if not headlines:
            return

        self._headlines = headlines
        self._last_poll = datetime.now(timezone.utc)
        self._last_error = None

        scores = await self._score(headlines)
        for symbol in market_feed.symbols:
            root = _root(symbol)
            if root in scores:
                sentiment, headline = scores[root]
                market_feed.attach_news(symbol, sentiment, headline)

    async def _fetch_headlines(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.get(NEWS_URL)
            resp.raise_for_status()
            data = resp.json()

        items = data.get("data", []) if isinstance(data, dict) else []
        return [
            {
                "title": it.get("title", ""),
                "description": (it.get("description") or "")[:280],
                "url": it.get("url", ""),
                "published_at": it.get("updated_at"),
            }
            for it in items[:MAX_HEADLINES]
            if it.get("title")
        ]

    async def _score(self, headlines: list[dict]) -> dict[str, tuple[float, str]]:
        """
        Ask the LLM to score the headlines, then fall back to keyword matching
        if the model is unavailable. The fallback is clearly weaker and is
        reported as such rather than presented as model output.
        """
        roots = [_root(s) for s in market_feed.symbols]
        joined = "\n".join(f"- {h['title']}. {h['description']}" for h in headlines)
        user_prompt = (
            f"Instruments: {', '.join(roots)}\n\nHeadlines:\n{joined}\n\n"
            "Score each instrument these headlines bear on."
        )

        try:
            from app.llm.client import query_llm

            result = await query_llm(
                system_prompt=NEWS_SENTIMENT_PROMPT,
                user_prompt=user_prompt,
                temperature=0.2,
                max_tokens=512,
            )
            raw_scores = result.get("scores") or {}
            out: dict[str, tuple[float, str]] = {}
            for sym, score in raw_scores.items():
                root = _root(str(sym))
                if root not in roots:
                    continue
                try:
                    value = max(-1.0, min(1.0, float(score)))
                except (TypeError, ValueError):
                    continue
                out[root] = (value, _best_headline(root, headlines))
            if out:
                return out
        except Exception as e:
            logger.warning(f"[NewsFeed] LLM scoring unavailable ({e}); using keyword fallback")

        return self._keyword_fallback(headlines, roots)

    def _keyword_fallback(
        self, headlines: list[dict], roots: list[str]
    ) -> dict[str, tuple[float, str]]:
        bullish = ("surge", "rally", "soar", "approval", "adoption", "inflow", "record high")
        bearish = ("crash", "plunge", "hack", "exploit", "ban", "lawsuit", "outflow", "selloff")

        out: dict[str, tuple[float, str]] = {}
        for root in roots:
            matched = [h for h in headlines if _mentions(root, h)]
            if not matched:
                continue
            score = 0.0
            for h in matched:
                text = f"{h['title']} {h['description']}".lower()
                score += sum(0.3 for w in bullish if w in text)
                score -= sum(0.3 for w in bearish if w in text)
            out[root] = (max(-1.0, min(1.0, score)), matched[0]["title"])
        return out

    def status(self) -> dict:
        return {
            "enabled": settings.NEWS_FEED_ENABLED,
            "running": self._running,
            "headline_count": len(self._headlines),
            "last_poll": self._last_poll.isoformat() if self._last_poll else None,
            "last_error": self._last_error,
            "poll_interval_seconds": settings.NEWS_POLL_SECONDS,
        }

    def headlines(self) -> list[dict]:
        return list(self._headlines)


def _root(symbol: str) -> str:
    """BTCUSDT -> BTC. Leaves already-rooted tickers alone."""
    s = symbol.upper()
    for quote in ("USDT", "USDC", "USD", "BUSD", "EUR"):
        if s.endswith(quote) and len(s) > len(quote):
            return s[: -len(quote)]
    return s


def _mentions(root: str, headline: dict) -> bool:
    aliases = SYMBOL_ALIASES.get(root, (root.lower(),))
    text = f"{headline['title']} {headline['description']}".lower()
    return any(re.search(rf"\b{re.escape(a)}\b", text) for a in aliases)


def _best_headline(root: str, headlines: list[dict]) -> str:
    for h in headlines:
        if _mentions(root, h):
            return h["title"]
    return headlines[0]["title"] if headlines else ""


news_feed = NewsFeed()
