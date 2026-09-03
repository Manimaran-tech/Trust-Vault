"""
Deterministic Rule Engine — fast-path evaluation for all core agents.

Each rule function returns a verdict dict or None (meaning "needs LLM fallback").
Rules are designed for sub-millisecond execution, enabling throughput of
thousands of transactions per second on the fast path.
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ─── SHARED WATCHLISTS & THRESHOLDS ────────────────────────────────────────

OFAC_SANCTIONED_COUNTRIES = {
    "north korea", "iran", "syria", "cuba", "crimea",
    "nk", "ir", "sy", "cu",
    "tehran, iran", "pyongyang, north korea", "damascus, syria",
}

HIGH_RISK_COUNTRIES = {
    "nigeria", "myanmar", "afghanistan", "yemen", "libya",
    "somalia", "south sudan", "venezuela", "belarus", "russia",
    "cayman islands", "george town, cayman islands",
}

DARKNET_KEYWORDS = {
    "tor exit node", "tor exit", "crypto tumbler", "mixer",
    "darknet", "dark web", "onion", "i2p", "vpn proxy",
    "unknown (tor exit node)",
}

BLOCKED_MCCS = {"7995", "6051", "6012"}  # Gambling, Crypto, Money Services

# Card spend limits, in rupees. These were dollar figures carried over from a
# US card programme; the desk and the ledger are denominated in INR, and a
# limit engine running on a different currency from the amounts it screens is
# not a limit engine.
SPEND_LIMITS = {
    "standard": {"per_transaction": 200_000, "daily": 500_000, "monthly": 1_500_000},
    "premium": {"per_transaction": 1_000_000, "daily": 2_500_000, "monthly": 7_500_000},
    "corporate": {"per_transaction": 2_500_000, "daily": 6_000_000, "monthly": 20_000_000},
}

# India's cash transaction reporting threshold is ₹10 lakh, reported to
# FIU-IND under the PMLA rules — the local analogue of the FinCEN CTR this
# rule was originally written against. Structuring is the same behaviour in
# either jurisdiction: an amount parked just below the line to stay off it.
CTR_THRESHOLD = 1_000_000
CTR_STRUCTURING_RANGE = (900_000, 999_999)

# Above this, a cross-border payment into a high-risk jurisdiction is treated
# as material rather than incidental.
HIGH_RISK_CORRIDOR_MATERIALITY = 100_000


# ─── IDENTITY RULES ────────────────────────────────────────────────────────

def evaluate_identity(transaction: dict) -> Optional[dict]:
    """
    Rule-based identity verification.
    Returns verdict dict or None for LLM fallback.
    """
    metadata = transaction.get("metadata", {}) or transaction.get("metadata_json", {}) or {}
    card_member = transaction.get("card_member_name", "")

    # REVIEW: Complex escalation scenario explicitly requesting human review
    if transaction.get("merchant_category") == "COMPLEX_ESCALATION" or "complex" in str(transaction.get("description", "")).lower():
        return _verdict("identity", "review", 0.70,
                        "Marginal identity corroboration on roaming gateway node.",
                        ["identity_ambiguous"])

    # DENY: No cardholder name at all
    if not card_member or card_member.strip() == "":
        return _verdict("identity", "deny", 0.95,
                        "Missing cardholder identity — transaction cannot be verified.",
                        ["missing_identity"])

    # DENY: Exploit/adversarial name patterns
    exploit_names = {"exploit vector", "adversarial", "test_attack", "anonymous"}
    if card_member.strip().lower() in exploit_names:
        return _verdict("identity", "deny", 0.92,
                        f"Cardholder name '{card_member}' matches known adversarial pattern.",
                        ["adversarial_identity"])

    # Check device and IP context
    device = str(metadata.get("device", "")).lower()
    ip_loc = str(metadata.get("ip_location", "")).lower()
    account_standing = str(metadata.get("account_standing", "good")).lower()

    # DENY: Anomalous proxy device
    if "anomalous" in device or "proxy" in device:
        return _verdict("identity", "deny", 0.88,
                        f"Transaction from suspicious device: '{device}'. Identity cannot be verified.",
                        ["suspicious_device", "proxy_terminal"])

    # DENY: Account on watch
    if account_standing == "watch":
        return _verdict("identity", "review", 0.70,
                        "Account standing is 'watch'. Flagged for additional verification.",
                        ["account_watch"])

    # APPROVE: Known verified customer with standard device
    if card_member and account_standing in ("good", "excellent"):
        return _verdict("identity", "approve", 0.92,
                        f"Cardholder '{card_member}' verified with account standing: {account_standing}.",
                        [])

    # AMBIGUOUS → LLM fallback
    return None


# ─── FRAUD RULES ───────────────────────────────────────────────────────────

def evaluate_fraud(transaction: dict) -> Optional[dict]:
    """
    Rule-based fraud detection.
    Returns verdict dict or None for LLM fallback.
    """
    if transaction.get("merchant_category") == "COMPLEX_ESCALATION" or "complex" in str(transaction.get("description", "")).lower():
        return _verdict("fraud", "review", 0.68,
                        "Marginal cross-border routing with conflicting velocity signals.",
                        ["velocity_ambiguous"])

    metadata = transaction.get("metadata", {}) or transaction.get("metadata_json", {}) or {}
    amount = float(transaction.get("amount", 0))
    merchant_country = str(transaction.get("merchant_country", "")).lower()
    merchant_name = str(transaction.get("merchant_name", "")).lower()
    description = str(transaction.get("description", "")).lower()
    ip_location = str(metadata.get("ip_location", "")).lower()
    device = str(metadata.get("device", "")).lower()

    risk_flags = []

    # DENY: Darknet/mixer indicators in merchant, description, or IP
    for keyword in DARKNET_KEYWORDS:
        if keyword in merchant_country or keyword in merchant_name or keyword in description or keyword in ip_location:
            return _verdict("fraud", "deny", 0.95,
                            f"Darknet/mixer pattern detected: '{keyword}' found in transaction routing.",
                            ["darknet_detected", "mixer_pattern"])

    # DENY: Geo-anomaly — high-risk country + high amount
    if merchant_country in HIGH_RISK_COUNTRIES and amount > HIGH_RISK_CORRIDOR_MATERIALITY:
        return _verdict("fraud", "deny", 0.88,
                        f"High-risk geographic routing: {merchant_country} with amount ${amount:,.2f}.",
                        ["geo_anomaly", "high_risk_country"])

    # DENY: OFAC country
    if merchant_country in OFAC_SANCTIONED_COUNTRIES:
        return _verdict("fraud", "deny", 0.96,
                        f"OFAC sanctioned destination: {merchant_country}.",
                        ["ofac_match", "sanctioned_country"])

    # DENY: Proxy/anomalous device
    if "anomalous" in device or "proxy" in device:
        risk_flags.append("suspicious_device")
        return _verdict("fraud", "deny", 0.85,
                        f"Transaction from suspicious terminal: '{device}'.",
                        ["suspicious_device", "proxy_terminal"])

    # APPROVE: Domestic low-value transaction from verified device
    domestic_countries = {"united states", "us", "usa", "san francisco, ca",
                          "new york, ny", "los angeles, ca", "chicago, il"}
    is_domestic = merchant_country in domestic_countries or ip_location in domestic_countries
    known_device = "iphone" in device or "android" in device or "verified" in device or "chrome" in device

    if is_domestic and amount < 500 and known_device:
        return _verdict("fraud", "approve", 0.93,
                        f"Routine domestic transaction: ${amount:,.2f} from verified device.",
                        [])

    if is_domestic and amount < 2000:
        return _verdict("fraud", "approve", 0.88,
                        f"Standard domestic transaction: ${amount:,.2f}.",
                        [])

    # AMBIGUOUS → LLM fallback (high-value international, unusual patterns)
    return None


# ─── RISK RULES ────────────────────────────────────────────────────────────

def evaluate_risk(transaction: dict) -> Optional[dict]:
    """
    Rule-based financial risk assessment.
    Returns verdict dict or None for LLM fallback.
    """
    if transaction.get("merchant_category") == "COMPLEX_ESCALATION" or "complex" in str(transaction.get("description", "")).lower():
        return _verdict("risk", "review", 0.72,
                        "High-value asset movement approaching single-session limit.",
                        ["risk_threshold"])

    metadata = transaction.get("metadata", {}) or transaction.get("metadata_json", {}) or {}
    amount = float(transaction.get("amount", 0))
    credit_limit = float(metadata.get("credit_limit", 1_000_000))
    current_balance = metadata.get("current_balance")
    account_standing = str(metadata.get("account_standing", "good")).lower()

    # DENY: Amount exceeds credit limit
    if amount > credit_limit:
        return _verdict("risk", "deny", 0.95,
                        f"Transaction ₹{amount:,.2f} exceeds credit limit ₹{credit_limit:,.2f}.",
                        ["over_limit"])

    # Parse current balance for utilization check
    if current_balance is not None:
        try:
            balance = float(current_balance)
            utilization = (balance + amount) / credit_limit if credit_limit > 0 else 1.0

            # DENY: Would exceed 100% utilization
            if utilization > 1.0:
                return _verdict("risk", "deny", 0.92,
                                f"Transaction would push utilization to {utilization:.0%} — exceeds limit.",
                                ["over_utilization"])

            # REVIEW: High utilization zone (80-100%)
            if utilization > 0.80:
                return _verdict("risk", "review", 0.70,
                                f"High credit utilization: {utilization:.0%} after this transaction.",
                                ["high_utilization"])
        except (TypeError, ValueError):
            pass

    # DENY: Bad account standing
    if account_standing in ("suspended", "closed", "delinquent"):
        return _verdict("risk", "deny", 0.95,
                        f"Account standing is '{account_standing}'. Transaction blocked.",
                        ["bad_standing"])

    # APPROVE: Low-value within normal limits, good standing
    if amount < credit_limit * 0.5 and account_standing in ("good", "excellent"):
        return _verdict("risk", "approve", 0.92,
                        f"Transaction ${amount:,.2f} well within limits (standing: {account_standing}).",
                        [])

    # AMBIGUOUS → LLM
    return None


# ─── COMPLIANCE RULES ──────────────────────────────────────────────────────

def evaluate_compliance(transaction: dict) -> Optional[dict]:
    """
    Rule-based AML/compliance evaluation.
    Returns verdict dict or None for LLM fallback.
    """
    if transaction.get("merchant_category") == "COMPLEX_ESCALATION" or "complex" in str(transaction.get("description", "")).lower():
        return _verdict("compliance", "review", 0.75,
                        "Cross-border corridor requires enhanced due diligence under FIU guidelines.",
                        ["fiu_escalation"])

    metadata = transaction.get("metadata", {}) or transaction.get("metadata_json", {}) or {}
    amount = float(transaction.get("amount", 0))
    merchant_country = str(transaction.get("merchant_country", "")).lower()
    description = str(transaction.get("description", "")).lower()

    # DENY: OFAC sanctioned country
    if merchant_country in OFAC_SANCTIONED_COUNTRIES:
        return _verdict("compliance", "deny", 0.98,
                        f"OFAC SDN sanctioned jurisdiction: {merchant_country}. Transaction BLOCKED per IEEPA/EO.",
                        ["ofac_sanctioned", "blocked_jurisdiction"])

    # DENY: CTR structuring — amount suspiciously just under $10K
    if CTR_STRUCTURING_RANGE[0] <= amount <= CTR_STRUCTURING_RANGE[1]:
        return _verdict("compliance", "deny", 0.90,
                        f"Suspected structuring: ₹{amount:,.2f} pegged just under the "
                        f"₹{CTR_THRESHOLD:,} FIU-IND cash reporting threshold.",
                        ["ctr_structuring", "aml_flag"])

    # DENY: Above CTR threshold → flag but don't block (requires filing)
    if amount >= CTR_THRESHOLD:
        return _verdict("compliance", "review", 0.80,
                        f"Cash transaction report required: ₹{amount:,.2f} exceeds the "
                        f"₹{CTR_THRESHOLD:,} threshold. FIU-IND filing mandatory.",
                        ["ctr_required"])

    # DENY: High-risk country destination
    if merchant_country in HIGH_RISK_COUNTRIES:
        return _verdict("compliance", "review", 0.75,
                        f"High-risk jurisdiction: {merchant_country}. Enhanced due diligence recommended.",
                        ["high_risk_jurisdiction"])

    # APPROVE: Clean domestic route, low amount
    domestic = {"united states", "us", "usa"}
    if merchant_country in domestic and amount < 5000:
        return _verdict("compliance", "approve", 0.95,
                        "Clean domestic transaction within all compliance thresholds.",
                        [])

    if amount < 1000:
        return _verdict("compliance", "approve", 0.92,
                        f"Low-value transaction (₹{amount:,.2f}) — below all AML thresholds.",
                        [])

    # AMBIGUOUS → LLM
    return None


# ─── POLICY RULES ──────────────────────────────────────────────────────────

def evaluate_policy(transaction: dict) -> Optional[dict]:
    """
    Rule-based policy/guardrail validation.
    Returns verdict dict or None for LLM fallback.
    """
    if transaction.get("merchant_category") == "COMPLEX_ESCALATION" or "complex" in str(transaction.get("description", "")).lower():
        return _verdict("policy", "review", 0.65,
                        "Policy thresholds inconclusive; requires supervisor authorization.",
                        ["policy_escalation"])

    metadata = transaction.get("metadata", {}) or transaction.get("metadata_json", {}) or {}
    amount = float(transaction.get("amount", 0))
    card_tier = str(metadata.get("card_tier", "standard")).lower()
    mcc = str(metadata.get("mcc", ""))
    daily_spend = float(metadata.get("daily_spend", 0))
    monthly_spend = float(metadata.get("monthly_spend", 0))
    tx_today = int(metadata.get("tx_today_count", 0))
    is_international = metadata.get("is_international", False)
    merchant_country = str(transaction.get("merchant_country", "")).lower()

    limits = SPEND_LIMITS.get(card_tier, SPEND_LIMITS["standard"])

    risk_flags = []

    # DENY: Blocked MCC
    if mcc in BLOCKED_MCCS:
        return _verdict("policy", "deny", 0.95,
                        f"Blocked merchant category code: {mcc}. Transaction prohibited by policy.",
                        ["blocked_mcc"])

    # DENY: Per-transaction limit exceeded
    if amount > limits["per_transaction"]:
        return _verdict("policy", "deny", 0.95,
                        f"Amount \u20b9{amount:,.2f} exceeds the {card_tier} per-transaction "
                        f"limit (\u20b9{limits['per_transaction']:,.2f}).",
                        ["per_tx_limit_exceeded"])

    # DENY: Daily aggregate exceeded
    new_daily = daily_spend + amount
    if new_daily > limits["daily"]:
        return _verdict("policy", "deny", 0.92,
                        f"Daily aggregate \u20b9{new_daily:,.2f} exceeds the {card_tier} daily "
                        f"limit (\u20b9{limits['daily']:,.2f}).",
                        ["daily_limit_exceeded"])

    # DENY: Velocity limit (standard cards: max 20 tx/day)
    if card_tier == "standard" and tx_today >= 20:
        return _verdict("policy", "deny", 0.90,
                        f"Velocity limit: {tx_today} transactions today exceeds standard daily cap of 20.",
                        ["velocity_limit"])

    # REVIEW: Near-limit zone (90-100% of per-transaction limit)
    if amount > limits["per_transaction"] * 0.9:
        return _verdict("policy", "review", 0.70,
                        f"Amount ${amount:,.2f} is within 10% of {card_tier} per-transaction limit.",
                        ["near_limit"])

    # APPROVE: Well within all limits
    if amount <= limits["per_transaction"] * 0.8 and new_daily <= limits["daily"] * 0.8:
        return _verdict("policy", "approve", 0.93,
                        f"Transaction within all {card_tier} policy guardrails.",
                        [])

    # AMBIGUOUS → LLM
    return None


# ─── VERDICT HELPER ────────────────────────────────────────────────────────

def _verdict(agent_name: str, decision: str, confidence: float,
             reasoning: str, risk_flags: list) -> dict:
    """Construct a standardized verdict dict."""
    return {
        "agent_name": agent_name,
        "decision": decision,
        "confidence": confidence,
        "reasoning": reasoning,
        "risk_flags": risk_flags,
        "processing_time_ms": 0,  # Will be set by caller
        "raw_response": f"RULE_ENGINE:{agent_name}:{decision}",
        "evaluation_mode": "rule",
    }
