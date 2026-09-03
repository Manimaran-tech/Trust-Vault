"""
Governance Layer — OPA-style policy enforcement.

Enforces organizational policies including spend limits,
merchant restrictions, time-based rules, and escalation triggers.
"""
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Policy configuration (in INR ₹)
SPEND_LIMITS = {
    "standard": {"per_transaction": 500000, "daily": 1500000, "monthly": 5000000},
    "premium": {"per_transaction": 2500000, "daily": 7500000, "monthly": 20000000},
    "corporate": {"per_transaction": 5000000, "daily": 15000000, "monthly": 50000000},
}

BLOCKED_MCCS = {
    "7995": "Gambling",
    "6051": "Cryptocurrency",
    "6012": "Money Services / Wire Transfer",
}

HIGH_RISK_MCCS = {
    "5967": "Direct Marketing",
    "5966": "Outbound Telemarketing",
    "7273": "Dating Services",
    "7841": "DVD/Video Tape Rental",
}

BLOCKED_COUNTRIES = [
    "North Korea", "Iran", "Syria", "Cuba", "Crimea",
    "NK", "IR", "SY", "CU",
]

# Auto-escalate at the FIU-IND cash reporting threshold of \u20b910 lakh.
ESCALATION_AMOUNT_THRESHOLD = 1_000_000


def run_governance_checks(
    transaction: dict,
    consensus_decision: str,
    daily_spend: float = 0,
    monthly_spend: float = 0,
) -> dict:
    """
    Run all governance checks against a transaction.

    Returns:
        {
            "passed": bool,
            "checks": list of check results,
            "requires_human_approval": bool,
            "escalation_reason": str or None,
            "overridden_decision": str or None,
        }
    """
    checks = []
    requires_human = False
    escalation_reasons = []
    overridden_decision = None

    amount = transaction.get("amount", 0)
    card_tier = (transaction.get("metadata", {}) or transaction.get("metadata_json", {}) or {}).get("card_tier", "standard")
    merchant_category = transaction.get("merchant_category", "")
    merchant_country = transaction.get("merchant_country", "")
    mcc = (transaction.get("metadata", {}) or transaction.get("metadata_json", {}) or {}).get("mcc", "")

    # Check 1: Per-transaction spend limit
    limits = SPEND_LIMITS.get(card_tier, SPEND_LIMITS["standard"])
    tx_limit_check = {
        "check": "per_transaction_limit",
        "limit": limits["per_transaction"],
        "actual": amount,
        "passed": amount <= limits["per_transaction"],
        "details": f"${amount:,.2f} vs ${limits['per_transaction']:,.2f} limit ({card_tier})",
    }
    checks.append(tx_limit_check)
    if not tx_limit_check["passed"]:
        requires_human = True
        escalation_reasons.append(f"Exceeded {card_tier} per-transaction limit (${limits['per_transaction']:,.2f})")

    # Check 2: Daily aggregate limit
    new_daily = daily_spend + amount
    daily_check = {
        "check": "daily_aggregate_limit",
        "limit": limits["daily"],
        "actual": new_daily,
        "passed": new_daily <= limits["daily"],
        "details": f"${new_daily:,.2f} vs ${limits['daily']:,.2f} daily limit",
    }
    checks.append(daily_check)
    if not daily_check["passed"]:
        requires_human = True
        escalation_reasons.append(f"Exceeded daily spend limit (${limits['daily']:,.2f})")

    # Check 3: Monthly aggregate limit
    new_monthly = monthly_spend + amount
    monthly_check = {
        "check": "monthly_aggregate_limit",
        "limit": limits["monthly"],
        "actual": new_monthly,
        "passed": new_monthly <= limits["monthly"],
        "details": f"${new_monthly:,.2f} vs ${limits['monthly']:,.2f} monthly limit",
    }
    checks.append(monthly_check)
    if not monthly_check["passed"]:
        requires_human = True
        escalation_reasons.append(f"Exceeded monthly aggregate limit")

    # Check 4: Blocked merchant categories
    mcc_blocked = mcc in BLOCKED_MCCS
    mcc_check = {
        "check": "merchant_category",
        "passed": not mcc_blocked,
        "details": f"MCC {mcc}: {'BLOCKED - ' + BLOCKED_MCCS.get(mcc, '') if mcc_blocked else 'Allowed'}",
    }
    checks.append(mcc_check)
    if mcc_blocked:
        requires_human = True
        escalation_reasons.append(f"Blocked MCC {mcc} ({BLOCKED_MCCS.get(mcc, 'Prohibited Merchant')})")

    # Check 5: High-risk MCC flag
    mcc_high_risk = mcc in HIGH_RISK_MCCS
    hr_check = {
        "check": "high_risk_merchant",
        "passed": not mcc_high_risk,
        "details": f"MCC {mcc}: {'HIGH RISK - ' + HIGH_RISK_MCCS.get(mcc, '') if mcc_high_risk else 'Normal risk'}",
    }
    checks.append(hr_check)
    if mcc_high_risk:
        requires_human = True
        escalation_reasons.append(f"High-risk merchant category: {HIGH_RISK_MCCS.get(mcc, mcc)}")

    # Check 6: Geographic restrictions
    country_blocked = any(bc.lower() in merchant_country.lower() for bc in BLOCKED_COUNTRIES) if merchant_country else False
    geo_check = {
        "check": "geographic_restriction",
        "passed": not country_blocked,
        "details": f"Country '{merchant_country}': {'BLOCKED' if country_blocked else 'Allowed'}",
    }
    checks.append(geo_check)
    if country_blocked:
        # Direct AI Auto-Reject on prohibited sanction jurisdiction
        overridden_decision = "deny"
        escalation_reasons.append(f"Restricted OFAC jurisdiction: {merchant_country}")

    # Check 7: High-value escalation
    high_value = amount >= ESCALATION_AMOUNT_THRESHOLD
    value_check = {
        "check": "high_value_escalation",
        "passed": not high_value,
        "details": f"₹{amount:,.2f} {'exceeds' if high_value else 'under'} the "
        f"₹{ESCALATION_AMOUNT_THRESHOLD:,.2f} escalation threshold",
    }
    checks.append(value_check)
    if high_value:
        requires_human = True
        escalation_reasons.append(f"High-value threshold exceeded: ₹{amount:,.2f}")

    # Check 8: Consensus review → escalation
    if consensus_decision == "review":
        requires_human = True
        escalation_reasons.append("MoE Consensus flagged transaction as AMBIGUOUS / REVIEW")
    elif consensus_decision == "deny" and not overridden_decision:
        overridden_decision = "deny"

    all_passed = all(c["passed"] for c in checks)

    # If the AI explicitly rejected the transaction (e.g. OFAC Sanctions / Malicious),
    # it is auto-denied directly without needing human approval.
    if overridden_decision == "deny":
        requires_human = False

    return {
        "passed": all_passed,
        "checks": checks,
        "requires_human_approval": requires_human,
        "escalation_reason": "; ".join(escalation_reasons) if escalation_reasons else None,
        "overridden_decision": "pending_human_review" if requires_human else overridden_decision,
    }
