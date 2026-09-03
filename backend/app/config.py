import secrets
from pydantic_settings import BaseSettings
from pydantic import field_validator
from functools import lru_cache

# Known insecure default secrets that must not be used in production
_INSECURE_SECRETS = {
    "trustvault-dev-secret-change-in-production-2026",
    "changeme",
    "secret",
    "dev-secret",
}


class Settings(BaseSettings):
    # App
    APP_NAME: str = "TrustVault"
    APP_ENV: str = "development"
    DEBUG: bool = False

    # LLM
    LLM_BASE_URL: str = "http://localhost:11434/v1"
    LLM_MODEL: str = "hf.co/unsloth/gemma-4-E4B-it-GGUF"
    LLM_API_KEY: str = "ollama"
    LLM_TIMEOUT_SECONDS: int = 120
    LLM_MAX_RETRIES: int = 1
    # How long Ollama keeps the model resident between calls. Reloading a
    # multi-gigabyte model between agents costs more than the inference does.
    LLM_KEEP_ALIVE: str = "30m"
    # Startup probe timeout. Generous, because a cold CPU-bound model can take
    # a minute to load and answer, and "slow" is not "unreachable".
    LLM_HEALTHCHECK_TIMEOUT: int = 90
    # Verdicts are short. A large budget only gives a reasoning model room to
    # spend the whole allowance thinking.
    LLM_MAX_TOKENS: int = 300
    # Whether the transaction/payment quorum may call the LLM.
    # Payment authorisation has a hard latency budget that an LLM quorum cannot
    # meet, so it defaults to the deterministic rule engine. The trading loop is
    # unaffected: it always reasons with the model, because there nothing is
    # waiting on the answer.
    TRANSACTION_LLM_ENABLED: bool = False

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://trustvault:trustvault@localhost:5432/trustvault"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # Auth
    JWT_SECRET: str = ""
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # Seed user passwords (must be set via env for security)
    SEED_ADMIN_PASSWORD: str = ""
    SEED_CSR_PASSWORD: str = ""
    SEED_MEMBER_PASSWORD: str = ""

    # Encryption
    ENCRYPTION_KEY: str = ""
    HMAC_SECRET: str = ""

    # Rate limiting
    RATE_LIMIT_GENERAL: int = 100  # requests per minute per IP
    RATE_LIMIT_AUTH: int = 10  # auth requests per minute per IP

    # --- Market data feed ---
    # Provider for the live market perception layer.
    #   "binance"  — public spot websocket + REST depth (no key required)
    #   "finnhub"  — requires MARKET_API_KEY
    #   "replay"   — deterministic offline replay for demos/tests
    MARKET_FEED_PROVIDER: str = "binance"
    MARKET_API_KEY: str = ""
    # Instruments the agent is allowed to perceive and trade.
    MARKET_SYMBOLS: str = "BTCUSDT,ETHUSDT,SOLUSDT"
    # An observation older than this is treated as stale and cannot justify a trade.
    MARKET_STALENESS_SECONDS: float = 5.0
    # Rolling window (number of ticks) used for realised volatility and correlation.
    MARKET_VOL_WINDOW: int = 120

    # --- News / sentiment feed ---
    NEWS_FEED_ENABLED: bool = True
    NEWS_POLL_SECONDS: int = 60

    # --- Capital and risk constraints (hard limits on the autonomous loop) ---
    # The desk's book currency. Every price the feed reports, every notional
    # the allocator sizes and every ledger entry is denominated in this. It is
    # a single setting because a book that mixes currencies without an FX rate
    # is not a book — NSE equities quote in INR, so INR is the default.
    BASE_CURRENCY: str = "INR"
    # Seconds the venue actually trades in a year, used to annualise realised
    # volatility. NSE runs 09:15-15:30 IST on roughly 250 session days, which
    # is 5.6M seconds - not the 31.5M seconds in a calendar year. Annualising
    # an equity on a 24/7 clock overstates its volatility by about 2.4x, which
    # is enough on its own to make every opportunity look untradeable.
    #   NSE cash equities : 22_500 * 250 = 5_625_000
    #   24/7 crypto       : 31_536_000
    TRADING_SECONDS_PER_YEAR: float = 5_625_000.0
    STARTING_CAPITAL: float = 10_000_000.0
    # Fraction of NAV that may be deployed across all open positions at once.
    MAX_EXPOSURE_PCT: float = 0.60
    # Fraction of NAV that any single position may consume.
    MAX_POSITION_PCT: float = 0.15
    # Annualised volatility the allocator sizes positions towards.
    TARGET_VOL: float = 0.20
    # Hard stop: if drawdown from peak NAV exceeds this, the agent flattens and halts.
    MAX_DRAWDOWN_PCT: float = 0.15
    # Per-side execution fee, in basis points. 2 bps reflects a liquid venue's
    # taker tier; raise it for retail pricing. A momentum edge measured over
    # minutes does not survive a 10 bps fee, so this value materially decides
    # whether the desk can trade at all.
    FEE_BPS: float = 2.0
    # Reject a trade whose modelled slippage exceeds this share of expected return.
    MAX_SLIPPAGE_SHARE_OF_EDGE: float = 0.50
    # Minimum expected edge (after costs, in bps) required to act at all.
    MIN_EDGE_BPS: float = 5.0

    # --- Continuous reassessment loop ---
    # How often the agent re-perceives the market and re-scores open positions.
    DECISION_INTERVAL_SECONDS: int = 15
    # Re-run the full agent pipeline on an open position when price has moved
    # this many rolling standard deviations since the decision was made.
    REASSESS_SIGMA_TRIGGER: float = 1.5
    AUTONOMOUS_LOOP_ENABLED: bool = True

    # --- Adaptation ---
    # Number of closed positions required before agent weights start adapting.
    ADAPTATION_MIN_SAMPLES: int = 10
    # How strongly realised hit-rate pulls an agent's consensus weight (0 = never adapt).
    ADAPTATION_LEARNING_RATE: float = 0.15

    # --- Stitch (settlement rail) ---
    # Stitch is a GraphQL payments API. It has no programmable ledger product,
    # so the double-entry book stays local and Stitch is used for what it
    # actually is: the rail a movement settles over. With no credentials the
    # rail falls back to paper settlement and the loop still runs end to end.
    STITCH_TOKEN_URL: str = "https://secure.stitch.money/connect/token"
    STITCH_GRAPHQL_URL: str = "https://api.stitch.money/graphql"
    STITCH_CLIENT_ID: str = ""
    STITCH_CLIENT_SECRET: str = ""

    # Off by default, and deliberately so: with this set every ledger write
    # creates a real Stitch disbursement and real funds move. Left false, the
    # integration still performs a genuine authenticated handshake and stamps
    # each movement with the Stitch client reference, without moving money.
    STITCH_ALLOW_DISBURSEMENT: bool = False
    STITCH_BENEFICIARY_NAME: str = ""
    STITCH_BENEFICIARY_ACCOUNT: str = ""
    STITCH_BENEFICIARY_ACCOUNT_TYPE: str = "current"
    STITCH_BENEFICIARY_BANK_ID: str = ""

    # --- ElevenLabs (voice narration + spoken constraints) ---
    # Accepts a single key or comma-separated keys for automatic rotation.
    ELEVENLABS_API_KEY: str = ""
    ELEVENLABS_VOICE_ID: str = "JBFqnCBsd6RMkjVDRZzb"
    ELEVENLABS_MODEL_ID: str = "eleven_flash_v2_5"
    ELEVENLABS_AGENT_ID: str = ""
    VOICE_NARRATION_ENABLED: bool = True

    # --- Angel One SmartAPI (Indian equity market data) ---
    ANGEL_API_KEY: str = ""
    ANGEL_CLIENT_ID: str = ""
    ANGEL_PASSWORD: str = ""
    ANGEL_TOTP_SECRET: str = ""

    @property
    def elevenlabs_api_keys(self) -> list[str]:
        """Return all configured ElevenLabs keys as a list.

        The env var accepts a single key or comma-separated keys.
        Empty / whitespace-only entries are silently dropped.
        """
        if not self.ELEVENLABS_API_KEY:
            return []
        return [k.strip() for k in self.ELEVENLABS_API_KEY.split(",") if k.strip()]

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug(cls, v):
        """Parse DEBUG from various string representations.
        Accepts: true, false, 1, 0, yes, no (case-insensitive).
        Rejects anything else with a clear error."""
        if isinstance(v, bool):
            return v
        if isinstance(v, int):
            return bool(v)
        if isinstance(v, str):
            lower = v.strip().lower()
            if lower in ("true", "1", "yes"):
                return True
            if lower in ("false", "0", "no"):
                return False
            raise ValueError(
                f"Invalid DEBUG value: '{v}'. "
                f"Must be one of: true, false, 1, 0, yes, no"
            )
        raise ValueError(f"Invalid DEBUG type: {type(v)}")

    @field_validator("JWT_SECRET", mode="before")
    @classmethod
    def validate_jwt_secret(cls, v):
        """Ensure JWT_SECRET is set and not an insecure default."""
        if not v or v.strip() == "":
            # Auto-generate for development convenience, but warn
            import logging
            generated = secrets.token_urlsafe(48)
            logging.getLogger("trustvault.config").warning(
                "JWT_SECRET not set — generated a random secret. "
                "Set JWT_SECRET in .env for production!"
            )
            return generated
        if v in _INSECURE_SECRETS:
            import logging
            generated = secrets.token_urlsafe(48)
            logging.getLogger("trustvault.config").warning(
                f"JWT_SECRET is a known insecure default — generated a random secret. "
                f"Set a strong JWT_SECRET in .env for production!"
            )
            return generated
        if len(v) < 32:
            raise ValueError(
                "JWT_SECRET is too short (minimum 32 characters). "
                "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
            )
        return v
        
    @field_validator("ENCRYPTION_KEY", mode="before")
    @classmethod
    def validate_encryption_key(cls, v):
        if not v or v.strip() == "":
            from cryptography.fernet import Fernet
            import logging
            generated = Fernet.generate_key().decode()
            logging.getLogger("trustvault.config").warning(
                "ENCRYPTION_KEY not set — generated a random secret. "
                "Set ENCRYPTION_KEY in .env for production!"
            )
            return generated
        return v

    @field_validator("HMAC_SECRET", mode="before")
    @classmethod
    def validate_hmac_secret(cls, v):
        if not v or v.strip() == "":
            import logging
            generated = secrets.token_urlsafe(32)
            logging.getLogger("trustvault.config").warning(
                "HMAC_SECRET not set — generated a random secret. "
                "Set HMAC_SECRET in .env for production!"
            )
            return generated
        return v

    class Config:
        env_file = "../.env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
