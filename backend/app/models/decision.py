import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Float, ForeignKey, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Decision(Base):
    __tablename__ = "decisions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    transaction_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("transactions.id"), unique=True, nullable=False, index=True
    )
    final_decision: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # approve, deny, review
    aggregated_confidence: Mapped[float] = mapped_column(Float, nullable=False)
    voting_breakdown: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    dissenting_opinions: Mapped[list] = mapped_column(JSON, nullable=True, default=list)
    governance_result: Mapped[dict] = mapped_column(JSON, nullable=True, default=dict)
    explainability_summary: Mapped[str] = mapped_column(Text, nullable=True)
    requires_human_approval: Mapped[bool] = mapped_column(default=False)
    human_override: Mapped[str] = mapped_column(String(50), nullable=True)
    human_override_reason: Mapped[str] = mapped_column(Text, nullable=True)
    processing_time_ms: Mapped[float] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    transaction = relationship("Transaction", back_populates="decision", lazy="selectin")
    agent_verdicts = relationship("AgentVerdict", back_populates="decision_record", lazy="selectin")

    def __repr__(self):
        return f"<Decision {self.id[:8]} {self.final_decision} ({self.aggregated_confidence:.0%})>"
