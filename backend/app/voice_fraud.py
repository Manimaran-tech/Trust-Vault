"""
Synthetic voice fraud range.

Voice cloning has made the "call from the CFO" a live attack on treasury
operations, and it is the one attack a bank's transaction controls do not see:
by the time a payment instruction reaches the fraud pipeline it looks like an
ordinary authorised transfer. The control has to sit on the call.

This module is the range that exercises that control end to end:

  generate   Synthesises a scripted social-engineering call with ElevenLabs,
             using a stock voice that is deliberately *not* the desk's own
             narration voice, and registers the clip in a provenance ledger
             keyed by the SHA-256 of the audio itself.
  screen     Takes audio — the range's own, or a recording the operator
             uploads — transcribes it with Scribe, and runs it through two
             independent checks that are then combined into one verdict.

The two checks are deliberately different in kind, because each one fails in
a way the other does not:

  provenance  Cryptographic. Did this exact audio come out of this range? A
              hash match is proof, not an estimate. It generalises to nothing
              outside the range, and says so.
  linguistic  Behavioural. Does the *instruction* carry the structure of a
              social-engineering attempt — manufactured urgency, claimed
              authority, secrecy, a changed beneficiary, a push off the
              normal channel? This is what generalises to a real call, and it
              is scored from the words, not from the acoustics.

What this module explicitly does **not** do is claim to detect a deepfake from
the audio signal. No spectral or artefact analysis is performed here, so none
is reported. Saying "synthetic" on the strength of a hash we put there
ourselves, while implying an acoustic capability that does not exist, would be
the same species of dishonesty the rest of this system was built to avoid.

Safety: every script impersonates a fictional officer of a fictional bank, and
every generated clip is stamped as a drill in its provenance record. The range
generates only from its own fixed scripts using ElevenLabs stock voices — it
does not clone a voice, and it takes no voice sample as input.
"""
import hashlib
import logging
import re
import time
from datetime import datetime, timezone

from app import voice
from app.config import get_settings
from app.ws_manager import ws_manager

logger = logging.getLogger(__name__)
settings = get_settings()

# A stock ElevenLabs voice that is not the desk's narration voice, so an
# operator hearing both can tell they are not the same speaker.
IMPOSTOR_VOICE_ID = "onwK4e9ZLuTAKqWW03F9"

# Delivered with urgency rather than the flat calm of a risk readout: a drill
# that sounds nothing like the real thing teaches nothing.
IMPOSTOR_STABILITY = 0.35
IMPOSTOR_STYLE = 0.55


# --------------------------------------------------------------------- #
# Scenario library
# --------------------------------------------------------------------- #
# Each script is a complete attack: who the caller claims to be, what they
# want moved, and the pressure they apply to get it done without the normal
# checks. All parties are fictional.

