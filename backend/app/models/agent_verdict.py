import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Float, ForeignKey, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class AgentVerdict(Base):
    __tablename__ = "agent_verdicts"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    decision_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("decisions.id"), nullable=False, index=True
    )
    agent_name: Mapped[str] = mapped_column(
        String(100), nullable=False
    )  # identity, fraud, risk, compliance, policy, explainability
    decision: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # approve, deny, review
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    reasoning: Mapped[str] = mapped_column(Text, nullable=False)
    risk_flags: Mapped[list] = mapped_column(JSON, nullable=True, default=list)
    raw_llm_response: Mapped[str] = mapped_column(Text, nullable=True)
    processing_time_ms: Mapped[float] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    decision_record = relationship("Decision", back_populates="agent_verdicts", lazy="selectin")

    def __repr__(self):
        return f"<AgentVerdict {self.agent_name}: {self.decision} ({self.confidence:.0%})>"
