import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import String, DateTime, Numeric, Float, JSON, ForeignKey, Text, Integer, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.config import get_settings
from app.database import Base


class Position(Base):
    """
    An open or closed exposure to one instrument.

    A position carries the market state it was opened under — price, volatility,
    spread, depth — so the reassessment loop can tell whether the conditions
    that justified it still hold, and so a closed position can be scored
    against the reasoning that created it.
    """

    __tablename__ = "positions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    portfolio_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("portfolios.id"), nullable=False, index=True
    )
    symbol: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    side: Mapped[str] = mapped_column(String(8), nullable=False)  # long | short

    quantity: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), nullable=False
    )
    entry_price: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), nullable=False
    )
    exit_price: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), nullable=True
    )
    notional: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), nullable=False
    )

    realized_pnl: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), default=Decimal("0")
    )
    fees_paid: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), default=Decimal("0")
    )
    slippage_paid: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), default=Decimal("0")
    )

    status: Mapped[str] = mapped_column(String(20), default="open", index=True)  # open | closed

    # --- Market state at entry, for reassessment and post-hoc scoring ---
    entry_volatility: Mapped[float] = mapped_column(Float, default=0.0)
    entry_sigma: Mapped[float] = mapped_column(Float, default=0.0)
    entry_spread_bps: Mapped[float] = mapped_column(Float, default=0.0)
    expected_edge_bps: Mapped[float] = mapped_column(Float, default=0.0)

    # --- Risk envelope decided at entry ---
    stop_price: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), nullable=True
    )
    target_price: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), nullable=True
    )

    # The decision that opened this position, and how often it has been re-examined.
    opening_decision_id: Mapped[str] = mapped_column(String(36), nullable=True, index=True)
    closing_decision_id: Mapped[str] = mapped_column(String(36), nullable=True)
    reassessment_count: Mapped[int] = mapped_column(Integer, default=0)
    last_reassessed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    close_reason: Mapped[str] = mapped_column(String(100), nullable=True)

    # Per-agent votes at entry, kept so the adaptation layer can attribute the
    # realised outcome back to the agents that argued for the trade.
    entry_agent_votes: Mapped[dict] = mapped_column(JSON, nullable=True, default=dict)
    thesis: Mapped[str] = mapped_column(Text, nullable=True)

    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)

    portfolio = relationship("Portfolio", back_populates="positions", lazy="noload")
    fills = relationship("Fill", back_populates="position", lazy="selectin")

    def __repr__(self):
        return f"<Position {self.symbol} {self.side} {self.quantity} @ {self.entry_price} [{self.status}]>"


class Fill(Base):
    """
    A single executed slice, recording what the agent expected to pay versus
    what it actually paid. Without this the difference between identifying an
    opportunity and executing on it is invisible.
    """

    __tablename__ = "fills"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    position_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("positions.id"), nullable=False, index=True
    )
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    side: Mapped[str] = mapped_column(String(8), nullable=False)  # buy | sell
    quantity: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), nullable=False
    )

    # Mid at the moment the decision was taken.
    reference_price: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), nullable=False
    )
    # Price actually achieved after crossing the book.
    fill_price: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), nullable=False
    )

    expected_slippage_bps: Mapped[float] = mapped_column(Float, default=0.0)
    realized_slippage_bps: Mapped[float] = mapped_column(Float, default=0.0)
    fee: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), default=Decimal("0")
    )

    # Identifier returned by the execution venue or ledger provider.
    external_ref: Mapped[str] = mapped_column(String(128), nullable=True)
    venue: Mapped[str] = mapped_column(String(32), default="simulated")

    executed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    position = relationship("Position", back_populates="fills", lazy="noload")

    def __repr__(self):
        return f"<Fill {self.side} {self.quantity} {self.symbol} @ {self.fill_price}>"


class LedgerEntry(Base):
    """
    Double-entry record of every movement of money.

    Each cash movement writes two rows that must sum to zero. This is what
    makes the capital constraint real: NAV is derived from the ledger, not
    from a mutable in-memory float.
    """

    __tablename__ = "ledger_entries"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    # Both legs of one movement share a transfer_id.
    transfer_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    portfolio_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)

    account: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # Positive credits the account, negative debits it.
    amount: Mapped[Decimal] = mapped_column(
        Numeric(precision=22, scale=8), nullable=False
    )
    currency: Mapped[str] = mapped_column(
        String(8), default=lambda: get_settings().BASE_CURRENCY
    )

    entry_type: Mapped[str] = mapped_column(String(40), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=True)
    position_id: Mapped[str] = mapped_column(String(36), nullable=True, index=True)

    # "stitch" once the Stitch adapter is live, "local" for the built-in ledger.
    provider: Mapped[str] = mapped_column(String(32), default="local")
    external_ref: Mapped[str] = mapped_column(String(128), nullable=True)

    # Which rail settled the cash movement, and whether it was real.
    # Carried on the entry itself so a simulated settlement can never be
    # presented as a real one by a reader further down the chain.
    settlement_provider: Mapped[str] = mapped_column(String(32), nullable=True)
    settlement_ref: Mapped[str] = mapped_column(String(128), nullable=True)
    is_paper: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )

    def __repr__(self):
        return f"<LedgerEntry {self.account} {self.amount} {self.entry_type}>"