SCENARIOS = {
    "cfo_emergency_vendor": {
        "id": "cfo_emergency_vendor",
        "title": "CFO — emergency vendor settlement",
        "impersonates": "Chief Financial Officer",
        "claimed_name": "Ananya Rao",
        "amount": 4_800_000.0,
        "beneficiary": "Meridian Supply Services",
        "channel": "inbound call to treasury desk",
        "tactics": ["urgency", "authority", "secrecy", "channel_bypass"],
        "script": (
            "This is Ananya Rao. I need you to move forty eight lakh rupees to "
            "Meridian Supply Services today, before close. The account details "
            "have changed since last time, I will send the new ones now. Do not "
            "route this through the usual approval queue, we do not have time "
            "and I have already cleared it. And keep this between us until the "
            "announcement on Monday."
        ),
    },
    "bank_official_verification": {
        "id": "bank_official_verification",
        "title": "Bank official — account verification",
        "impersonates": "Bank fraud-desk officer",
        "claimed_name": "Officer Vikram Sethi",
        "amount": 0.0,
        "beneficiary": "n/a — credential harvest",
        "channel": "inbound call to account holder",
        "tactics": ["authority", "urgency", "credential_request", "fear"],
        "script": (
            "I am calling from the bank's fraud department. We have detected "
            "unauthorised activity on your account. To secure it I need you to "
            "confirm the one time passcode we have just sent to your phone. If "
            "you do not confirm within two minutes the account will be frozen "
            "and your salary credit will fail."
        ),
    },
    "vendor_bank_change": {
        "id": "vendor_bank_change",
        "title": "Supplier — banking detail change",
        "impersonates": "Long-standing supplier's accounts contact",
        "claimed_name": "Rahul Menon, Kestrel Logistics",
        "amount": 1_250_000.0,
        "beneficiary": "Kestrel Logistics (new account)",
        "channel": "voicemail to accounts payable",
        "tactics": ["beneficiary_change", "plausibility", "urgency"],
        "script": (
            "Hello, this is Rahul from Kestrel Logistics accounts. We have "
            "switched banks this quarter, so the invoice due Friday for twelve "
            "lakh fifty thousand needs to go to the new account. I have emailed "
            "the details across. Could you push it through today, our old "
            "account closes tomorrow morning."
        ),
    },
    "board_member_wire": {
        "id": "board_member_wire",
        "title": "Board member — confidential acquisition wire",
        "impersonates": "Non-executive board member",
        "claimed_name": "Dr Suresh Iyer",
        "amount": 22_000_000.0,
        "beneficiary": "Escrow account, unnamed counterparty",
        "channel": "inbound call to the trading desk",
        "tactics": ["authority", "secrecy", "regulatory_pressure", "channel_bypass"],
        "script": (
            "Suresh here. We are closing an acquisition and I need two crore "
            "twenty lakh wired into the escrow account within the hour. This is "
            "price sensitive and subject to regulatory confidentiality, so it "
            "cannot go through committee and you must not discuss it with the "
            "risk team. I will take personal responsibility for the approval."
        ),
    },
    "control_legitimate": {
        "id": "control_legitimate",
        "title": "Control — genuine routine instruction",
        "impersonates": "none — this is the negative control",
        "claimed_name": "Priya Nair, Treasury Operations",
        "amount": 300_000.0,
        "beneficiary": "Payroll settlement account",
        "channel": "internal line, scheduled call",
        "tactics": [],
        "script": (
            "Hi, Priya from treasury operations. The scheduled payroll "
            "settlement of three lakh rupees is ready for release. It has the "
            "usual two approvals recorded in the queue, and the beneficiary is "
            "unchanged from last month. Please process it in the normal batch, "
            "there is no rush."
        ),
    },
}


# --------------------------------------------------------------------- #
# Provenance ledger
# --------------------------------------------------------------------- #
# Keyed by the SHA-256 of the audio bytes. A hit is proof the clip came out of
# this range; a miss proves nothing either way and is reported as such.

_PROVENANCE: dict[str, dict] = {}


def _register(audio: bytes, scenario: dict, voice_id: str) -> dict:
    digest = hashlib.sha256(audio).hexdigest()
    record = {
        "sha256": digest,
        "scenario_id": scenario["id"],
        "scenario_title": scenario["title"],
        "synthetic": True,
        "drill": True,
        "generator": "elevenlabs",
        "voice_id": voice_id,
        "model_id": settings.ELEVENLABS_MODEL_ID,
        "bytes": len(audio),
        "issued_at": datetime.now(timezone.utc).isoformat(),
    }
    _PROVENANCE[digest] = record
    return record


def provenance_ledger() -> list[dict]:
    """Every clip this range has issued, newest first."""
    return sorted(_PROVENANCE.values(), key=lambda r: r["issued_at"], reverse=True)


def lookup_provenance(audio: bytes) -> dict | None:
    return _PROVENANCE.get(hashlib.sha256(audio).hexdigest())


# --------------------------------------------------------------------- #
# Generation
# --------------------------------------------------------------------- #

def list_scenarios() -> list[dict]:
    """The scripts on the range, without the script text itself."""
    return [
        {k: v for k, v in s.items() if k != "script"} | {"script_preview": s["script"][:120] + "…"}
        for s in SCENARIOS.values()
    ]


