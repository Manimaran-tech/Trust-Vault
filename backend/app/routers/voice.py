"""
Voice endpoints — ElevenLabs narration out, spoken constraints in.

A spoken instruction may change the risk envelope or halt the desk. It cannot
order a specific trade: the agent decides what to do inside the constraints it
is given, which is the autonomy boundary the system is built around.
"""
import logging

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import portfolio_service, voice, voice_fraud
from app.auth.dependencies import get_current_user, require_role
from app.autonomous_loop import autonomous_loop
from app.database import get_db
from app.models.market_decision import MarketDecision
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["Voice"])

MAX_AUDIO_BYTES = 10 * 1024 * 1024


@router.get("/status")
async def get_voice_status(current_user: User = Depends(get_current_user)):
    """Whether voice is available, and if not, why."""
    return voice.status()


@router.get("/narration/{decision_id}")
async def get_narration_audio(
    decision_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Spoken audio for one decision, as MP3."""
    result = await db.execute(
        select(MarketDecision).where(MarketDecision.id == decision_id)
    )
    decision = result.scalar_one_or_none()
    if decision is None:
        raise HTTPException(status_code=404, detail="Decision not found")

    if not voice.is_configured():
        raise HTTPException(
            status_code=503,
            detail="Voice narration is unavailable: ELEVENLABS_API_KEY is not set.",
        )

    text = voice.compose_narration(decision, decision.explainability_summary or "")
    try:
        audio = await voice.synthesize(text)
    except Exception as e:
        logger.warning(f"[Voice] synthesis failed for {decision_id[:8]}: {e}")
        raise HTTPException(status_code=502, detail=f"Speech synthesis failed: {e}")

    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.post("/speak")
async def speak_text(
    text: str = Body(..., embed=True, min_length=1, max_length=1000),
    current_user: User = Depends(get_current_user),
):
    """Render arbitrary text to speech — used for briefings and alerts."""
    if not voice.is_configured():
        raise HTTPException(
            status_code=503,
            detail="Voice is unavailable: ELEVENLABS_API_KEY is not set.",
        )
    try:
        audio = await voice.synthesize(text)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Speech synthesis failed: {e}")
    return Response(content=audio, media_type="audio/mpeg")


@router.post("/constraint")
async def apply_spoken_constraint(
    transcript: str = Body(..., embed=True, min_length=2, max_length=500),
    confirm: bool = Query(
        False,
        description="Apply the change. Without this the endpoint only reports "
        "what it understood, so a misheard instruction can be caught first.",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """
    Interpret a spoken instruction and, on confirmation, apply it.

    The default is a dry run. Speech recognition is imperfect and these values
    govern how much capital the agent may put at risk, so the interpretation is
    shown before anything changes.
    """
    try:
        parsed = await voice.parse_spoken_constraint(transcript)
    except Exception as e:
        raise HTTPException(
            status_code=502, detail=f"Could not interpret the instruction: {e}"
        )

    portfolio = await portfolio_service.get_or_create_portfolio(db)

    if not confirm:
        return {
            **parsed,
            "applied": False,
            "note": "Dry run. Re-send with confirm=true to apply.",
            "current_constraints": portfolio.constraints,
        }

    result = {"applied": {}, "rejected": {}, "constraints": portfolio.constraints}
    if parsed["constraints"]:
        result = await portfolio_service.set_constraints(
            db, portfolio, parsed["constraints"]
        )

    command_result = None
    command = parsed.get("command", "none")
    if command == "halt":
        portfolio.halted = True
        portfolio.halt_reason = f"Halted by voice instruction from {current_user.username}"
        autonomous_loop.pause()
        command_result = "Desk halted and decision loop paused."
    elif command == "resume":
        portfolio.halted = False
        portfolio.halt_reason = None
        autonomous_loop.resume()
        command_result = "Desk resumed."
    elif command == "flatten":
        # Flattening liquidates real positions, so it is never executed from a
        # transcript. The operator confirms it explicitly at its own endpoint.
        command_result = (
            "Flatten was understood but is not executed from a voice transcript. "
            "Confirm at POST /api/portfolio/flatten."
        )

    return {
        **parsed,
        "applied": True,
        "result": result,
        "command_result": command_result,
    }


@router.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    current_user: User = Depends(require_role("admin")),
):
    """Speech to text, for the spoken-constraint flow."""
    if not voice.is_configured():
        raise HTTPException(
            status_code=503,
            detail="Transcription is unavailable: ELEVENLABS_API_KEY is not set.",
        )

    audio = await file.read()
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio exceeds the 10 MB limit")
    if not audio:
        raise HTTPException(status_code=400, detail="Empty audio upload")

    try:
        text = await voice.transcribe(audio, file.filename or "speech.webm")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {e}")

    return {"transcript": text}


@router.get("/briefing")
async def get_briefing(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    A short spoken summary of where the desk stands, as text.

    Returned as text rather than audio so the caller can display it, speak it,
    or both — and so it still works when voice is unconfigured.
    """
    from app.market.feed import market_feed

    portfolio = await portfolio_service.get_or_create_portfolio(db)
    state = await portfolio_service.compute_state(db, portfolio, market_feed.snapshot())

    parts = [
        f"Net asset value is {voice._speakable_money(state['nav'])}, "
        f"{'up' if state['return_pct'] >= 0 else 'down'} "
        f"{abs(state['return_pct']):.1%} since inception.",
        f"{state['open_position_count']} open "
        f"{'position' if state['open_position_count'] == 1 else 'positions'}, "
        f"using {state['exposure_pct']:.0%} of the "
        f"{state['max_exposure_pct']:.0%} exposure limit.",
        f"Realised profit and loss is "
        f"{voice._speakable_money(abs(state['realized_pnl']))} "
        f"{'positive' if state['realized_pnl'] >= 0 else 'negative'}.",
        f"Drawdown from peak is {state['drawdown_pct']:.1%} against a "
        f"{state['max_drawdown_pct']:.0%} limit.",
    ]
    if state["halted"]:
        parts.append(f"The desk is halted. {state['halt_reason']}")
    if state["positions_marked_at_entry"]:
        parts.append(
            f"Note: {', '.join(state['positions_marked_at_entry'])} "
            f"{'has' if len(state['positions_marked_at_entry']) == 1 else 'have'} "
            f"no fresh quote and are marked at entry."
        )

    return {"text": " ".join(parts), "state": state}


# --------------------------------------------------------------------- #
# Synthetic voice fraud range
# --------------------------------------------------------------------- #
# Voice cloning turned "a call from the CFO" into a live attack on treasury
# operations, and it is the one attack the transaction controls cannot see:
# by the time the instruction becomes a payment it looks properly authorised.
# The range exercises the control that has to sit on the call itself.


@router.get("/fraud/status")
async def fraud_range_status(current_user: User = Depends(get_current_user)):
    """Whether the range can run, and what it has issued so far."""
    return voice_fraud.status()


@router.get("/fraud/scenarios")
async def fraud_scenarios(current_user: User = Depends(get_current_user)):
    """The scripted attacks available on the range."""
    return {"scenarios": voice_fraud.list_scenarios()}


@router.get("/fraud/provenance")
async def fraud_provenance(current_user: User = Depends(get_current_user)):
    """
    Every clip this range has issued, keyed by the hash of its audio.

    This is the ground truth the screen checks against, and it is the only
    thing in the system that can prove a clip is synthetic rather than infer it.
    """
    return {"clips": voice_fraud.provenance_ledger()}


@router.post("/fraud/generate/{scenario_id}")
async def fraud_generate(
    scenario_id: str,
    current_user: User = Depends(require_role("admin", "csr")),
):
    """
    Synthesise one scripted attack call and return it as MP3.

    The clip is registered in the provenance ledger before it is returned, so
    the screen can prove afterwards where it came from. Every script
    impersonates a fictional officer of a fictional counterparty; the range
    clones nobody and accepts no voice sample.
    """
    if not voice.is_configured():
        raise HTTPException(
            status_code=503,
            detail="The range is unavailable: ELEVENLABS_API_KEY is not set.",
        )
    try:
        audio, record = await voice_fraud.generate(scenario_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.warning("[VoiceFraud] generation failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Speech synthesis failed: {e}")

    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={
            "X-Clip-Sha256": record["sha256"],
            "X-Clip-Synthetic": "true",
            "X-Clip-Drill": "true",
            "Cache-Control": "no-store",
        },
    )


@router.post("/fraud/run/{scenario_id}")
async def fraud_run(
    scenario_id: str,
    deep: bool = Query(
        False,
        description="Also ask the model to judge the instruction. Off by "
        "default because the deterministic screen answers immediately and the "
        "model can take most of a minute on a local runtime.",
    ),
    current_user: User = Depends(require_role("admin", "csr")),
):
    """
    Generate a scripted call and screen it in one pass.

    This is the demonstrable loop: the attack is produced, then put through
    the same screen an inbound recording would face, and the verdict names
    which check carried it.
    """
    if not voice.is_configured():
        raise HTTPException(
            status_code=503,
            detail="The range is unavailable: ELEVENLABS_API_KEY is not set.",
        )
    try:
        audio, record = await voice_fraud.generate(scenario_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Speech synthesis failed: {e}")

    scenario = voice_fraud.SCENARIOS[scenario_id]
    # The range knows its own script, so the screen is run against the true
    # text rather than spending a Scribe call to recover text we already hold.
    # A transcription of our own synthesis would only measure Scribe.
    result = await voice_fraud.screen(audio, transcript=scenario["script"], deep=deep)
    result["scenario"] = {
        k: v for k, v in scenario.items() if k != "script"
    }
    result["audio_url"] = f"/api/voice/fraud/generate/{scenario_id}"
    return result


@router.post("/fraud/screen")
async def fraud_screen(
    file: UploadFile = File(None),
    transcript: str = Query(
        None,
        description="Screen this text directly instead of uploading audio.",
        max_length=4000,
    ),
    deep: bool = Query(
        True,
        description="Ask the model to judge the instruction as well as the "
        "deterministic screen. On by default here: screening a recording is a "
        "deliberate act and the caller is waiting for a considered answer.",
    ),
    current_user: User = Depends(require_role("admin", "csr")),
):
    """
    Screen a call recording, or a transcript of one.

    Audio is transcribed with Scribe and then judged on what the caller says.
    The provenance check runs too, but only recognises clips this range issued
    — it is proof of synthesis when it hits and proof of nothing when it misses.
    """
    audio = b""
    if file is not None:
        audio = await file.read()
        if len(audio) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="Audio exceeds the 10 MB limit")

    if not audio and not transcript:
        raise HTTPException(
            status_code=400,
            detail="Provide either an audio file or a transcript to screen.",
        )

    if audio and not transcript and not voice.is_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "Audio screening needs transcription, and ELEVENLABS_API_KEY is "
                "not set. Send a transcript instead."
            ),
        )

    try:
        return await voice_fraud.screen(audio, transcript=transcript, deep=deep)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
