import logging
import re
import ahocorasick

logger = logging.getLogger(__name__)

# Fast Number Extraction
MONEY_REGEX = re.compile(r'\$?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)')

# Initialize C-Engine Automaton for High-Risk Countries (O(1) categorical checks)
# Ahocorasick is a native C-extension, meaning we parse categories instantly without a loop.
high_risk_entities = [
    "north korea", "iran", "syria", "cuba", "crimea", 
    "russia", "venezuela", "myanmar", "belarus"
]

C_AUTOMATON = ahocorasick.Automaton()
for idx, entity in enumerate(high_risk_entities):
    C_AUTOMATON.add_word(entity, (idx, entity))
C_AUTOMATON.make_automaton()


class HallucinationPreventionLayer:
    """
    Ultra-fast deterministic layer to prevent LLM hallucinations.
    Uses 'ahocorasick' native C-engine for categorical searches.
    """

    @classmethod
    def check_factual_consistency(cls, verdict: dict, context: dict) -> list[str]:
        if not context:
            return []

        reasoning = verdict.get("reasoning", "")
        if not reasoning:
            return []

        errors = []

        # 1. Numerical Consistency (Fast Path Regex)
        tx_amount = context.get("amount")
        tx_amount_val = 0.0
        if tx_amount is not None:
            try:
                tx_amount_val = float(tx_amount)
            except (ValueError, TypeError):
                tx_amount_val = 0.0
                
        if tx_amount_val > 0:
            for match in MONEY_REGEX.finditer(reasoning):
                num_str = match.group(1)
                try:
                    clean_num = float(num_str.replace(',', ''))
                    if clean_num in {5000, 10000, 15000, 25000, 50000, 75000, 150000, 200000, 500000}:
                        continue
                    if clean_num < 1000:
                        continue
                    if abs(clean_num - tx_amount_val) > 1.0:
                        errors.append(f"Hallucinated numerical value: {match.group(0)}. Actual transaction amount is {tx_amount_val}.")
                        break
                except ValueError:
                    continue

        # 2. Categorical Consistency (Ahocorasick C-Engine)
        merchant_country = str(context.get("merchant_country", "")).lower()
        reasoning_lower = reasoning.lower()
        
        # Native C engine searches for ALL countries simultaneously in O(N) where N is length of reasoning
        for end_index, (insert_order, original_value) in C_AUTOMATON.iter(reasoning_lower):
            if original_value not in merchant_country:
                errors.append(f"Hallucinated high-risk entity: '{original_value}'. The transaction payload does not support this.")

        if errors:
            logger.warning(f"HPL detected hallucinations: {errors}")
            
        return list(set(errors)) # deduplicate just in case