async def generate(scenario_id: str) -> tuple[bytes, dict]:
    """
    Synthesise one scripted attack call.

    Returns the MP3 bytes and the provenance record. Raises if voice is not
    configured or the scenario is unknown — a range that silently produces
    nothing is worse than one that refuses.
    """
    scenario = SCENARIOS.get(scenario_id)
    if scenario is None:
        raise ValueError(f"Unknown scenario '{scenario_id}'")

    if not voice.is_configured():
        raise RuntimeError("ELEVENLABS_API_KEY is not configured")

    audio = await voice.synthesize(
        scenario["script"],
        voice_id=IMPOSTOR_VOICE_ID,
        stability=IMPOSTOR_STABILITY,
        style=IMPOSTOR_STYLE,
    )
    record = _register(audio, scenario, IMPOSTOR_VOICE_ID)
    logger.info(
        "[VoiceFraud] generated %s (%d bytes, sha %s…)",
        scenario_id, len(audio), record["sha256"][:12],
    )

    await ws_manager.broadcast(
        {
            "type": "voice_fraud_generated",
            "data": {
                "scenario_id": scenario_id,
                "title": scenario["title"],
                "sha256": record["sha256"],
                "impersonates": scenario["impersonates"],
            },
        }
    )
    return audio, record


# --------------------------------------------------------------------- #
# Linguistic screening
# --------------------------------------------------------------------- #
# Deterministic first. These patterns are the observable structure of a
# social-engineering instruction, and they are scored without a model so the
# screen still produces a defensible verdict when the LLM is slow or absent.

_PRESSURE_PATTERNS: list[tuple[str, str, float, str]] = [
    (
        "manufactured_urgency",
        r"\b(within (the )?(hour|two minutes|\d+ minutes)|before close|today|"
        r"right now|immediately|urgent|no time|by end of day)\b",
        0.18,
        "Imposes a deadline that removes the time normal approval would take",
    ),
    (
        "claimed_authority",
        r"\b(this is|i am|speaking) .{0,40}\b(cfo|chief financial|director|board|"
        r"officer|head of|fraud department|treasury)\b",
        0.16,
        "Asserts seniority or institutional authority to justify the exception",
    ),
    (
        "secrecy",
        r"\b(between us|do not discuss|don'?t discuss|confidential|"
        r"must not (tell|discuss|mention)|keep this quiet|price sensitive)\b",
        0.22,
        "Requests secrecy, which suppresses the second pair of eyes",
    ),
    (
        "control_bypass",
        r"\b(do not route|bypass|skip|without (the )?(usual )?(approval|committee|"
        r"queue|checks)|cannot go through committee|already cleared)\b",
        0.26,
        "Asks explicitly for the approval control to be skipped",
    ),
    (
        "beneficiary_change",
        r"\b(details have changed|new account|switched banks|change (the )?"
        r"(bank|account) details|updated bank)\b",
        0.24,
        "Redirects funds to an account that differs from the standing record",
    ),
    (
        "credential_request",
        r"\b(one[- ]?time (passcode|password)|otp|pin|cvv|password|"
        r"confirm the code|security code)\b",
        0.30,
        "Solicits an authentication factor, which no genuine officer will do",
    ),
    (
        "fear_of_loss",
        r"\b(will be frozen|will fail|account will be (closed|blocked|suspended)|"
        r"lose access|penalt(y|ies))\b",
        0.14,
        "Threatens a consequence to suppress verification",
    ),
    (
        "personal_liability_offer",
        r"\b(personal responsibility|i(’|')?ll take (the )?responsibility|on my authority)\b",
        0.12,
        "Offers to absorb the accountability that the control exists to assign",
    ),
]


def screen_language(transcript: str) -> dict:
    """
    Score the instruction on observable social-engineering structure.

    Deterministic and explainable: each hit names the pattern, quotes what
    matched, and carries its own weight, so the score can be argued with rather
    than merely believed.
    """
    text = transcript or ""
    hits = []
    score = 0.0

    for name, pattern, weight, why in _PRESSURE_PATTERNS:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            hits.append(
                {
                    "indicator": name,
                    "weight": weight,
                    "matched": match.group(0),
                    "why": why,
                }
            )
            score += weight

    return {
        "score": round(min(1.0, score), 3),
        "indicators": hits,
        "method": "deterministic pattern scan over the transcript",
    }


