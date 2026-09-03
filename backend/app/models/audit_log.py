import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    # Nullable because the chain now covers market decisions as well as
    # transactions. Use subject_id/subject_type to address an entry generically.
    transaction_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("transactions.id"), nullable=True, index=True
    )
    # What this entry is about: a transaction id or a market decision id.
    subject_id: Mapped[str] = mapped_column(String(36), nullable=True, index=True)
    subject_type: Mapped[str] = mapped_column(String(32), default="transaction", index=True)
    event_type: Mapped[str] = mapped_column(
        String(100), nullable=False
    )  # transaction_received, agent_evaluation, consensus_reached, governance_check, decision_final, etc.
    event_data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    agent_name: Mapped[str] = mapped_column(String(100), nullable=True)
    severity: Mapped[str] = mapped_column(
        String(50), default="info"
    )  # info, warning, critical
    description: Mapped[str] = mapped_column(Text, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Hash chain for immutability
    prev_hash: Mapped[str] = mapped_column(
        String(64), nullable=True, default=None
    )  # SHA-256 of previous entry (None for first entry)
    entry_hash: Mapped[str] = mapped_column(
        String(64), nullable=False
    )  # SHA-256 of this entry's content + prev_hash

    # Relationships
    transaction = relationship("Transaction", back_populates="audit_logs", lazy="selectin")

    def __repr__(self):
        return f"<AuditLog {self.event_type} @ {self.timestamp}>"
