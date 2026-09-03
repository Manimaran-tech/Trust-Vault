import uuid
from decimal import Decimal
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey, Text, JSON, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.config import get_settings
from app.database import Base


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True
    )
    transaction_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # purchase, transfer, withdrawal, payment
    amount: Mapped[Decimal] = mapped_column(
        Numeric(precision=19, scale=4), nullable=False
    )  # Decimal for precise currency handling
    currency: Mapped[str] = mapped_column(
        String(3), default=lambda: get_settings().BASE_CURRENCY
    )
    merchant_name: Mapped[str] = mapped_column(String(255), nullable=True)
    merchant_category: Mapped[str] = mapped_column(String(100), nullable=True)
    merchant_country: Mapped[str] = mapped_column(String(100), nullable=True)
    card_member_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, nullable=True, default=dict)
    status: Mapped[str] = mapped_column(
        String(50), default="pending"
    )  # pending, processing, approved, denied, review, escalated
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    processed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    hmac_signature: Mapped[str] = mapped_column(String(64), nullable=True)
    encrypted_fields: Mapped[dict] = mapped_column(JSON, nullable=True, default=list)

    # Relationships
    user = relationship("User", back_populates="transactions", lazy="noload")
    decision = relationship("Decision", back_populates="transaction", uselist=False, lazy="noload")
    audit_logs = relationship("AuditLog", back_populates="transaction", lazy="noload")

    def __repr__(self):
        return f"<Transaction {self.id[:8]} {self.transaction_type} ${self.amount}>"
