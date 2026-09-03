"""
Cryptography utilities for data at rest and in transit.
Provides AES-128-CBC encryption (via Fernet) for PII fields,
and HMAC-SHA256 for transaction payload integrity verification.
"""
import hmac
import hashlib
import json
import logging
from cryptography.fernet import Fernet
from typing import Optional

logger = logging.getLogger(__name__)


class FieldEncryptor:
    """Handles symmetric encryption of sensitive fields at rest."""
    def __init__(self, key: str):
        self._fernet = None
        if key:
            try:
                self._fernet = Fernet(key.encode())
            except Exception as e:
                logger.error(f"Failed to initialize Fernet with provided key: {e}")

    def encrypt(self, plaintext: str) -> str:
        """Encrypt a string. Returns base64-encoded ciphertext."""
        if not plaintext:
            return plaintext
        if not self._fernet:
            return plaintext # Fallback if no key (dev mode)
        try:
            return self._fernet.encrypt(str(plaintext).encode()).decode()
        except Exception as e:
            logger.error(f"Encryption failed: {e}")
            return plaintext

    def decrypt(self, ciphertext: str) -> str:
        """Decrypt a base64-encoded ciphertext."""
        if not ciphertext:
            return ciphertext
        if not self._fernet:
            return ciphertext # Fallback
        try:
            return self._fernet.decrypt(ciphertext.encode()).decode()
        except Exception as e:
            # Check if it was ever encrypted. If it throws, it might be plain text.
            return ciphertext


def sign_transaction(payload: dict, secret: str) -> str:
    """
    Generate HMAC-SHA256 signature for a transaction payload.
    Uses canonical JSON sorting to ensure consistency.
    """
    if not secret:
        return ""
    
    # Strip existing signature if present to compute over the base payload
    payload_copy = payload.copy()
    payload_copy.pop("hmac_signature", None)
    
    canonical = json.dumps(payload_copy, sort_keys=True, default=str)
    return hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()


def verify_transaction(payload: dict, signature: str, secret: str) -> bool:
    """Verify HMAC signature matches the payload."""
    if not secret:
        return True # Bypass in dev if no secret
    expected = sign_transaction(payload, secret)
    return hmac.compare_digest(expected, signature)
