import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import String, DateTime, Numeric, JSON, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.config import get_settings
from app.database import Base


class Portfolio(Base):
    """
    The agent's capital account.

    Cash and exposure are tracked separately so the allocator can only ever
    commit capital that actually exists. `peak_nav` backs the drawdown circuit
    breaker: the agent halts itself when losses from the high-water mark
    breach the configured limit.
    """

    __tablename__ = "portfolios"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    # The book currency. Defaults to the configured BASE_CURRENCY rather than
    # a hardcoded USD, because the instruments the desk trades decide it.
    base_currency: Mapped[str] = mapped_column(
        String(8), default=lambda: get_settings().BASE_CURRENCY
    )

    starting_capital: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), nullable=False
    )
    cash: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), nullable=False
    )
    realized_pnl: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), default=Decimal("0")
    )
    peak_nav: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), nullable=False
    )
    total_fees_paid: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), default=Decimal("0")
    )
    total_slippage_paid: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), default=Decimal("0")
    )

    # Human-defined constraints governing the autonomous loop. Stored rather
    # than read from config so they can be changed at runtime — including by
    # voice — and so every decision records the limits it was made under.
    constraints: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    # Set by the drawdown breaker or by a human. While halted the agent may
    # close positions but may not open new ones.
    halted: Mapped[bool] = mapped_column(Boolean, default=False)
    halt_reason: Mapped[str] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    positions = relationship("Position", back_populates="portfolio", lazy="selectin")

    def __repr__(self):
        return f"<Portfolio {self.name} cash={self.cash} realized={self.realized_pnl}>"
