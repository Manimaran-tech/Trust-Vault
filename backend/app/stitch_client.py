"""
Stitch Real-Time Double-Entry Ledger Client.

Integrates with Stitch (https://api.stitch.co) for real-time transaction ledgering
and settlement. If credentials are unset or the external API is unreachable, seamlessly
falls back to local double-entry ledger bookkeeping.
"""

import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Optional
import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


class StitchClient:
    """Async client for Stitch Financial Infrastructure Ledger API."""

    def __init__(self):
        self.settings = get_settings()
        self._access_token: Optional[str] = None
        self._token_expires_at: float = 0.0
        self._lock = asyncio.Lock()

        # Local double-entry ledger fallback storage
        self._local_ledger: list[dict] = []

    async def _get_auth_token(self) -> Optional[str]:
        """Fetch or refresh OAuth2 client credentials token from Stitch."""
        if not (self.settings.STITCH_CLIENT_ID and self.settings.STITCH_CLIENT_SECRET):
            return None

        now = time.time()
        if self._access_token and now < (self._token_expires_at - 60):
            return self._access_token

        async with self._lock:
            # Double check inside lock
            if self._access_token and now < (self._token_expires_at - 60):
                return self._access_token

            auth_url = f"{self.settings.STITCH_BASE_URL.rstrip('/')}/oauth/token"
            payload = {
                "grant_type": "client_credentials",
                "client_id": self.settings.STITCH_CLIENT_ID,
                "client_secret": self.settings.STITCH_CLIENT_SECRET,
                "audience": self.settings.STITCH_BASE_URL,
            }

            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.post(auth_url, json=payload)
                    if resp.status_code == 200:
                        data = resp.json()
                        self._access_token = data.get("access_token")
                        expires_in = data.get("expires_in", 3600)
                        self._token_expires_at = now + expires_in
                        logger.info("[Stitch] Successfully authenticated with Stitch API.")
                        return self._access_token
                    else:
                        logger.warning(
                            f"[Stitch] Auth failed: HTTP {resp.status_code} - {resp.text[:150]}"
                        )
            except Exception as e:
                logger.warning(f"[Stitch] Auth connection error: {e}")

        return None

    async def record_transaction(
        self,
        transaction_dict: dict,
        decision_dict: Optional[dict] = None,
    ) -> dict:
        """
        Record an approved financial transaction onto the Stitch double-entry ledger.

        Debit: User/Cardholder Asset Account
        Credit: Merchant Settlement Liability Account
        """
        tx_id = transaction_dict.get("id", str(uuid.uuid4()))
        amount = float(transaction_dict.get("amount", 0.0))
        currency = transaction_dict.get("currency", "USD")
        merchant = transaction_dict.get("merchant_name", "Unknown Merchant")
        user_id = transaction_dict.get("user_id", "anonymous_user")
        created_at = datetime.now(timezone.utc).isoformat()

        token = await self._get_auth_token()
        ledger_id = self.settings.STITCH_LEDGER_ID or "default_settlement_ledger"

        if token:
            # 1. External Stitch GraphQL / REST Ledger Call
            graphql_url = f"{self.settings.STITCH_BASE_URL.rstrip('/')}/graphql"
            mutation = """
            mutation RecordLedgerTransaction($input: CreateTransactionInput!) {
                createTransaction(input: $input) {
                    id
                    status
                    postedAt
                    entries {
                        accountId
                        amount
                        direction
                    }
                }
            }
            """
            variables = {
                "input": {
                    "ledgerId": ledger_id,
                    "externalReference": tx_id,
                    "description": f"TrustVault Settlement: {merchant} (${amount:,.2f})",
                    "entries": [
                        {
                            "accountId": f"cardholder_{user_id}",
                            "amount": str(amount),
                            "direction": "DEBIT",
                            "currency": currency,
                        },
                        {
                            "accountId": f"merchant_{merchant.lower().replace(' ', '_')}",
                            "amount": str(amount),
                            "direction": "CREDIT",
                            "currency": currency,
                        },
                    ],
                }
            }

            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    headers = {
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                    }
                    resp = await client.post(
                        graphql_url,
                        json={"query": mutation, "variables": variables},
                        headers=headers,
                    )
                    if resp.status_code == 200:
                        res_data = resp.json()
                        if "errors" not in res_data:
                            stitch_tx_id = (
                                res_data.get("data", {})
                                .get("createTransaction", {})
                                .get("id", f"st_{uuid.uuid4().hex[:12]}")
                            )
                            logger.info(
                                f"[Stitch] Recorded tx {tx_id[:8]} on Stitch ledger ({stitch_tx_id})"
                            )
                            return {
                                "status": "settled",
                                "provider": "stitch_api",
                                "ledger_id": ledger_id,
                                "stitch_transaction_id": stitch_tx_id,
                                "timestamp": created_at,
                                "amount": amount,
                                "currency": currency,
                            }
                        else:
                            logger.warning(f"[Stitch] GraphQL errors: {res_data.get('errors')}")
                    else:
                        logger.warning(f"[Stitch] HTTP error {resp.status_code}: {resp.text[:150]}")
            except Exception as e:
                logger.error(f"[Stitch] Failed to call Stitch API: {e}")

        # 2. Local Double-Entry Ledger (Fallback / Development Mode)
        local_entry_id = f"loc_ledger_{uuid.uuid4().hex[:12]}"
        entry = {
            "id": local_entry_id,
            "transaction_id": tx_id,
            "ledger_id": ledger_id,
            "amount": amount,
            "currency": currency,
            "merchant": merchant,
            "user_id": user_id,
            "debit_account": f"cardholder_{user_id}",
            "credit_account": f"merchant_{merchant.lower().replace(' ', '_')}",
            "status": "settled",
            "provider": "local_double_entry",
            "recorded_at": created_at,
        }
        self._local_ledger.append(entry)
        logger.info(
            f"[Stitch] Recorded tx {tx_id[:8]} on local double-entry ledger: "
            f"DEBIT cardholder_{user_id[:8]} ${amount:,.2f} -> CREDIT merchant_{merchant[:12]} ({local_entry_id})"
        )

        return {
            "status": "settled",
            "provider": "local_double_entry",
            "ledger_id": ledger_id,
            "stitch_transaction_id": local_entry_id,
            "timestamp": created_at,
            "amount": amount,
            "currency": currency,
            "entries_count": len(self._local_ledger),
        }

    def get_ledger_history(self, limit: int = 50) -> list[dict]:
        """Return the most recent local ledger entries."""
        return list(reversed(self._local_ledger[-limit:]))


# Global singleton
stitch_client = StitchClient()
