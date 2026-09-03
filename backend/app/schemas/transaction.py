from pydantic import BaseModel, Field, field_validator
from decimal import Decimal
from datetime import datetime
from typing import Optional, Literal
import re


class TransactionRequest(BaseModel):
    transaction_type: Literal["purchase", "transfer", "withdrawal", "payment", "wire"]
    amount: Decimal = Field(gt=0, max_digits=19, decimal_places=4, description="Transaction amount (must be positive)")
    currency: str = Field(default="USD", min_length=3, max_length=3)
    merchant_name: Optional[str] = Field(default=None, max_length=255)
    merchant_category: Optional[str] = Field(default=None, max_length=100)
    merchant_country: Optional[str] = Field(default=None, max_length=100)
    card_member_name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=1000)
    metadata: Optional[dict] = None

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, v: str) -> str:
        if not re.match(r"^[A-Z]{3}$", v):
            raise ValueError("Currency must be a 3-letter uppercase ISO code (e.g., USD, EUR, GBP)")
        return v

    @field_validator("amount")
    @classmethod
    def validate_amount_range(cls, v: Decimal) -> Decimal:
        if v > Decimal("999999999.9999"):
            raise ValueError("Amount exceeds maximum allowed value")
        return v


class TransactionResponse(BaseModel):
    id: str
    user_id: str
    transaction_type: str
    amount: Decimal
    currency: str
    merchant_name: Optional[str] = None
    merchant_category: Optional[str] = None
    merchant_country: Optional[str] = None
    card_member_name: str
    description: Optional[str] = None
    status: str
    created_at: datetime
    processed_at: Optional[datetime] = None

    class Config:
        from_attributes = True
