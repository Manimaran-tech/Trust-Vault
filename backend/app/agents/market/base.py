"""
Base class for the market expert agents.

These agents vote on a *proposal* — a candidate action on one instrument —
rather than on an inbound transaction. The vote vocabulary is deliberately
kept as approve / deny / review so the existing weighted-consensus engine,
watchdog and audit chain apply unchanged:

  approve — take the proposed action
  deny    — do not take it
  review  — the case is genuinely ambiguous; escalate rather than guess

Each agent runs a deterministic quantitative pass first. That pass is not a
shortcut around the model: it computes the statistic the agent is responsible
for. The LLM is consulted when the statistic alone does not settle the
question, which is exactly where judgement is needed and where a fixed rule
would fail.
"""
import asyncio
import logging
import time
from abc import ABC, abstractmethod
from typing import Optional

from app.config import get_settings
from app.llm.client import query_llm

logger = logging.getLogger(__name__)
settings = get_settings()

AGENT_TIMEOUT_SECONDS = (settings.LLM_TIMEOUT_SECONDS * settings.LLM_MAX_RETRIES) + 15


class MarketAgent(ABC):
    """One domain expert in the market decision quorum."""

    def __init__(self, name: str, system_prompt: str, weight: float = 0.15):
        self.name = name
        self.system_prompt = system_prompt
        self.weight = weight

    # ---------------------------------------------------------------- #
    # Subclass contract
    # ---------------------------------------------------------------- #

    @abstractmethod
    def build_user_prompt(self, proposal: dict) -> str:
        """Render the proposal into this agent's domain question."""

    def quantitative_evaluate(self, proposal: dict) -> Optional[dict]:
        """
        Domain statistic pass.

        Return a verdict when the numbers are decisive, or None to hand the
        judgement call to the LLM.
        """
        return None

    # ---------------------------------------------------------------- #
    # Evaluation
    # ---------------------------------------------------------------- #

    async def evaluate(self, proposal: dict) -> dict:
        start = time.time()

        try:
            quant = self.quantitative_evaluate(proposal)
        except Exception as e:
            logger.warning(f"[{self.name}] quantitative pass failed: {e}")
            quant = None

        if quant is not None:
            quant.setdefault("agent_name", self.name)
            quant["processing_time_ms"] = round((time.time() - start) * 1000, 2)
            quant["evaluation_mode"] = "quantitative"
            quant.setdefault("raw_response", "")
            logger.info(
                f"[{self.name}] QUANT {quant['decision']} "
                f"({quant['confidence']:.0%}) in {quant['processing_time_ms']:.1f}ms"
            )
            return quant

        try:
            result = await asyncio.wait_for(
                query_llm(
                    system_prompt=self.system_prompt,
                    user_prompt=self.build_user_prompt(proposal),
                    temperature=0.3,
                    max_tokens=settings.LLM_MAX_TOKENS,
                ),
                timeout=AGENT_TIMEOUT_SECONDS,
            )
            elapsed = round((time.time() - start) * 1000, 2)
            logger.info(
                f"[{self.name}] LLM {result['decision']} "
                f"({result['confidence']:.0%}) in {elapsed:.0f}ms"
            )
            return {
                "agent_name": self.name,
                "decision": result["decision"],
                "confidence": float(result["confidence"]),
                "reasoning": result["reasoning"],
                "risk_flags": result.get("risk_flags", []),
                "processing_time_ms": elapsed,
                "raw_response": result.get("raw_response", ""),
                "evaluation_mode": "llm",
            }

        except asyncio.TimeoutError:
            return self._abstain(
                start,
                f"No verdict within {AGENT_TIMEOUT_SECONDS}s; abstaining rather than "
                f"guessing on a live position.",
                ["agent_timeout"],
            )
        except Exception as e:
            logger.error(f"[{self.name}] evaluation failed: {e}")
            return self._abstain(
                start, f"Evaluation failed: {e}", ["agent_failure"]
            )

    def _abstain(self, start: float, reasoning: str, flags: list[str]) -> dict:
        """
        A failed agent must never read as a confident approval.

        It votes review at low confidence, which the consensus engine treats as
        weak evidence and which pushes an otherwise marginal case to escalation.
        """
        return {
            "agent_name": self.name,
            "decision": "review",
            "confidence": 0.2,
            "reasoning": reasoning,
            "risk_flags": flags,
            "processing_time_ms": round((time.time() - start) * 1000, 2),
            "raw_response": "",
            "evaluation_mode": "abstain",
        }

    # ---------------------------------------------------------------- #
    # Shared prompt helpers
    # ---------------------------------------------------------------- #

    @staticmethod
    def format_proposal(proposal: dict) -> str:
        """
        Compact rendering of the proposal.

        Deliberately terse. Prompt evaluation is the dominant latency cost for a
        local model, and every token of formatting is time the agent spends
        reading rather than deciding. Every figure an expert needs is here; only
        the presentation is stripped.
        """
        obs = proposal.get("observation", {})
        pf = proposal.get("portfolio", {})
        existing = proposal.get("existing_position")

        lines = [
            f"ACTION: {proposal.get('action', 'open')} {proposal.get('side', '')} "
            f"{proposal.get('symbol', '')} notional ${proposal.get('proposed_notional', 0):,.0f}",
            f"MARKET px={obs.get('price', 0):,.4f} age={obs.get('age_seconds', 0):.1f}s"
            f"/{settings.MARKET_STALENESS_SECONDS:.0f}s spread={obs.get('spread_bps', 0):.1f}bps "
            f"depth=${obs.get('depth_quote', 0):,.0f} vol={obs.get('volatility', 0):.1%} "
            f"mom={obs.get('momentum_short', 0):+.3%}/{obs.get('momentum_long', 0):+.3%}",
            f"NEWS sentiment={obs.get('news_sentiment')} "
            f"headline={(obs.get('news_headline') or 'none')[:80]}",
            f"CAPITAL nav=${pf.get('nav', 0):,.0f} cash=${pf.get('cash', 0):,.0f} "
            f"exposure={pf.get('exposure_pct', 0):.1%} positions={pf.get('open_position_count', 0)} "
            f"drawdown={pf.get('drawdown_pct', 0):.2%}",
            f"LIMITS exposure<={pf.get('max_exposure_pct', 0):.0%} "
            f"position<={pf.get('max_position_pct', 0):.0%} "
            f"halt@{pf.get('max_drawdown_pct', 0):.0%} "
            f"min_edge={settings.MIN_EDGE_BPS:.0f}bps",
        ]

        if existing:
            lines.append(
                f"HOLDING {existing.get('side')} qty={existing.get('quantity')} "
                f"entry={existing.get('entry_price')} "
                f"unrealised={existing.get('unrealized_pnl_pct', 0):+.2%} "
                f"held={existing.get('age_seconds', 0):.0f}s "
                f"reviews={existing.get('reassessment_count', 0)}"
            )
            thesis = existing.get("thesis")
            if thesis:
                lines.append(f"ORIGINAL THESIS {thesis[:200]}")

        return "\n".join(lines)
