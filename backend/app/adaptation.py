"""
Adaptation.

The watchdog already measures how agents behave. This module makes that
measurement consequential: when a position closes, the agents that argued for
it are scored against the realised outcome, and their weight in future
consensus moves toward what their track record justifies.

This is what stops the desk being a fixed strategy. The same market conditions
can produce a different decision next week because the weight behind each
expert has changed in response to results.
"""
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.consensus import AGENT_WEIGHTS
from app.models.agent_performance import AgentPerformance
from app.models.position import Position

logger = logging.getLogger(__name__)
settings = get_settings()

# Baseline weights for the market quorum, mirroring each expert's declared weight.
MARKET_AGENT_WEIGHTS = {
    "signal": 0.20,
    "sentiment": 0.12,
    "volatility": 0.20,
    "exposure": 0.20,
    "liquidity": 0.16,
    "correlation": 0.12,
    "explainability": 0.05,
}

# A weight may drift within this band around its baseline. Adaptation must be
# able to change behaviour without letting one lucky streak silence an expert
# whose job is to say no.
MIN_WEIGHT_MULTIPLE = 0.5
MAX_WEIGHT_MULTIPLE = 1.5

# Agents whose function is to enforce limits are never down-weighted by P&L.
# A risk veto that costs money is often correct, and rewarding the desk for
# overriding its own constraints would be the wrong lesson.
NON_ADAPTIVE_AGENTS = {"exposure"}


async def ensure_performance_records(db: AsyncSession) -> None:
    """Create a baseline record for every agent that lacks one."""
    result = await db.execute(select(AgentPerformance.agent_name))
    existing = set(result.scalars().all())

    for name, weight in MARKET_AGENT_WEIGHTS.items():
        if name not in existing:
            db.add(
                AgentPerformance(
                    agent_name=name, base_weight=weight, current_weight=weight
                )
            )
    await db.flush()


async def record_votes(db: AsyncSession, voting_breakdown: dict) -> int:
    """
    Record that these agents took part in a decision.

    Scoring needs a realised outcome and so lags by however long a position
    stays open. Participation is known immediately, and recording it is what
    lets the console distinguish an agent that is running and arguing from one
    that has never been consulted — a distinction that matters most in exactly
    the period before the first position closes.
    """
    if not voting_breakdown:
        return 0

    now = datetime.now(timezone.utc)
    counted = 0
    for agent_name, vote in voting_breakdown.items():
        if not isinstance(vote, dict):
            continue
        record = await _get_or_create(db, agent_name)
        record.votes_cast = (record.votes_cast or 0) + 1
        record.last_vote_at = now
        
        risk_flags = vote.get("risk_flags", [])
        if risk_flags and "hallucination_detected" in risk_flags:
            record.hallucinations_detected = (record.hallucinations_detected or 0) + 1
        counted += 1

    await db.flush()
    return counted


async def record_outcome(db: AsyncSession, position: Position) -> dict:
    """
    Attribute a closed position's result back to the agents that voted on it.

    An agent that voted approve is credited when the position made money and
    charged when it lost. An agent that voted deny is scored the other way —
    it was right if the trade lost.
    """
    votes = position.entry_agent_votes or {}
    if not votes:
        return {"scored": 0, "reason": "no recorded votes"}

    profitable = float(position.realized_pnl) > 0
    pnl = float(position.realized_pnl)
    scored = []

    for agent_name, vote in votes.items():
        if not isinstance(vote, dict):
            continue
        decision = vote.get("decision")
        confidence = float(vote.get("confidence", 0.0))
        if decision not in ("approve", "deny"):
            continue  # an abstention makes no claim to score

        was_right = (decision == "approve") == profitable

        record = await _get_or_create(db, agent_name)
        record.positions_influenced += 1

        if was_right:
            record.correct_calls += 1
            record.avg_confidence_when_right = _running_mean(
                record.avg_confidence_when_right, record.correct_calls, confidence
            )
        else:
            record.incorrect_calls += 1
            record.avg_confidence_when_wrong = _running_mean(
                record.avg_confidence_when_wrong, record.incorrect_calls, confidence
            )

        # Only agents that argued for the trade carry its P&L.
        if decision == "approve":
            record.attributed_pnl += position.realized_pnl

        scored.append(
            {
                "agent": agent_name,
                "voted": decision,
                "confidence": confidence,
                "correct": was_right,
            }
        )

    await db.flush()
    logger.info(
        f"[Adaptation] scored {len(scored)} agents on {position.symbol} "
        f"P&L {pnl:+,.2f}"
    )
    return {"scored": len(scored), "profitable": profitable, "pnl": pnl, "detail": scored}


