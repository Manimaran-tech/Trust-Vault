"""
Voice layer — ElevenLabs.

Two directions, both narrow by design:

  out — the desk speaks each executed action and its reasoning, so an operator
        can follow a loop that otherwise runs faster than anyone reads.
  in  — spoken constraint changes. A person says what the limits are; the agent
        decides everything else inside them.

Voice is a reporting and constraint channel. It is never a decision path: a
spoken instruction can tighten or loosen the envelope, and can halt the desk,
but cannot order a specific trade. That keeps the autonomy boundary where the
problem statement puts it — humans define constraints, the agent decides
whether and how to act within them.
"""
import logging
import re
import threading

import httpx

from app.config import get_settings
from app.models.market_decision import MarketDecision
from app.ws_manager import ws_manager

logger = logging.getLogger(__name__)
settings = get_settings()

ELEVENLABS_BASE = "https://api.elevenlabs.io/v1"
TTS_TIMEOUT = 30.0
MAX_NARRATION_CHARS = 600

# HTTP status codes that trigger key rotation
_ROTATE_ON = {429, 401, 403}


# --------------------------------------------------------------------- #
# Key rotator — round-robin with automatic fallback
# --------------------------------------------------------------------- #

class KeyRotator:
    """Thread-safe round-robin key pool with automatic fallback.

    On each call to `current()`, returns the active key.  When `rotate()` is
    called (typically after a 429/401/403), advances to the next key and marks
    the bad one as temporarily failed.  If every key has been tried in one
    round, raises RuntimeError so the caller can surface a clear error rather
    than spinning.
    """

    def __init__(self, keys: list[str]):
        self._keys = list(keys)
        self._index = 0
        self._lock = threading.Lock()
        self._failures = 0  # consecutive failures in one round

    @property
    def pool_size(self) -> int:
        return len(self._keys)

    def current(self) -> str:
        """Return the current active key."""
        if not self._keys:
            raise RuntimeError("No ElevenLabs API keys configured")
        with self._lock:
            return self._keys[self._index % len(self._keys)]

    def rotate(self, bad_key: str) -> str:
        """Advance past *bad_key* and return the next key.

        Raises RuntimeError if all keys have been exhausted in one round.
        """
        with self._lock:
            # Only advance if the bad key is still the current one (prevents
            # double-rotation from concurrent callers).
            if self._keys[self._index % len(self._keys)] == bad_key:
                self._failures += 1
                if self._failures >= len(self._keys):
                    self._failures = 0
                    raise RuntimeError(
                        "All ElevenLabs API keys exhausted — every key "
                        "returned a rate-limit or auth error."
                    )
                self._index = (self._index + 1) % len(self._keys)
                logger.warning(
                    "[Voice] Rotating ElevenLabs key (%d/%d remaining in round)",
                    len(self._keys) - self._failures,
                    len(self._keys),
                )
            return self._keys[self._index]

    def reset_failures(self) -> None:
        """Call after a successful request to reset the failure counter."""
        with self._lock:
            self._failures = 0


# Module-level singleton — shared by synthesize() and transcribe().
_rotator = KeyRotator(settings.elevenlabs_api_keys)


def is_configured() -> bool:
    return _rotator.pool_size > 0


def status() -> dict:
    return {
        "configured": is_configured(),
        "narration_enabled": settings.VOICE_NARRATION_ENABLED and is_configured(),
        "voice_id": settings.ELEVENLABS_VOICE_ID,
        "model_id": settings.ELEVENLABS_MODEL_ID,
        "agent_id": settings.ELEVENLABS_AGENT_ID or None,
        "key_pool_size": _rotator.pool_size,
        "reason": None
        if is_configured()
        else "ELEVENLABS_API_KEY is not set; narration is disabled.",
    }


# --------------------------------------------------------------------- #
# Speech out
# --------------------------------------------------------------------- #

