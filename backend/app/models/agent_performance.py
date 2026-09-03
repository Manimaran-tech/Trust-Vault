import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import String, DateTime, Numeric, Float, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AgentPerformance(Base):
    """
    Realised track record per expert agent — the substrate for adaptation.

    Every time a position closes, the agents that voted to open it are scored
    against what actually happened. Their consensus weight is then nudged
    toward the weight their hit rate justifies, so the system's behaviour
    changes in response to outcomes rather than staying fixed.
    """

    __tablename__ = "agent_performance"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    agent_name: Mapped[str] = mapped_column(
        String(50), unique=True, nullable=False, index=True
    )

    base_weight: Mapped[float] = mapped_column(Float, nullable=False)
    current_weight: Mapped[float] = mapped_column(Float, nullable=False)

    # Every vote this agent has cast, whether or not it has been scored yet.
    # Hit rate needs a closed position; participation does not, and without it
    # an agent that has argued in fifty decisions is indistinguishable from one
    # that has never run.
    votes_cast: Mapped[int] = mapped_column(Integer, default=0)
    last_vote_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    positions_influenced: Mapped[int] = mapped_column(Integer, default=0)
    correct_calls: Mapped[int] = mapped_column(Integer, default=0)
    incorrect_calls: Mapped[int] = mapped_column(Integer, default=0)
    hallucinations_detected: Mapped[int] = mapped_column(Integer, default=0)

    # Sum of realised P&L on positions this agent voted to open.
    attributed_pnl: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), default=Decimal("0")
    )
    # Mean confidence on calls that turned out right, and on calls that did not.
    avg_confidence_when_right: Mapped[float] = mapped_column(Float, default=0.0)
    avg_confidence_when_wrong: Mapped[float] = mapped_column(Float, default=0.0)

    last_adapted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    @property
    def hit_rate(self) -> float:
        total = self.correct_calls + self.incorrect_calls
        return self.correct_calls / total if total else 0.0

    def __repr__(self):
        return (
            f"<AgentPerformance {self.agent_name} w={self.current_weight:.3f} "
            f"hit={self.hit_rate:.0%} n={self.positions_influenced}>"
        )