_ANALYSIS_PROMPT = """You review a transcript of a phone instruction received by
a bank treasury desk and judge whether it shows the structure of a social
engineering attempt.

Judge the INSTRUCTION, not the audio. You cannot hear it and must not comment
on voice quality, accent or whether it sounds synthetic.

Return ONLY JSON in this shape:
{
  "decision": "deny" | "review" | "approve",
  "confidence": <0.0-1.0>,
  "reasoning": "<two sentences: what the caller is asking for, and what about the request is or is not consistent with a genuine one>",
  "risk_flags": ["<short snake_case tags for what you observed>"],
  "recommended_action": "<the single concrete step the desk should take next>"
}

"deny" means the request should not be acted on. "review" means it needs
out-of-band verification before anything moves. "approve" means it is
consistent with a routine, properly authorised instruction.

A genuine instruction tolerates verification. Treat a request that resists
verification, requests secrecy, or asks for an authentication factor as
disqualifying regardless of how plausible the rest of it sounds."""


# The deterministic screen answers in microseconds; the model can take most of
# a minute on a CPU-bound local runtime. Past this the screen reports what it
# has rather than leaving an operator staring at a spinner during a live call.
INTENT_TIMEOUT_SECONDS = 20.0


async def analyze_intent(transcript: str) -> dict:
    """
    Ask the model to judge the instruction.

    Failure degrades to an explicit abstention rather than to an approval: a
    screen that cannot reach its model has learned nothing, and silence must
    not read as consent.
    """
    import asyncio

    from app.llm.client import query_llm

    try:
        result = await asyncio.wait_for(
            query_llm(
                system_prompt=_ANALYSIS_PROMPT,
                user_prompt=f'Transcript of the call:\n"{transcript}"',
                temperature=0.1,
                max_tokens=350,
            ),
            timeout=INTENT_TIMEOUT_SECONDS,
        )
        return {
            "available": True,
            "decision": result.get("decision", "review"),
            "confidence": float(result.get("confidence", 0.0)),
            "reasoning": result.get("reasoning", ""),
            "risk_flags": result.get("risk_flags", []) or [],
            "recommended_action": result.get("recommended_action", ""),
        }
    except asyncio.TimeoutError:
        logger.warning(
            "[VoiceFraud] intent analysis timed out after %ss", INTENT_TIMEOUT_SECONDS
        )
        return _intent_unavailable(
            f"The model did not answer within {INTENT_TIMEOUT_SECONDS:.0f}s. "
            f"The verdict below rests on the deterministic screen alone."
        )
    except Exception as e:
        logger.warning("[VoiceFraud] intent analysis unavailable: %s", e)
        return _intent_unavailable(str(e))


def _intent_unavailable(reason: str) -> dict:
    return {
        "available": False,
        "decision": "review",
        "confidence": 0.0,
        "reasoning": "",
        "risk_flags": [],
        "recommended_action": "",
        "error": reason,
    }


# --------------------------------------------------------------------- #
# The screen
# --------------------------------------------------------------------- #

