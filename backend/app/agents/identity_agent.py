from app.agents.base_agent import BaseAgent
from app.agents.rule_engine import evaluate_identity
from app.llm.prompts import IDENTITY_AGENT_PROMPT
from typing import Optional


class IdentityAgent(BaseAgent):
    """Identity Verification Expert Agent.

    Uses deterministic rules for standard identity verification,
    falls back to LLM for ambiguous or novel identity patterns.
    """

    def __init__(self):
        super().__init__(
            name="identity",
            system_prompt=IDENTITY_AGENT_PROMPT,
            weight=0.15,
        )

    def rule_evaluate(self, transaction: dict) -> Optional[dict]:
        """Deterministic identity verification rules."""
        return evaluate_identity(transaction)

    def build_user_prompt(self, transaction: dict) -> str:
        tx_info = self._format_transaction(transaction)
        metadata = transaction.get("metadata", {}) or transaction.get("metadata_json", {})

        prompt = f"""Evaluate the identity verification for the following transaction:

{tx_info}

IDENTITY CONTEXT:
- Login Method: {metadata.get('login_method', 'standard password')}
- MFA Status: {metadata.get('mfa_verified', 'unknown')}
- Device: {metadata.get('device', 'unknown')}
- IP Location: {metadata.get('ip_location', 'unknown')}
- Account Age: {metadata.get('account_age', 'unknown')}
- Previous Transactions (30d): {metadata.get('recent_tx_count', 'unknown')}
- Last Login Location: {metadata.get('last_login_location', 'unknown')}

Provide your identity verification assessment in the required JSON format."""
        return prompt