async def synthesize(
    text: str,
    voice_id: str | None = None,
    stability: float = 0.5,
    style: float = 0.0,
) -> bytes:
    """
    Render text to MP3 audio.

    `voice_id` selects which stock ElevenLabs voice speaks. The desk's own
    narration uses the configured default; the fraud range uses a deliberately
    different one, so an operator can hear that the two are not the same
    speaker. Uses the key rotator: on a rate-limit or auth error the next key
    is tried automatically. Raises when unconfigured or when every key fails.
    """
    if not is_configured():
        raise RuntimeError("ELEVENLABS_API_KEY is not configured")

    voice_id = voice_id or settings.ELEVENLABS_VOICE_ID

    text = text.strip()[:MAX_NARRATION_CHARS]
    if not text:
        raise ValueError("Nothing to speak")

    last_error: Exception | None = None

    for _ in range(_rotator.pool_size):
        api_key = _rotator.current()
        try:
            async with httpx.AsyncClient(timeout=TTS_TIMEOUT) as client:
                resp = await client.post(
                    f"{ELEVENLABS_BASE}/text-to-speech/{voice_id}",
                    headers={
                        "xi-api-key": api_key,
                        "Content-Type": "application/json",
                    },
                    json={
                        "text": text,
                        "model_id": settings.ELEVENLABS_MODEL_ID,
                        "voice_settings": {
                            # Steady and clear by default: a risk readout is not
                            # a performance. The fraud range raises `style` and
                            # lowers `stability` because a social-engineering
                            # call is delivered with urgency, and a drill that
                            # sounds nothing like the real thing teaches nothing.
                            "stability": stability,
                            "similarity_boost": 0.75,
                            "style": style,
                            "use_speaker_boost": True,
                        },
                    },
                )
                if resp.status_code in _ROTATE_ON:
                    logger.warning(
                        "[Voice] Key …%s returned %d — rotating",
                        api_key[-6:], resp.status_code,
                    )
                    _rotator.rotate(api_key)
                    last_error = httpx.HTTPStatusError(
                        f"ElevenLabs {resp.status_code}",
                        request=resp.request,
                        response=resp,
                    )
                    continue

                resp.raise_for_status()
                _rotator.reset_failures()
                return resp.content

        except httpx.HTTPStatusError:
            raise
        except Exception as exc:
            logger.warning("[Voice] Request with key …%s failed: %s", api_key[-6:], exc)
            last_error = exc
            try:
                _rotator.rotate(api_key)
            except RuntimeError:
                break

    raise last_error or RuntimeError("ElevenLabs synthesis failed — no keys available")


def compose_narration(decision: MarketDecision, reasoning: str) -> str:
    """
    Turn a decision into a spoken sentence.

    Written to be heard rather than read: figures are rounded to what a listener
    can actually hold, and the reason comes last so the action lands first.
    """
    action = decision.action
    side = decision.side or ""
    symbol = _speakable_symbol(decision.symbol)
    notional = float(decision.proposed_notional or 0)

    if action == "open":
        head = (
            f"Opening a {side} position in {symbol}, "
            f"{_speakable_money(notional)}, "
            f"at {decision.aggregated_confidence:.0%} consensus confidence."
        )
    elif action == "close":
        pnl = float(decision.realized_pnl) if decision.realized_pnl is not None else None
        head = f"Closing {symbol}."
        if pnl is not None:
            head += (
                f" Realised {'gain' if pnl >= 0 else 'loss'} of "
                f"{_speakable_money(abs(pnl))}."
            )
    else:
        head = f"Holding {symbol}."

    trigger = (decision.trigger or "").replace("_", " ")
    if trigger:
        head += f" Triggered by {trigger}."

    return f"{head} {_first_sentences(reasoning, 2)}"


async def narrate_decision(decision: MarketDecision, reasoning: str) -> None:
    """
    Speak an executed decision.

    The text is always broadcast to connected clients so the narration is
    visible even when audio is unavailable; the audio itself is best-effort.
    """
    text = compose_narration(decision, reasoning)

    await ws_manager.broadcast(
        {
            "type": "voice_narration",
            "data": {
                "decision_id": decision.id,
                "text": text,
                "symbol": decision.symbol,
                "audio_available": settings.VOICE_NARRATION_ENABLED and is_configured(),
                "audio_url": f"/api/voice/narration/{decision.id}",
            },
        }
    )

    if not (settings.VOICE_NARRATION_ENABLED and is_configured()):
        return

    try:
        await synthesize(text)
    except Exception as e:
        logger.warning(f"[Voice] narration synthesis failed: {e}")


# --------------------------------------------------------------------- #
# Spoken constraints in
# --------------------------------------------------------------------- #

CONSTRAINT_PROMPT = """You extract risk constraints from a spoken instruction.

Return ONLY JSON in this shape:
{
  "decision": "approve",
  "confidence": <0.0-1.0 — how clearly the instruction states the constraint>,
  "reasoning": "<one sentence restating what you understood>",
  "risk_flags": [],
  "constraints": {"<key>": <number>},
  "command": "<none|halt|resume|flatten>"
}

Valid constraint keys and their units, all as decimal fractions except the bps ones:
  max_exposure_pct   — total capital deployable, e.g. "cap exposure at 40 percent" -> 0.40
  max_position_pct   — largest single position, e.g. "no more than 10 percent in one name" -> 0.10
  max_drawdown_pct   — loss from peak before halting, e.g. "stop at 8 percent down" -> 0.08
  target_vol         — target annualised volatility, e.g. "target 15 percent vol" -> 0.15
  min_edge_bps       — minimum edge to act, in basis points, e.g. "need at least 20 bps" -> 20
  fee_bps            — assumed execution fee in basis points

Set "command" when the speaker asks the desk to stop trading (halt), start
again (resume), or close everything (flatten). Otherwise "none".

Include only what the instruction actually states. If nothing maps to a valid
key and no command is given, return an empty constraints object, command "none",
and a low confidence. Never guess a number the speaker did not say."""


