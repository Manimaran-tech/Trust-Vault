"""
Consensus Decision Engine — Mixture of Experts (MoE) core.

Implements weighted majority voting with confidence aggregation
across all expert agents to produce a final decision.
"""
import logging

logger = logging.getLogger(__name__)

# Baseline agent weights for consensus voting.
# The transaction-governance quorum and the market quorum share this engine;
# at runtime the adaptation layer supplies weights that have moved in response
# to realised outcomes, and these are the fallback.
AGENT_WEIGHTS = {
    # Transaction governance quorum
    "identity": 0.15,
    "fraud": 0.25,
    "risk": 0.20,
    "compliance": 0.20,
    "policy": 0.15,
    # Market decision quorum
    "signal": 0.20,
    "sentiment": 0.12,
    "volatility": 0.20,
    "exposure": 0.20,
    "liquidity": 0.16,
    "correlation": 0.12,
    # Shared
    "explainability": 0.05,
}

# Flags that force a denial when raised with high confidence. These are the
# conditions no amount of countervailing enthusiasm may outvote: a breached
# mandate, an exhausted risk budget, or data too old to act on.
CRITICAL_FLAG_KEYWORDS = (
    # Transaction governance
    "sanction", "ofac", "aml", "fraud", "darknet", "mixer", "blocked", "identity_theft",
    "stolen", "terrorist", "llm_failure",
    # Market
    "mandate_breach", "exposure_limit_breach", "position_limit_breach",
    "insufficient_cash", "drawdown_limit_breached", "desk_halted",
    "stale_observation",
)

# Decision thresholds
APPROVE_THRESHOLD = 0.60
DENY_THRESHOLD = 0.45
MIN_CONFIDENCE_FOR_APPROVE = 0.65
CRITICAL_DENY_CONFIDENCE = 0.85


def compute_consensus(verdicts: list[dict], weights: dict[str, float] | None = None) -> dict:
    """
    Compute consensus decision from individual agent verdicts.

    Uses weighted majority voting with confidence aggregation.
    Considers critical flags for automatic denial.

    Args:
        verdicts: List of agent verdict dicts with decision, confidence, risk_flags
        weights: Per-agent weights to use. Supplied by the adaptation layer so
            weighting reflects realised track record; falls back to AGENT_WEIGHTS.

    Returns:
        {
            "final_decision": "approve" | "deny" | "review",
            "aggregated_confidence": float,
            "voting_breakdown": dict,
            "dissenting_opinions": list,
            "consensus_details": dict,
        }
    """
    weights = weights or AGENT_WEIGHTS

    if not verdicts:
        return {
            "final_decision": "deny",
            "aggregated_confidence": 0.0,
            "voting_breakdown": {},
            "dissenting_opinions": [],
            "consensus_details": {"reason": "No agent verdicts received"},
        }

    # Calculate weighted scores for each decision type
    weighted_scores = {"approve": 0.0, "deny": 0.0, "review": 0.0}
    total_weight = 0.0
    weighted_confidence_sum = 0.0
    voting_breakdown = {}
    critical_flags = []
    dissenting_opinions = []

    for verdict in verdicts:
        agent_name = verdict["agent_name"]
        decision = verdict["decision"]
        confidence = verdict["confidence"]
        weight = weights.get(agent_name, AGENT_WEIGHTS.get(agent_name, 0.10))
        risk_flags = verdict.get("risk_flags", [])

        # Accumulate weighted scores
        weighted_scores[decision] += weight * confidence
        total_weight += weight
        weighted_confidence_sum += weight * confidence

        # Track voting breakdown
        voting_breakdown[agent_name] = {
            "decision": decision,
            "confidence": round(confidence, 3),
            "weight": weight,
            "weighted_score": round(weight * confidence, 3),
            "risk_flags": risk_flags,
            # How the verdict was reached and what it cost. Without these the
            # console can only show that an agent voted, not how it decided or
            # how long the decision took, which is most of what an operator
            # reviewing the quorum actually needs.
            "evaluation_mode": verdict.get("evaluation_mode"),
            "processing_time_ms": verdict.get("processing_time_ms"),
            "reasoning": (verdict.get("reasoning") or "")[:400],
        }

        # Check for critical flags
        for flag in risk_flags:
            if any(keyword in flag.lower() for keyword in CRITICAL_FLAG_KEYWORDS):
                critical_flags.append({"agent": agent_name, "flag": flag, "confidence": confidence})

    # Normalize weighted scores
    if total_weight > 0:
        for key in weighted_scores:
            weighted_scores[key] /= total_weight

    aggregated_confidence = weighted_confidence_sum / total_weight if total_weight > 0 else 0.0

    # Decision logic
    final_decision = _determine_decision(
        weighted_scores, aggregated_confidence, critical_flags, verdicts
    )

    # Find dissenting opinions (agents that disagree with the final decision)
    for verdict in verdicts:
        if verdict["decision"] != final_decision:
            dissenting_opinions.append({
                "agent": verdict["agent_name"],
                "voted": verdict["decision"],
                "confidence": verdict["confidence"],
                "reasoning": verdict["reasoning"][:200],
            })

    logger.info(
        f"Consensus: {final_decision} (confidence: {aggregated_confidence:.2f}), "
        f"scores: approve={weighted_scores['approve']:.2f}, "
        f"deny={weighted_scores['deny']:.2f}, "
        f"review={weighted_scores['review']:.2f}, "
        f"critical_flags: {len(critical_flags)}, "
        f"dissenters: {len(dissenting_opinions)}"
    )

    return {
        "final_decision": final_decision,
        "aggregated_confidence": round(aggregated_confidence, 3),
        "voting_breakdown": voting_breakdown,
        "dissenting_opinions": dissenting_opinions,
        "consensus_details": {
            "weighted_scores": {k: round(v, 3) for k, v in weighted_scores.items()},
            "critical_flags": critical_flags,
            "total_agents": len(verdicts),
            "approve_threshold": APPROVE_THRESHOLD,
            "deny_threshold": DENY_THRESHOLD,
            "weights_used": {k: round(v, 4) for k, v in weights.items()},
        },
    }


def _determine_decision(
    weighted_scores: dict,
    aggregated_confidence: float,
    critical_flags: list,
    verdicts: list[dict],
) -> str:
    """Determine the final decision based on weighted scores and critical flags."""

    # Rule 1: Critical flags → automatic deny
    if critical_flags:
        high_confidence_critical = any(f["confidence"] >= CRITICAL_DENY_CONFIDENCE for f in critical_flags)
        if high_confidence_critical:
            return "deny"

    # Rule 2: Any agent with very high confidence deny + critical flag → deny
    for verdict in verdicts:
        if (verdict["decision"] == "deny"
                and verdict["confidence"] >= CRITICAL_DENY_CONFIDENCE
                and verdict.get("risk_flags")):
            return "deny"

    # Rule 3: Strong deny consensus → deny
    if weighted_scores["deny"] >= DENY_THRESHOLD:
        return "deny"

    # Rule 4: Strong approve consensus with sufficient confidence → approve
    if (weighted_scores["approve"] >= APPROVE_THRESHOLD
            and aggregated_confidence >= MIN_CONFIDENCE_FOR_APPROVE):
        return "approve"

    # Rule 5: Everything else → review (human escalation)
    return "review"
