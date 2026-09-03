"""
Angel One SmartAPI integration.

Handles authentication (including TOTP generation), historical candle data
retrieval, and the symbol-token mapping for NSE equities.

The websocket streaming is handled by MarketFeed._run_angelone() in feed.py;
this module provides the authenticated client and data helpers.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

import httpx
import pyotp

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

SMARTAPI_BASE = "https://apiconnect.angelone.in"

# NSE equity symbol → Angel One instrument token mapping.
# These tokens are stable and sourced from the Angel One instrument master.
# Add or remove symbols here; the market feed will pick them up automatically.
SYMBOL_MAP: dict[str, dict] = {
    "RELIANCE":  {"token": "2885",  "exchange": "NSE", "name": "Reliance Industries"},
    "HDFCBANK":  {"token": "1333",  "exchange": "NSE", "name": "HDFC Bank"},
    "INFY":      {"token": "1594",  "exchange": "NSE", "name": "Infosys"},
    "TCS":       {"token": "11536", "exchange": "NSE", "name": "Tata Consultancy Services"},
    "ICICIBANK": {"token": "4963",  "exchange": "NSE", "name": "ICICI Bank"},
}

# Reverse lookup: token → symbol
TOKEN_TO_SYMBOL = {v["token"]: k for k, v in SYMBOL_MAP.items()}

# Valid candle intervals for the historical API
VALID_INTERVALS = {
    "ONE_MINUTE", "THREE_MINUTE", "FIVE_MINUTE", "TEN_MINUTE",
    "FIFTEEN_MINUTE", "THIRTY_MINUTE", "ONE_HOUR", "ONE_DAY",
}


class AngelOneClient:
    """Manages Angel One SmartAPI session lifecycle and data retrieval."""

    def __init__(self):
        self._jwt_token: Optional[str] = None
        self._refresh_token: Optional[str] = None
        self._feed_token: Optional[str] = None
        self._client_code: str = settings.ANGEL_CLIENT_ID
        self._api_key: str = settings.ANGEL_API_KEY
        self._password: str = settings.ANGEL_PASSWORD
        self._totp_secret: str = settings.ANGEL_TOTP_SECRET
        self._authenticated = False

    @property
    def is_authenticated(self) -> bool:
        return self._authenticated and self._jwt_token is not None

    @property
    def jwt_token(self) -> Optional[str]:
        return self._jwt_token

    @property
    def feed_token(self) -> Optional[str]:
        return self._feed_token

    @property
    def client_code(self) -> str:
        return self._client_code

    def _generate_totp(self) -> str:
        """Generate a time-based OTP from the stored secret."""
        totp = pyotp.TOTP(self._totp_secret)
        return totp.now()

    async def login(self) -> bool:
        """
        Authenticate with Angel One SmartAPI.

        Returns True on success. On failure, logs the error and returns False
        so the caller can retry with backoff rather than crashing the feed.
        """
        if not all([self._client_code, self._api_key, self._password, self._totp_secret]):
            logger.error("[AngelOne] Missing credentials — set ANGEL_* vars in .env")
            return False

        totp = self._generate_totp()

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    f"{SMARTAPI_BASE}/rest/auth/angelbroking/user/v1/loginByPassword",
                    headers={
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                        "X-UserType": "USER",
                        "X-SourceID": "WEB",
                        "X-ClientLocalIP": "127.0.0.1",
                        "X-ClientPublicIP": "127.0.0.1",
                        "X-MACAddress": "00:00:00:00:00:00",
                        "X-PrivateKey": self._api_key,
                    },
                    json={
                        "clientcode": self._client_code,
                        "password": self._password,
                        "totp": totp,
                    },
                )
                resp.raise_for_status()
                data = resp.json()

                if data.get("status") and data.get("data"):
                    self._jwt_token = data["data"].get("jwtToken")
                    self._refresh_token = data["data"].get("refreshToken")
                    self._feed_token = data["data"].get("feedToken")
                    self._authenticated = True
                    logger.info("[AngelOne] Authenticated successfully")
                    return True
                else:
                    logger.error(
                        "[AngelOne] Login failed: %s",
                        data.get("message", "Unknown error"),
                    )
                    return False

        except Exception as e:
            logger.error("[AngelOne] Login error: %s", e)
            return False

    async def get_candle_data(
        self,
        symbol: str,
        interval: str = "FIVE_MINUTE",
        days: int = 5,
    ) -> list[dict]:
        """
        Fetch historical OHLC candle data for a symbol.

        Returns a list of dicts: [{date, open, high, low, close, volume}, ...]
        """
        if interval not in VALID_INTERVALS:
            raise ValueError(f"Invalid interval: {interval}. Must be one of {VALID_INTERVALS}")

        info = SYMBOL_MAP.get(symbol.upper())
        if not info:
            raise ValueError(f"Unknown symbol: {symbol}. Available: {list(SYMBOL_MAP.keys())}")

        if not self.is_authenticated:
            if not await self.login():
                raise RuntimeError("Angel One authentication failed")

        to_date = datetime.now()
        from_date = to_date - timedelta(days=days)

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    f"{SMARTAPI_BASE}/rest/secure/angelbroking/historical/v1/getCandleData",
                    headers={
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                        "X-UserType": "USER",
                        "X-SourceID": "WEB",
                        "X-ClientLocalIP": "127.0.0.1",
                        "X-ClientPublicIP": "127.0.0.1",
                        "X-MACAddress": "00:00:00:00:00:00",
                        "X-PrivateKey": self._api_key,
                        "Authorization": f"Bearer {self._jwt_token}",
                    },
                    json={
                        "exchange": info["exchange"],
                        "symboltoken": info["token"],
                        "interval": interval,
                        "fromdate": from_date.strftime("%Y-%m-%d %H:%M"),
                        "todate": to_date.strftime("%Y-%m-%d %H:%M"),
                    },
                )
                resp.raise_for_status()
                data = resp.json()

                if not data.get("status") or not data.get("data"):
                    logger.warning(
                        "[AngelOne] No candle data for %s: %s",
                        symbol, data.get("message", "empty"),
                    )
                    return []

                candles = []
                for row in data["data"]:
                    # Angel One returns: [timestamp, open, high, low, close, volume]
                    candles.append({
                        "date": row[0],
                        "open": float(row[1]),
                        "high": float(row[2]),
                        "low": float(row[3]),
                        "close": float(row[4]),
                        "volume": int(row[5]),
                    })
                return candles

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                logger.warning("[AngelOne] Token expired, re-authenticating...")
                self._authenticated = False
                if await self.login():
                    return await self.get_candle_data(symbol, interval, days)
            raise

    async def get_ltp(self, symbols: list[str]) -> dict[str, float]:
        """Get last traded prices for multiple symbols."""
        if not self.is_authenticated:
            if not await self.login():
                return {}

        exchange_tokens = {
            "NSE": [SYMBOL_MAP[s]["token"] for s in symbols if s in SYMBOL_MAP]
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{SMARTAPI_BASE}/rest/secure/angelbroking/market/v1/quote/",
                    headers={
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                        "X-UserType": "USER",
                        "X-SourceID": "WEB",
                        "X-ClientLocalIP": "127.0.0.1",
                        "X-ClientPublicIP": "127.0.0.1",
                        "X-MACAddress": "00:00:00:00:00:00",
                        "X-PrivateKey": self._api_key,
                        "Authorization": f"Bearer {self._jwt_token}",
                    },
                    json={
                        "mode": "FULL",
                        "exchangeTokens": exchange_tokens,
                    },
                )
                resp.raise_for_status()
                data = resp.json()

                result = {}
                if data.get("status") and data.get("data", {}).get("fetched"):
                    for item in data["data"]["fetched"]:
                        token = item.get("symbolToken")
                        sym = TOKEN_TO_SYMBOL.get(token)
                        if sym:
                            result[sym] = float(item.get("ltp", 0))
                return result

        except Exception as e:
            logger.warning("[AngelOne] LTP fetch failed: %s", e)
            return {}

    async def logout(self) -> None:
        """Clean up the session."""
        if not self.is_authenticated:
            return
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(
                    f"{SMARTAPI_BASE}/rest/secure/angelbroking/user/v1/logout",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {self._jwt_token}",
                        "X-PrivateKey": self._api_key,
                    },
                    json={"clientcode": self._client_code},
                )
        except Exception:
            pass
        finally:
            self._authenticated = False
            self._jwt_token = None
            logger.info("[AngelOne] Logged out")


# Module-level singleton
angel_client = AngelOneClient()
