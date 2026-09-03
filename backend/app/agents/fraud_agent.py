from app.agents.base_agent import BaseAgent
from app.agents.rule_engine import evaluate_fraud
from app.llm.prompts import FRAUD_AGENT_PROMPT
from typing import Optional


class FraudAgent(BaseAgent):
    """Fraud Detection Expert Agent.

    Uses deterministic rules for known fraud patterns (darknet, geo-anomaly,
    velocity bursts), falls back to LLM for novel attack vectors.
    """

    def __init__(self):
        super().__init__(
            name="fraud",
            system_prompt=FRAUD_AGENT_PROMPT,
            weight=0.25,
        )

    def rule_evaluate(self, transaction: dict) -> Optional[dict]:
        """Deterministic fraud detection rules."""
        return evaluate_fraud(transaction)

    def build_user_prompt(self, transaction: dict) -> str:
        tx_info = self._format_transaction(transaction)
        metadata = transaction.get("metadata", {}) or transaction.get("metadata_json", {})

        prompt = f"""Analyze the following transaction for potential fraud:

{tx_info}

FRAUD DETECTION CONTEXT:
- Transactions in last 1 hour: {metadata.get('tx_last_hour', 'unknown')}
- Transactions in last 24 hours: {metadata.get('tx_last_24h', 'unknown')}
- Average transaction amount (90d): ${metadata.get('avg_amount_90d', 'unknown')}
- Previous decline count (30d): {metadata.get('declines_30d', 'unknown')}
- Card present: {metadata.get('card_present', 'unknown')}
- Channel: {metadata.get('channel', 'unknown')}
- Last known location: {metadata.get('last_known_location', 'unknown')}
- Current location: {metadata.get('current_location', 'unknown')}
- Device fingerprint match: {metadata.get('device_match', 'unknown')}

Provide your fraud analysis in the required JSON format."""
        return prompt
