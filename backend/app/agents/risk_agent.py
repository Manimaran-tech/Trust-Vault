from app.agents.base_agent import BaseAgent
from app.agents.rule_engine import evaluate_risk
from app.llm.prompts import RISK_AGENT_PROMPT
from typing import Optional


class RiskAgent(BaseAgent):
    """Financial Risk Assessment Expert Agent.

    Uses deterministic rules for standard risk thresholds (credit limits,
    utilization), falls back to LLM for complex risk scenarios.
    """

    def __init__(self):
        super().__init__(
            name="risk",
            system_prompt=RISK_AGENT_PROMPT,
            weight=0.20,
        )

    def rule_evaluate(self, transaction: dict) -> Optional[dict]:
        """Deterministic financial risk rules."""
        return evaluate_risk(transaction)

    def build_user_prompt(self, transaction: dict) -> str:
        tx_info = self._format_transaction(transaction)
        metadata = transaction.get("metadata", {}) or transaction.get("metadata_json", {})

        prompt = f"""Assess the financial risk of the following transaction:

{tx_info}

FINANCIAL RISK CONTEXT:
- Credit Limit: ${metadata.get('credit_limit', '25000')}
- Current Balance: ${metadata.get('current_balance', 'unknown')}
- Available Credit: ${metadata.get('available_credit', 'unknown')}
- Credit Utilization: {metadata.get('credit_utilization', 'unknown')}%
- Payment History: {metadata.get('payment_history', 'unknown')}
- Account Standing: {metadata.get('account_standing', 'good')}
- Monthly Spending (avg): ${metadata.get('avg_monthly_spend', 'unknown')}
- Outstanding Disputes: {metadata.get('outstanding_disputes', 0)}
- Card Tier: {metadata.get('card_tier', 'standard')}

Provide your financial risk assessment in the required JSON format."""
        return prompt