async def adapt_weights(db: AsyncSession) -> dict:
    """
    Move each agent's weight toward the weight its hit rate justifies.

    Adjustment is proportional to hit rate relative to a coin flip, applied at
    a configurable learning rate, and clamped to the permitted band. Agents with
    too few samples are left alone rather than being moved on noise.
    """
    result = await db.execute(select(AgentPerformance))
    records = list(result.scalars().all())
    changes = {}

    for record in records:
        total = record.correct_calls + record.incorrect_calls

        if record.agent_name in NON_ADAPTIVE_AGENTS:
            changes[record.agent_name] = {
                "weight": record.current_weight,
                "status": "fixed — constraint enforcement is not scored on P&L",
            }
            continue

        if total < settings.ADAPTATION_MIN_SAMPLES:
            changes[record.agent_name] = {
                "weight": record.current_weight,
                "status": f"holding — {total}/{settings.ADAPTATION_MIN_SAMPLES} samples",
            }
            continue

        hit_rate = record.correct_calls / total
        # 0.5 is chance. Above it the agent earns weight, below it loses weight.
        skill = (hit_rate - 0.5) * 2  # -1..1
        target = record.base_weight * (1 + skill * (MAX_WEIGHT_MULTIPLE - 1))
        new_weight = record.current_weight + settings.ADAPTATION_LEARNING_RATE * (
            target - record.current_weight
        )
        new_weight = max(
            record.base_weight * MIN_WEIGHT_MULTIPLE,
            min(record.base_weight * MAX_WEIGHT_MULTIPLE, new_weight),
        )

        delta = new_weight - record.current_weight
        record.current_weight = new_weight
        record.last_adapted_at = datetime.now(timezone.utc)

        changes[record.agent_name] = {
            "weight": round(new_weight, 4),
            "delta": round(delta, 4),
            "hit_rate": round(hit_rate, 3),
            "samples": total,
            "attributed_pnl": float(record.attributed_pnl),
            "status": "adapted",
        }

    await db.flush()
    if any(c.get("status") == "adapted" for c in changes.values()):
        logger.info(f"[Adaptation] weights updated: {changes}")
    return changes


async def current_weights(db: AsyncSession) -> dict[str, float]:
    """
    The weights consensus should use right now.

    Falls back to the static table if the performance records are unavailable,
    so a database problem degrades the desk to its baseline behaviour rather
    than stopping it.
    """
    try:
        result = await db.execute(select(AgentPerformance))
        weights = {r.agent_name: r.current_weight for r in result.scalars().all()}
        if weights:
            return weights
    except Exception as e:
        logger.warning(f"[Adaptation] falling back to static weights: {e}")

    return {**AGENT_WEIGHTS, **MARKET_AGENT_WEIGHTS}


async def _get_or_create(db: AsyncSession, agent_name: str) -> AgentPerformance:
    result = await db.execute(
        select(AgentPerformance).where(AgentPerformance.agent_name == agent_name)
    )
    record = result.scalar_one_or_none()
    if record:
        return record

    base = MARKET_AGENT_WEIGHTS.get(agent_name, 0.10)
    record = AgentPerformance(
        agent_name=agent_name, base_weight=base, current_weight=base
    )
    db.add(record)
    await db.flush()
    return record


def _running_mean(current: float, count: int, value: float) -> float:
    if count <= 1:
        return value
    return current + (value - current) / count
