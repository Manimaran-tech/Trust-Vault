from app.agents.base_agent import BaseAgent
from app.agents.rule_engine import evaluate_compliance
from app.llm.prompts import COMPLIANCE_AGENT_PROMPT
from typing import Optional


class ComplianceAgent(BaseAgent):
    """AML/Compliance Expert Agent.

    Uses deterministic rules for OFAC checks and CTR thresholds,
    falls back to LLM for complex AML pattern recognition.
    """

    def __init__(self):
        super().__init__(
            name="compliance",
            system_prompt=COMPLIANCE_AGENT_PROMPT,
            weight=0.20,
        )

    def rule_evaluate(self, transaction: dict) -> Optional[dict]:
        """Deterministic AML/compliance rules."""
        return evaluate_compliance(transaction)

    def build_user_prompt(self, transaction: dict) -> str:
        tx_info = self._format_transaction(transaction)
        metadata = transaction.get("metadata", {}) or transaction.get("metadata_json", {})

        cumulative_today = metadata.get('cumulative_today', 0)
        cumulative_month = metadata.get('cumulative_month', 0)
        cum_today_str = f"${cumulative_today:,.2f}" if isinstance(cumulative_today, (int, float)) else "unknown"
        cum_month_str = f"${cumulative_month:,.2f}" if isinstance(cumulative_month, (int, float)) else "unknown"

        prompt = f"""Evaluate the following transaction for AML/compliance requirements:

{tx_info}

COMPLIANCE CONTEXT:
- KYC Status: {metadata.get('kyc_status', 'verified')}
- KYC Last Updated: {metadata.get('kyc_last_updated', 'unknown')}
- PEP Status: {metadata.get('pep_status', 'not_pep')}
- Country Risk Rating: {metadata.get('country_risk', 'low')}
- Cumulative transactions today: {cum_today_str}
- Cumulative transactions this month: {cum_month_str}
- Previous SAR filings: {metadata.get('previous_sars', 0)}
- Sanctions screening result: {metadata.get('sanctions_match', 'no_match')}
- Beneficiary country: {metadata.get('beneficiary_country', 'N/A')}
- Source of funds: {metadata.get('source_of_funds', 'unknown')}

Provide your compliance assessment in the required JSON format."""
        return prompt
