"""
ElevenLabs Real-Time Voice Narration Service.

Provides text-to-speech generation with:
- Multi-key round-robin rotation and automatic failover
- In-memory / Redis audio caching to optimize latency and quota usage
- Base64 data URI generation for direct streaming / browser playback
- Non-blocking async execution
"""

import asyncio
import base64
import hashlib
import logging
from typing import Optional
import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# In-memory audio cache: sha256(text + voice_id + model_id) -> base64_audio_uri
_AUDIO_CACHE: dict[str, str] = {}


class ElevenLabsClient:
    """Async client for ElevenLabs TTS with multi-key load balancing and caching."""

    def __init__(self):
        self.settings = get_settings()
        self._current_key_idx = 0
        self._lock = asyncio.Lock()

    def _get_next_api_key(self) -> Optional[str]:
        """Round-robin through the configured API keys."""
        keys = self.settings.get_elevenlabs_keys()
        if not keys:
            return None
        key = keys[self._current_key_idx % len(keys)]
        self._current_key_idx = (self._current_key_idx + 1) % len(keys)
        return key

    async def generate_narration(
        self,
        text: str,
        voice_id: Optional[str] = None,
        model_id: Optional[str] = None,
    ) -> Optional[str]:
        """
        Generate TTS audio from text using ElevenLabs API.

        Returns:
            Data URI string (data:audio/mp3;base64,...) ready for HTML5 Audio playback,
            or None if narration is disabled or all API keys fail.
        """
        if not self.settings.VOICE_NARRATION_ENABLED:
            return None

        keys = self.settings.get_elevenlabs_keys()
        if not keys:
            logger.debug("[ElevenLabs] No API keys configured. Skipping audio generation.")
            return None

        voice = voice_id or self.settings.ELEVENLABS_VOICE_ID
        model = model_id or self.settings.ELEVENLABS_MODEL_ID
        clean_text = text.strip()
        if not clean_text:
            return None

        # Check cache first
        cache_key = hashlib.sha256(f"{voice}:{model}:{clean_text}".encode()).hexdigest()
        if cache_key in _AUDIO_CACHE:
            logger.debug(f"[ElevenLabs] Cache hit for narration: {cache_key[:8]}")
            return _AUDIO_CACHE[cache_key]

        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice}"
        payload = {
            "text": clean_text,
            "model_id": model,
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75,
                "use_speaker_boost": True,
            },
        }

        # Try keys sequentially in case of rate limits or quota exhaustion
        num_keys = len(keys)
        for attempt in range(num_keys):
            async with self._lock:
                api_key = self._get_next_api_key()

            if not api_key:
                break

            headers = {
                "xi-api-key": api_key,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            }

            try:
                async with httpx.AsyncClient(timeout=15.0) as http_client:
                    resp = await http_client.post(url, json=payload, headers=headers)

                    if resp.status_code == 200 and resp.content:
                        b64_audio = base64.b64encode(resp.content).decode("utf-8")
                        data_uri = f"data:audio/mp3;base64,{b64_audio}"
                        _AUDIO_CACHE[cache_key] = data_uri
                        logger.info(
                            f"[ElevenLabs] Generated {len(resp.content)} bytes audio "
                            f"(voice={voice}, model={model}, key_suffix=...{api_key[-6:]})"
                        )
                        return data_uri

                    elif resp.status_code in (401, 429, 402):
                        logger.warning(
                            f"[ElevenLabs] API key ...{api_key[-6:]} returned status {resp.status_code} "
                            f"({resp.text[:100]}). Trying next key..."
                        )
                        continue
                    else:
                        logger.error(
                            f"[ElevenLabs] Request failed: HTTP {resp.status_code} - {resp.text[:200]}"
                        )
                        break

            except Exception as e:
                logger.error(f"[ElevenLabs] HTTP error with key ...{api_key[-6:]}: {e}")
                continue

        logger.warning("[ElevenLabs] Failed to generate narration across all available keys.")
        return None

    def build_decision_narration_script(self, decision_data: dict) -> str:
        """Create a clear, professional narration script from a decision outcome."""
        decision = (decision_data.get("decision") or decision_data.get("final_decision") or "unknown").lower()
        amount = decision_data.get("amount", 0)
        merchant = decision_data.get("merchant") or decision_data.get("merchant_name") or "merchant"
        confidence = decision_data.get("confidence") or decision_data.get("aggregated_confidence") or 0.0
        pct = int(confidence * 100) if confidence <= 1.0 else int(confidence)

        if decision == "approve":
            script = f"TrustVault Alert. Transaction of {amount:,.2f} dollars to {merchant} has been approved with {pct} percent consensus confidence. All governance checks passed."
        elif decision in ("deny", "rejected"):
            reason = decision_data.get("explainability_summary", "")
            if reason and len(reason) < 120:
                script = f"Security Warning. Transaction of {amount:,.2f} dollars to {merchant} was denied. Reason: {reason}"
            else:
                script = f"Security Warning. Transaction of {amount:,.2f} dollars to {merchant} was denied due to elevated risk scores across expert agents."
        elif decision in ("review", "pending_human_review"):
            script = f"Governance Escalation. Transaction of {amount:,.2f} dollars to {merchant} requires human review due to spend threshold limits."
        else:
            script = f"Transaction update for {merchant}. Status is {decision}."

        return script


# Global singleton
elevenlabs_client = ElevenLabsClient()
