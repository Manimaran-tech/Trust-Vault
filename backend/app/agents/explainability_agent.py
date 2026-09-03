from app.agents.base_agent import BaseAgent
from app.llm.prompts import EXPLAINABILITY_AGENT_PROMPT


class ExplainabilityAgent(BaseAgent):
    """Explainability Expert Agent — synthesizes all agent assessments into a human-readable summary."""

    def __init__(self):
        super().__init__(
            name="explainability",
            system_prompt=EXPLAINABILITY_AGENT_PROMPT,
            weight=0.05,
        )

    def build_user_prompt(self, transaction: dict, agent_verdicts: list[dict] = None) -> str:
        tx_info = self._format_transaction(transaction)

        verdicts_text = ""
        if agent_verdicts:
            for v in agent_verdicts:
                verdicts_text += f"""
--- {v['agent_name'].upper()} AGENT ---
Decision: {v['decision']}
Confidence: {v['confidence']:.0%}
Reasoning: {v['reasoning']}
Risk Flags: {', '.join(v.get('risk_flags', [])) or 'None'}
"""

        prompt = f"""Synthesize the following expert agent assessments into a comprehensive, human-readable explanation:

TRANSACTION DETAILS:
{tx_info}

EXPERT AGENT ASSESSMENTS:
{verdicts_text if verdicts_text else 'No prior agent assessments available.'}

Based on the above assessments, provide your overall explainability summary in the required JSON format.
Your reasoning should be a comprehensive 2-4 paragraph explanation suitable for a compliance officer or CSR."""
        return prompt

    async def evaluate(self, transaction: dict, agent_verdicts: list[dict] = None) -> dict:
        """Override to accept agent_verdicts for synthesis."""
        import time
        from app.config import get_settings
        from app.llm.client import query_llm

        settings = get_settings()
        start_time = time.time()

        if not settings.TRANSACTION_LLM_ENABLED:
            return self._assemble_summary(agent_verdicts or [], start_time)

        user_prompt = self.build_user_prompt(transaction, agent_verdicts)
        result = await query_llm(self.system_prompt, user_prompt)
        processing_time = (time.time() - start_time) * 1000

        decision = result.get("decision", "review").lower()
        if decision not in ("approve", "deny", "review"):
            decision = "review"

        confidence = float(result.get("confidence", 0.5))
        confidence = max(0.0, min(1.0, confidence))

        return {
            "agent_name": self.name,
            "decision": decision,
            "confidence": confidence,
            "reasoning": result.get("reasoning", "No reasoning provided"),
            "risk_flags": result.get("risk_flags", []),
            "processing_time_ms": round(processing_time, 2),
            "raw_response": str(result),
        }

    def _assemble_summary(self, verdicts: list[dict], start_time: float) -> dict:
        """
        Build the explanation from the verdicts themselves, without a model.

        Used when the transaction pipeline runs rules-only. The summary is
        labelled as assembled so the audit trail never implies reasoning that
        did not happen.
        """
        import time

        approvals = [v for v in verdicts if v["decision"] == "approve"]
        denials = [v for v in verdicts if v["decision"] == "deny"]
        reviews = [v for v in verdicts if v["decision"] == "review"]

        if denials:
            decision = "deny"
            confidence = max(v["confidence"] for v in denials)
        elif approvals and not reviews:
            decision = "approve"
            confidence = sum(v["confidence"] for v in approvals) / len(approvals)
        else:
            decision, confidence = "review", 0.5

        flags = sorted({f for v in verdicts for f in v.get("risk_flags", [])})

        parts = [
            f"{len(approvals)} approve, {len(denials)} deny, {len(reviews)} review "
            f"across {len(verdicts)} experts."
        ]
        for v in sorted(denials, key=lambda x: -x["confidence"])[:3]:
            parts.append(f"{v['agent_name']} denied ({v['confidence']:.0%}): {v['reasoning']}")
        if not denials and approvals:
            top = max(approvals, key=lambda x: x["confidence"])
            parts.append(f"{top['agent_name']} approved ({top['confidence']:.0%}): {top['reasoning']}")
        if flags:
            parts.append(f"Flags raised: {', '.join(flags)}.")
        parts.append(
            "[Assembled from deterministic rule verdicts; the transaction "
            "pipeline runs rules-only for latency.]"
        )

        return {
            "agent_name": self.name,
            "decision": decision,
            "confidence": round(confidence, 3),
            "reasoning": " ".join(parts),
            "risk_flags": flags,
            "processing_time_ms": round((time.time() - start_time) * 1000, 2),
            "raw_response": "",
            "evaluation_mode": "rule_only",
        }
