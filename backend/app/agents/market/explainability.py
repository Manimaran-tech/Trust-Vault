"""
Synthesis expert for market decisions.

Runs after the six domain experts and sees their verdicts. Produces the record
a risk officer would read: what the desk is about to do, the case for, the case
against, and which figures decided it.
"""
import logging
import time

from app.agents.market.base import MarketAgent
from app.config import get_settings
from app.llm.market_prompts import MARKET_EXPLAINABILITY_PROMPT

logger = logging.getLogger(__name__)
settings = get_settings()


class MarketExplainabilityAgent(MarketAgent):
    def __init__(self):
        super().__init__("explainability", MARKET_EXPLAINABILITY_PROMPT, weight=0.05)

    def build_user_prompt(self, proposal: dict, verdicts: list[dict] = None) -> str:
        verdicts = verdicts or []
        lines = [self.format_proposal(proposal), "", "VERDICTS"]
        for v in verdicts:
            flags = ",".join(v.get("risk_flags", [])) or "none"
            # Reasoning is truncated: the synthesis needs each expert's position
            # and its grounds, not its full prose, and prompt length is the
            # dominant latency cost.
            lines.append(
                f"{v['agent_name']}={v['decision'].upper()}@{v['confidence']:.0%} "
                f"flags={flags} :: {v['reasoning'][:180]}"
            )
        lines.append(
            "\nSynthesise these into an auditable account of the decision. Name any "
            "disagreement between experts explicitly and cite the specific figures "
            "that decided it."
        )
        return "\n".join(lines)

    async def evaluate(self, proposal: dict, verdicts: list[dict] = None) -> dict:
        """Takes the prior verdicts as well as the proposal."""
        verdicts = verdicts or []
        start = time.time()

        try:
            from app.llm.client import query_llm

            result = await query_llm(
                system_prompt=self.system_prompt,
                user_prompt=self.build_user_prompt(proposal, verdicts),
                temperature=0.4,
                max_tokens=settings.LLM_MAX_TOKENS + 200,
            )
            return {
                "agent_name": self.name,
                "decision": result["decision"],
                "confidence": float(result["confidence"]),
                "reasoning": result["reasoning"],
                "risk_flags": result.get("risk_flags", []),
                "processing_time_ms": round((time.time() - start) * 1000, 2),
                "raw_response": result.get("raw_response", ""),
                "evaluation_mode": "llm",
            }

        except Exception as e:
            logger.warning(f"[explainability] LLM synthesis unavailable: {e}")
            return self._deterministic_summary(proposal, verdicts, start, str(e))

    def _deterministic_summary(
        self, proposal: dict, verdicts: list[dict], start: float, error: str
    ) -> dict:
        """
        Fallback narrative assembled from the verdicts themselves.

        This is clearly labelled as assembled rather than reasoned, so the audit
        trail never implies model synthesis that did not happen.
        """
        approvals = [v for v in verdicts if v["decision"] == "approve"]
        denials = [v for v in verdicts if v["decision"] == "deny"]
        reviews = [v for v in verdicts if v["decision"] == "review"]

        if denials:
            decision, confidence = "deny", max(v["confidence"] for v in denials)
        elif approvals and not reviews:
            decision = "approve"
            confidence = sum(v["confidence"] for v in approvals) / len(approvals)
        else:
            decision, confidence = "review", 0.5

        strongest_for = max(approvals, key=lambda v: v["confidence"], default=None)
        strongest_against = max(denials, key=lambda v: v["confidence"], default=None)

        parts = [
            f"{proposal.get('action', 'open').upper()} {proposal.get('side', '')} "
            f"{proposal.get('symbol', '')} at ${proposal.get('proposed_notional', 0):,.0f}: "
            f"{len(approvals)} for, {len(denials)} against, {len(reviews)} undecided."
        ]
        if strongest_against:
            parts.append(
                f"Strongest objection ({strongest_against['agent_name']}, "
                f"{strongest_against['confidence']:.0%}): {strongest_against['reasoning']}"
            )
        if strongest_for:
            parts.append(
                f"Strongest support ({strongest_for['agent_name']}, "
                f"{strongest_for['confidence']:.0%}): {strongest_for['reasoning']}"
            )
        parts.append(
            f"[Summary assembled from expert verdicts; model synthesis unavailable: {error}]"
        )

        return {
            "agent_name": self.name,
            "decision": decision,
            "confidence": round(confidence, 3),
            "reasoning": " ".join(parts),
            "risk_flags": sorted({f for v in verdicts for f in v.get("risk_flags", [])}),
            "processing_time_ms": round((time.time() - start) * 1000, 2),
            "raw_response": "",
            "evaluation_mode": "assembled",
        }