async def screen(
    audio: bytes, transcript: str | None = None, deep: bool = True
) -> dict:
    """
    Run one clip through the full screen.

    `transcript` may be supplied to skip Scribe — used when the range already
    knows the script, and when transcription is unavailable. `deep=False` skips
    the model leg entirely and returns the deterministic verdict immediately,
    which is what an operator wants while a call is still live.
    """
    started = time.time()

    provenance = lookup_provenance(audio) if audio else None

    transcription_error = None
    if transcript is None:
        if not audio:
            raise ValueError("Nothing to screen: no audio and no transcript")
        try:
            transcript = await voice.transcribe(audio, "call.mp3")
        except Exception as e:
            transcription_error = str(e)
            transcript = ""
            logger.warning("[VoiceFraud] transcription failed: %s", e)

    language = screen_language(transcript)

    if not transcript:
        intent = _intent_unavailable("Nothing was transcribed, so there is nothing to judge.")
    elif not deep:
        intent = _intent_unavailable(
            "Model judgement was not requested. The deterministic screen ran on its own."
        )
    else:
        intent = await analyze_intent(transcript)

    verdict = _combine(provenance, language, intent)

    result = {
        "screened_at": datetime.now(timezone.utc).isoformat(),
        "elapsed_ms": round((time.time() - started) * 1000, 1),
        "audio_sha256": hashlib.sha256(audio).hexdigest() if audio else None,
        "transcript": transcript,
        "transcription_error": transcription_error,
        "provenance": {
            "checked": True,
            "known_synthetic": provenance is not None,
            "record": provenance,
            "note": (
                "This exact audio was issued by this range — a SHA-256 match, "
                "so synthetic origin is proven rather than inferred."
                if provenance
                else (
                    "No provenance record for this audio. That is not evidence "
                    "it is authentic: this check only recognises clips this "
                    "range issued. No acoustic deepfake detection is performed."
                )
            ),
        },
        "language": language,
        "intent": intent,
        **verdict,
    }

    await ws_manager.broadcast(
        {
            "type": "voice_fraud_screened",
            "data": {
                "verdict": result["verdict"],
                "risk_score": result["risk_score"],
                "known_synthetic": provenance is not None,
                "indicators": [h["indicator"] for h in language["indicators"]],
            },
        }
    )
    return result


def _combine(provenance: dict | None, language: dict, intent: dict) -> dict:
    """
    Combine the two checks into one verdict.

    The linguistic score carries the decision because it is the part that
    generalises to a call this range did not generate. Provenance, when it
    hits, is certainty about origin and escalates to the maximum — but its
    absence adds nothing, because absence of a record is not evidence of
    authenticity.
    """
    score = language["score"]
    basis = ["linguistic pattern scan"]

    if intent.get("available"):
        basis.append("model judgement of intent")
        if intent["decision"] == "deny":
            score = max(score, 0.55 + 0.35 * intent["confidence"])
        elif intent["decision"] == "review":
            score = max(score, 0.35)

    if provenance is not None:
        basis.append("provenance hash match")
        score = 1.0

    score = round(min(1.0, score), 3)

    if provenance is not None:
        verdict = "synthetic_confirmed"
        headline = (
            f"Confirmed synthetic. This audio is a registered drill clip "
            f"({provenance['scenario_title']}), matched by SHA-256."
        )
    elif score >= 0.6:
        verdict = "fraudulent_instruction"
        headline = (
            "The instruction carries the structure of a social-engineering "
            "attempt and must not be acted on without out-of-band verification."
        )
    elif score >= 0.3:
        verdict = "requires_verification"
        headline = (
            "Some pressure indicators are present. Verify the caller through a "
            "known-good channel before anything moves."
        )
    else:
        verdict = "consistent_with_genuine"
        headline = (
            "No social-engineering structure detected. Consistent with a routine "
            "authorised instruction — which is not the same as proof of one."
        )

    return {
        "verdict": verdict,
        "risk_score": score,
        "headline": headline,
        "basis": basis,
        "action": (
            intent.get("recommended_action")
            or "Call the requester back on the number held on file, not one they supplied."
        ),
        "limits": (
            "No acoustic or spectral deepfake analysis is performed. A clip this "
            "range did not issue is judged on what the caller says, not on how "
            "the audio was produced."
        ),
    }


def status() -> dict:
    """Whether the range can run, and what it has issued."""
    configured = voice.is_configured()
    return {
        "configured": configured,
        "reason": None if configured else "ELEVENLABS_API_KEY is not set",
        "impostor_voice_id": IMPOSTOR_VOICE_ID,
        "desk_voice_id": settings.ELEVENLABS_VOICE_ID,
        "scenarios": len(SCENARIOS),
        "clips_issued": len(_PROVENANCE),
        "detection": (
            "Provenance by SHA-256 over issued clips, plus a linguistic screen "
            "of the transcribed instruction. No acoustic deepfake detection."
        ),
    }
