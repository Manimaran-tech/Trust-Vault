import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import String, DateTime, Numeric, Float, JSON, Text, Boolean, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MarketDecision(Base):
    """
    One pass of the decision loop over one candidate action.

    Records the whole chain: what was observed, what each expert said, what the
    consensus was, how much capital the allocator granted and why, whether it
    executed, and — once the position closes — what actually happened. That last
    field is what makes the loop a loop rather than a sequence of one-shot calls.
    """

    __tablename__ = "market_decisions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    portfolio_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False, index=True)

    # open | close | hold — what was under consideration
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    side: Mapped[str] = mapped_column(String(8), nullable=True)

    # approve | deny | review | pending_human_review
    final_decision: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    aggregated_confidence: Mapped[float] = mapped_column(Float, nullable=False)
    voting_breakdown: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    dissenting_opinions: Mapped[list] = mapped_column(JSON, nullable=True, default=list)
    explainability_summary: Mapped[str] = mapped_column(Text, nullable=True)

    # The market state this decision was made against, so it can be replayed
    # and so a later reader can see what the desk actually knew at the time.
    observation: Mapped[dict] = mapped_column(JSON, nullable=True, default=dict)
    observation_age_seconds: Mapped[float] = mapped_column(Float, default=0.0)

    # Capital picture and the limits in force at decision time.
    portfolio_state: Mapped[dict] = mapped_column(JSON, nullable=True, default=dict)
    constraints: Mapped[dict] = mapped_column(JSON, nullable=True, default=dict)

    # What the allocator decided and what bound it.
    allocation: Mapped[dict] = mapped_column(JSON, nullable=True, default=dict)
    proposed_notional: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), default=Decimal("0")
    )
    expected_edge_bps: Mapped[float] = mapped_column(Float, default=0.0)
    expected_cost_bps: Mapped[float] = mapped_column(Float, default=0.0)
    binding_constraint: Mapped[str] = mapped_column(String(64), nullable=True)

    executed: Mapped[bool] = mapped_column(Boolean, default=False)
    position_id: Mapped[str] = mapped_column(String(36), nullable=True, index=True)
    execution_error: Mapped[str] = mapped_column(String(500), nullable=True)

    # Why this pass ran at all: scheduled sweep, sigma move, stop, target, etc.
    trigger: Mapped[str] = mapped_column(String(48), default="scheduled")
    is_reassessment: Mapped[bool] = mapped_column(Boolean, default=False)
    reassessment_of: Mapped[str] = mapped_column(String(36), nullable=True)

    requires_human_approval: Mapped[bool] = mapped_column(Boolean, default=False)
    human_override: Mapped[str] = mapped_column(String(32), nullable=True)
    human_override_reason: Mapped[str] = mapped_column(Text, nullable=True)

    # --- Outcome, written back when the resulting position closes ---
    outcome_recorded: Mapped[bool] = mapped_column(Boolean, default=False)
    realized_pnl: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), nullable=True
    )
    outcome_correct: Mapped[bool] = mapped_column(Boolean, nullable=True)
    agents_scored: Mapped[int] = mapped_column(Integer, default=0)

    processing_time_ms: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )

    def __repr__(self):
        return (
            f"<MarketDecision {self.action} {self.side or ''} {self.symbol} "
            f"{self.final_decision} ({self.aggregated_confidence:.0%})>"
        )
