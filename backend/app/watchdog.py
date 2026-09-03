"""
AI Watchdog Agent — monitors agent behavior and detects anomalies.

Tracks per-agent confidence trends, detects drift, repeated disagreements,
and unusual decision patterns.
"""
import logging
from collections import defaultdict, deque
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# In-memory tracking (production: Redis + PostgreSQL)
_agent_confidence_history = defaultdict(lambda: deque(maxlen=100))
_agent_decision_history = defaultdict(lambda: deque(maxlen=100))
_consensus_history = deque(maxlen=200)

# Thresholds
CONFIDENCE_DRIFT_THRESHOLD = 0.15  # Alert if avg confidence drops by more than 15%
DISAGREEMENT_RATE_THRESHOLD = 0.40  # Alert if agent disagrees with consensus >40% of time
MIN_SAMPLES_FOR_ANALYSIS = 5


def analyze_verdicts(verdicts: list[dict], consensus_decision: str) -> list[dict]:
    """
    Analyze a set of verdicts for anomalies and behavioral drift.

    Returns a list of watchdog alerts (may be empty).
    """
    alerts = []

    # Record this evaluation
    for verdict in verdicts:
        agent = verdict["agent_name"]
        _agent_confidence_history[agent].append(verdict["confidence"])
        _agent_decision_history[agent].append({
            "decision": verdict["decision"],
            "consensus": consensus_decision,
            "agreed": verdict["decision"] == consensus_decision,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

    _consensus_history.append({
        "decision": consensus_decision,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    # Check 1: Confidence drift per agent
    for verdict in verdicts:
        agent = verdict["agent_name"]
        history = list(_agent_confidence_history[agent])
        if len(history) >= MIN_SAMPLES_FOR_ANALYSIS:
            recent_avg = sum(history[-5:]) / min(5, len(history[-5:]))
            overall_avg = sum(history) / len(history)

            if overall_avg - recent_avg > CONFIDENCE_DRIFT_THRESHOLD:
                alerts.append({
                    "alert_type": "confidence_drift",
                    "severity": "medium",
                    "agent_name": agent,
                    "description": (
                        f"{agent} agent confidence dropping: "
                        f"recent avg {recent_avg:.2f} vs overall avg {overall_avg:.2f}"
                    ),
                    "details": {
                        "recent_avg": round(recent_avg, 3),
                        "overall_avg": round(overall_avg, 3),
                        "drift": round(overall_avg - recent_avg, 3),
                        "sample_count": len(history),
                    },
                    "anomaly_score": round((overall_avg - recent_avg) / overall_avg, 3) if overall_avg > 0 else 0,
                })

    # Check 2: Repeated disagreement with consensus
    for verdict in verdicts:
        agent = verdict["agent_name"]
        decision_history = list(_agent_decision_history[agent])
        if len(decision_history) >= MIN_SAMPLES_FOR_ANALYSIS:
            recent = decision_history[-10:]
            disagreement_rate = sum(1 for d in recent if not d["agreed"]) / len(recent)

            if disagreement_rate > DISAGREEMENT_RATE_THRESHOLD:
                alerts.append({
                    "alert_type": "repeated_disagreement",
                    "severity": "high",
                    "agent_name": agent,
                    "description": (
                        f"{agent} agent frequently disagrees with consensus: "
                        f"{disagreement_rate:.0%} disagreement rate"
                    ),
                    "details": {
                        "disagreement_rate": round(disagreement_rate, 3),
                        "recent_window": len(recent),
                        "threshold": DISAGREEMENT_RATE_THRESHOLD,
                    },
                    "anomaly_score": round(disagreement_rate, 3),
                })

    # Check 3: Unusual low confidence
    for verdict in verdicts:
        if verdict["confidence"] < 0.3:
            alerts.append({
                "alert_type": "low_confidence",
                "severity": "low",
                "agent_name": verdict["agent_name"],
                "description": (
                    f"{verdict['agent_name']} agent returned very low confidence: "
                    f"{verdict['confidence']:.2f}"
                ),
                "details": {
                    "confidence": verdict["confidence"],
                    "decision": verdict["decision"],
                },
                "anomaly_score": round(1.0 - verdict["confidence"], 3),
            })

    # Check 4: All agents disagree (total split)
    decisions = set(v["decision"] for v in verdicts if v["agent_name"] != "explainability")
    if len(decisions) >= 3:
        alerts.append({
            "alert_type": "total_split",
            "severity": "high",
            "agent_name": None,
            "description": "All decision types present among agents — complete disagreement",
            "details": {
                "decisions": {v["agent_name"]: v["decision"] for v in verdicts},
            },
            "anomaly_score": 0.8,
        })

    if alerts:
        logger.warning(f"Watchdog generated {len(alerts)} alerts")

    return alerts


# Both quorums share this watchdog. The market experts are listed first because
# they are what the autonomous loop actually runs; the governance experts only
# report figures once transactions are submitted through the simulator.
MARKET_QUORUM = [
    "signal", "sentiment", "volatility", "exposure", "liquidity", "correlation",
]
GOVERNANCE_QUORUM = [
    "identity", "fraud", "risk", "compliance", "policy", "graph_risk",
]


def get_agent_health() -> list[dict]:
    """
    Health metrics for every monitored agent.

    An agent that has not been evaluated yet reports zero evaluations rather
    than being omitted, so the absence of activity is visible instead of
    looking like an agent that does not exist.
    """
    agents = MARKET_QUORUM + GOVERNANCE_QUORUM + ["explainability"]
    health = []

    for agent in agents:
        confidence_history = list(_agent_confidence_history[agent])
        decision_history = list(_agent_decision_history[agent])

        avg_confidence = sum(confidence_history) / len(confidence_history) if confidence_history else 0.0
        total_evaluations = len(confidence_history)

        # Calculate disagreement rate
        disagreement_rate = 0.0
        if decision_history:
            disagreement_rate = sum(1 for d in decision_history if not d["agreed"]) / len(decision_history)

        # Determine status
        status = "active" if total_evaluations else "idle"
        if avg_confidence < 0.4 and total_evaluations > MIN_SAMPLES_FOR_ANALYSIS:
            status = "degraded"
        if disagreement_rate > 0.6 and total_evaluations > MIN_SAMPLES_FOR_ANALYSIS:
            status = "degraded"

        health.append({
            "agent_name": agent,
            "quorum": (
                "market" if agent in MARKET_QUORUM
                else "governance" if agent in GOVERNANCE_QUORUM
                else "shared"
            ),
            "status": status,
            "avg_confidence": round(avg_confidence, 3),
            "total_evaluations": total_evaluations,
            "disagreement_rate": round(disagreement_rate, 3),
            "recent_alerts": 0,  # Would query DB in production
        })

    return health
