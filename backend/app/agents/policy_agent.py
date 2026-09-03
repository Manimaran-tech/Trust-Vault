from app.agents.base_agent import BaseAgent
from app.agents.rule_engine import evaluate_policy
from app.llm.prompts import POLICY_AGENT_PROMPT
from typing import Optional


class PolicyAgent(BaseAgent):
    """Policy Validation Expert Agent.

    Uses deterministic rules for spend caps and blocked merchants,
    falls back to LLM for complex policy interpretations.
    """

    def __init__(self):
        super().__init__(
            name="policy",
            system_prompt=POLICY_AGENT_PROMPT,
            weight=0.15,
        )

    def rule_evaluate(self, transaction: dict) -> Optional[dict]:
        """Deterministic policy validation rules."""
        return evaluate_policy(transaction)

    def build_user_prompt(self, transaction: dict) -> str:
        tx_info = self._format_transaction(transaction)
        metadata = transaction.get("metadata", {}) or transaction.get("metadata_json", {})

        prompt = f"""Validate the following transaction against organizational policies:

{tx_info}

POLICY CONTEXT:
- Card Tier: {metadata.get('card_tier', 'standard')}
- Account Type: {metadata.get('account_type', 'personal')}
- Daily Spend So Far: ${metadata.get('daily_spend', 0)}
- Monthly Spend So Far: ${metadata.get('monthly_spend', 0)}
- Transactions Today: {metadata.get('tx_today_count', 0)}
- Transaction Channel: {metadata.get('channel', 'online')}
- Transaction Time (UTC): {metadata.get('tx_time_utc', 'business_hours')}
- Merchant MCC: {metadata.get('mcc', 'unknown')}
- Is International: {metadata.get('is_international', False)}
- Corporate Card: {metadata.get('is_corporate', False)}

POLICY RULES TO CHECK:
1. Per-transaction limit (Standard: $5K, Premium: $25K, Corporate: $50K)
2. Daily aggregate limit (Standard: $15K, Premium: $75K, Corporate: $150K)
3. Blocked MCCs: 7995 (gambling), 6051 (crypto), 6012 (money services)
4. After-hours restrictions (if applicable)
5. Geographic restrictions (sanctioned countries)
6. Velocity limits (max 20 transactions/day for standard)

Provide your policy validation in the required JSON format."""
        return prompt
