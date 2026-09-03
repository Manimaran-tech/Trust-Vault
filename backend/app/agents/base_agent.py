"""
Base agent class that all expert agents inherit from.
Handles LLM querying, response validation, timeout, and error handling.
Supports hybrid evaluation: deterministic rule-based fast path with LLM fallback.
"""
import asyncio
import time
import logging
from abc import ABC, abstractmethod
from typing import Optional
from app.llm.client import query_llm
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Per-agent hard timeout (slightly longer than LLM timeout to allow retries)
AGENT_TIMEOUT_SECONDS = (settings.LLM_TIMEOUT_SECONDS * settings.LLM_MAX_RETRIES) + 15


class BaseAgent(ABC):
    """Base class for all expert agents in the MoE architecture.

    Supports hybrid evaluation:
    1. rule_evaluate() — deterministic rules (~0.5ms). Override in subclasses.
    2. _do_evaluate() — LLM-based evaluation (30s+). Used as fallback.
    """

    def __init__(self, name: str, system_prompt: str, weight: float = 0.15):
        self.name = name
        self.system_prompt = system_prompt
        self.weight = weight

    @abstractmethod
    def build_user_prompt(self, transaction: dict) -> str:
        """Build the transaction-specific user prompt."""
        pass

    def rule_evaluate(self, transaction: dict) -> Optional[dict]:
        """
        Deterministic rule-based evaluation (fast path).

        Override in subclasses to provide domain-specific rules.
        Return a verdict dict for a definitive classification,
        or None to fall through to LLM-based evaluation.
        """
        return None  # Default: no rules, always use LLM

    async def evaluate(self, transaction: dict) -> dict:
        """
        Hybrid evaluation: try rules first, fall back to LLM.

        Pipeline:
        1. Run rule_evaluate() (~0.5ms) — if it returns a verdict, use it
        2. If rules return None, fall through to LLM evaluation (30s+)

        Returns: {
            "agent_name": str,
            "decision": "approve" | "deny" | "review",
            "confidence": float (0-1),
            "reasoning": str,
            "risk_flags": list[str],
            "processing_time_ms": float,
            "raw_response": str,
            "evaluation_mode": "rule" | "llm"
        }
        """
        start_time = time.time()

        # === FAST PATH: Rule-based evaluation ===
        try:
            rule_verdict = self.rule_evaluate(transaction)
            if rule_verdict is not None:
                processing_time = round((time.time() - start_time) * 1000, 2)
                rule_verdict["processing_time_ms"] = processing_time
                rule_verdict["evaluation_mode"] = "rule"
                logger.info(
                    f"[{self.name}] RULE verdict: {rule_verdict['decision']} "
                    f"({rule_verdict['confidence']:.0%}) in {processing_time:.1f}ms"
                )
                return rule_verdict
        except Exception as e:
            logger.warning(f"[{self.name}] Rule evaluation failed: {e}. Falling through to LLM.")

        # === SLOW PATH: LLM-based evaluation ===
        if not settings.TRANSACTION_LLM_ENABLED:
            # Rules were inconclusive and the model is not available to this
            # pipeline. Abstaining is the honest answer: the agent has no view,
            # and a low-confidence review pushes a marginal case to a human
            # rather than manufacturing a verdict to fill the gap.
            processing_time = round((time.time() - start_time) * 1000, 2)
            logger.info(
                f"[{self.name}] rules inconclusive; LLM disabled for the "
                f"transaction pipeline, abstaining"
            )
            return {
                "agent_name": self.name,
                "decision": "review",
                "confidence": 0.3,
                "reasoning": (
                    f"Deterministic rules did not settle this case and the "
                    f"transaction pipeline is configured for rules-only "
                    f"evaluation (TRANSACTION_LLM_ENABLED=false). No model "
                    f"judgement was applied."
                ),
                "risk_flags": ["rules_inconclusive"],
                "processing_time_ms": processing_time,
                "raw_response": "",
                "evaluation_mode": "rule_only",
            }

        logger.info(f"[{self.name}] Rules inconclusive — falling through to LLM evaluation")

        try:
            verdict = await asyncio.wait_for(
                self._do_evaluate(transaction),
                timeout=AGENT_TIMEOUT_SECONDS,
            )
            verdict["processing_time_ms"] = round((time.time() - start_time) * 1000, 2)
            verdict["evaluation_mode"] = "llm"
            return verdict

        except asyncio.TimeoutError:
            processing_time = (time.time() - start_time) * 1000
            logger.error(
                f"[{self.name}] Agent timed out after {AGENT_TIMEOUT_SECONDS}s"
            )
            return {
                "agent_name": self.name,
                "decision": "review",
                "confidence": 0.3,
                "reasoning": f"Agent {self.name} timed out after {AGENT_TIMEOUT_SECONDS}s. Defaulting to review for safety.",
                "risk_flags": ["agent_timeout"],
                "processing_time_ms": round(processing_time, 2),
                "raw_response": "TIMEOUT",
                "evaluation_mode": "llm",
            }

        except Exception as e:
            processing_time = (time.time() - start_time) * 1000
            logger.error(f"[{self.name}] Agent evaluation failed: {e}")
            return {
                "agent_name": self.name,
                "decision": "review",
                "confidence": 0.3,
                "reasoning": f"Agent {self.name} encountered an error: {str(e)}. Defaulting to review for safety.",
                "risk_flags": ["agent_error"],
                "processing_time_ms": round(processing_time, 2),
                "raw_response": str(e),
                "evaluation_mode": "llm",
            }

    async def _do_evaluate(self, transaction: dict) -> dict:
        """Internal evaluation logic — can be overridden by subclasses."""
        user_prompt = self.build_user_prompt(transaction)
        logger.info(f"[{self.name}] Evaluating transaction {transaction.get('id', 'unknown')[:8]}")

        result = await query_llm(self.system_prompt, user_prompt, context_data=transaction)

        # Validate and normalize
        decision = result.get("decision", "review").lower()
        if decision not in ("approve", "deny", "review"):
            decision = "review"

        confidence = float(result.get("confidence", 0.5))
        confidence = max(0.0, min(1.0, confidence))

        verdict = {
            "agent_name": self.name,
            "decision": decision,
            "confidence": confidence,
            "reasoning": result.get("reasoning", "No reasoning provided"),
            "risk_flags": result.get("risk_flags", []),
            "processing_time_ms": 0,  # Will be set by the outer evaluate()
            "raw_response": str(result),
        }

        logger.info(
            f"[{self.name}] Verdict: {decision} (confidence: {confidence:.2f})"
        )
        return verdict

    def _format_transaction(self, transaction: dict) -> str:
        """Format transaction data into a readable string for the LLM."""
        lines = [
            f"Transaction ID: {transaction.get('id', 'N/A')}",
            f"Type: {transaction.get('transaction_type', 'N/A')}",
            f"Amount: {float(transaction.get('amount', 0)):,.2f} "
            f"{transaction.get('currency') or settings.BASE_CURRENCY}",
            f"Merchant: {transaction.get('merchant_name', 'N/A')}",
            f"Merchant Category: {transaction.get('merchant_category', 'N/A')}",
            f"Merchant Country: {transaction.get('merchant_country', 'N/A')}",
            f"Card Member: {transaction.get('card_member_name', 'N/A')}",
            f"Description: {transaction.get('description', 'N/A')}",
            f"Timestamp: {transaction.get('created_at', 'N/A')}",
        ]
        metadata = transaction.get("metadata", {}) or transaction.get("metadata_json", {})
        if metadata:
            lines.append(f"Additional Context: {metadata}")
        return "\n".join(lines)