async def parse_spoken_constraint(transcript: str) -> dict:
    """
    Turn a spoken instruction into a constraint change.

    The model extracts; `portfolio_service.set_constraints` validates and clamps.
    A misheard "fifty" for "fifteen" therefore cannot hand the desk more risk
    than the permitted range allows.
    """
    from app.llm.client import query_llm

    result = await query_llm(
        system_prompt=CONSTRAINT_PROMPT,
        user_prompt=f'Spoken instruction: "{transcript}"',
        temperature=0.1,
        max_tokens=400,
    )

    constraints = result.get("constraints") or {}
    command = (result.get("command") or "none").lower()
    if command not in ("none", "halt", "resume", "flatten"):
        command = "none"

    return {
        "transcript": transcript,
        "constraints": constraints,
        "command": command,
        "confidence": float(result.get("confidence", 0.0)),
        "understood_as": result.get("reasoning", ""),
    }


async def transcribe(audio_bytes: bytes, filename: str = "speech.webm") -> str:
    """Speech to text via ElevenLabs Scribe, with key rotation."""
    if not is_configured():
        raise RuntimeError("ELEVENLABS_API_KEY is not configured")

    last_error: Exception | None = None

    for _ in range(_rotator.pool_size):
        api_key = _rotator.current()
        try:
            async with httpx.AsyncClient(timeout=TTS_TIMEOUT) as client:
                resp = await client.post(
                    f"{ELEVENLABS_BASE}/speech-to-text",
                    headers={"xi-api-key": api_key},
                    files={"file": (filename, audio_bytes, "application/octet-stream")},
                    data={"model_id": "scribe_v1"},
                )
                if resp.status_code in _ROTATE_ON:
                    logger.warning(
                        "[Voice] Key …%s returned %d on transcribe — rotating",
                        api_key[-6:], resp.status_code,
                    )
                    _rotator.rotate(api_key)
                    last_error = httpx.HTTPStatusError(
                        f"ElevenLabs {resp.status_code}",
                        request=resp.request,
                        response=resp,
                    )
                    continue

                resp.raise_for_status()
                _rotator.reset_failures()
                return resp.json().get("text", "")

        except httpx.HTTPStatusError:
            raise
        except Exception as exc:
            logger.warning("[Voice] Transcribe with key …%s failed: %s", api_key[-6:], exc)
            last_error = exc
            try:
                _rotator.rotate(api_key)
            except RuntimeError:
                break

    raise last_error or RuntimeError("ElevenLabs transcription failed — no keys available")


# --------------------------------------------------------------------- #
# Speech shaping
# --------------------------------------------------------------------- #

def _speakable_symbol(symbol: str) -> str:
    """BTCUSDT is unpronounceable; "Bitcoin against dollars" is not."""
    names = {
        "BTC": "Bitcoin",
        "ETH": "Ethereum",
        "SOL": "Solana",
        "XRP": "Ripple",
        "ADA": "Cardano",
        "DOGE": "Dogecoin",
    }
    # NSE tickers are company names and are read as such.
    names.update(
        {
            "RELIANCE": "Reliance",
            "HDFCBANK": "H D F C Bank",
            "ICICIBANK": "I C I C I Bank",
            "INFY": "Infosys",
            "TCS": "T C S",
            "SBIN": "State Bank of India",
            "AXISBANK": "Axis Bank",
            "KOTAKBANK": "Kotak Bank",
        }
    )
    s = symbol.upper()
    for quote in ("USDT", "USDC", "USD", "BUSD"):
        if s.endswith(quote) and len(s) > len(quote):
            root = s[: -len(quote)]
            return names.get(root, root)
    return names.get(s, s)


def _speakable_money(amount: float) -> str:
    """
    Say an amount the way the desk's operators would say it.

    Indian markets are spoken in lakh and crore, not millions. Reading a rupee
    figure out in millions is the audible equivalent of the dollar sign that
    used to sit in front of these numbers.
    """
    unit = get_settings().BASE_CURRENCY
    if unit != "INR":
        if amount >= 1_000_000:
            return f"{amount / 1_000_000:.1f} million {unit}"
        if amount >= 1_000:
            return f"{amount / 1_000:.0f} thousand {unit}"
        return f"{amount:,.0f} {unit}"

    if amount >= 10_000_000:
        return f"{amount / 10_000_000:.2f} crore rupees"
    if amount >= 100_000:
        return f"{amount / 100_000:.2f} lakh rupees"
    if amount >= 1_000:
        return f"{amount / 1_000:.0f} thousand rupees"
    return f"{amount:,.0f} rupees"


def _first_sentences(text: str, count: int) -> str:
    if not text:
        return ""
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return " ".join(sentences[:count])
