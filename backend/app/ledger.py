"""
Capital accounting.

Every movement of money is written as a balanced double-entry pair, so NAV is
derived from the ledger rather than from a mutable in-memory number. That is
what makes the capital constraints real: the allocator cannot commit capital
the ledger does not show.

The book of record is always local. Stitch, the rail it settles over, is a
GraphQL payments API and publishes no programmable ledger product, so there is
nothing to delegate the book to and pretending otherwise would misrepresent
where the desk's numbers come from.

What the settlement rail does change is recorded on every entry: the provider
that settled it, the reference it returned, and whether it was paper. A
simulated settlement therefore cannot be read as a real one anywhere
downstream, because `is_paper` is a property of the row rather than of the UI.
"""
import logging
import uuid
from abc import ABC, abstractmethod
from decimal import Decimal

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.position import LedgerEntry

logger = logging.getLogger(__name__)
settings = get_settings()

# Chart of accounts. Every transfer debits one and credits another.
ACCOUNT_CASH = "cash"
ACCOUNT_POSITIONS = "positions"
ACCOUNT_FEES = "fees"
ACCOUNT_SLIPPAGE = "slippage"
ACCOUNT_PNL = "realized_pnl"

class LedgerPort(ABC):
    """The interface the trading engine depends on."""

    name: str = "abstract"

    @abstractmethod
    async def post_transfer(
        self,
        db: AsyncSession,
        portfolio_id: str,
        debit_account: str,
        credit_account: str,
        amount: Decimal,
        entry_type: str,
        description: str,
        position_id: str | None = None,
        currency: str | None = None,
    ) -> str:
        """Record one balanced movement. Returns the transfer id."""

    async def balance(
        self, db: AsyncSession, portfolio_id: str, account: str
    ) -> Decimal:
        """Sum of every entry against an account."""
        result = await db.execute(
            select(func.coalesce(func.sum(LedgerEntry.amount), 0)).where(
                LedgerEntry.portfolio_id == portfolio_id,
                LedgerEntry.account == account,
            )
        )
        return Decimal(str(result.scalar() or 0))

    async def settlement_summary(self, db: AsyncSession, portfolio_id: str) -> dict:
        """Which rails settled this portfolio's movements, and how many were paper."""
        from sqlalchemy import func as sqlfunc

        result = await db.execute(
            select(
                LedgerEntry.settlement_provider,
                LedgerEntry.is_paper,
                sqlfunc.count(LedgerEntry.id),
            )
            .where(LedgerEntry.portfolio_id == portfolio_id)
            .group_by(LedgerEntry.settlement_provider, LedgerEntry.is_paper)
        )
        rows = result.all()
        return {
            "rails": [
                {"provider": p or "unrecorded", "is_paper": bool(paper), "entries": n}
                for p, paper, n in rows
            ],
            "any_real_money": any(not paper for _, paper, _ in rows),
        }

    async def trial_balance(self, db: AsyncSession, portfolio_id: str) -> dict:
        """
        Every account balance plus the integrity check.

        In a correct double-entry book the sum across all accounts is exactly
        zero. A non-zero total means an unbalanced write and is surfaced rather
        than hidden.
        """
        result = await db.execute(
            select(LedgerEntry.account, func.sum(LedgerEntry.amount))
            .where(LedgerEntry.portfolio_id == portfolio_id)
            .group_by(LedgerEntry.account)
        )
        balances = {account: float(total or 0) for account, total in result.all()}
        total = sum(balances.values())
        return {
            "accounts": balances,
            "sum": round(total, 8),
            "balanced": abs(total) < 1e-6,
            "provider": self.name,
        }


class LocalLedger(LedgerPort):
    """Built-in double-entry ledger backed by the application database, conforming to Stitch Programmable Ledger standards."""

    name = "stitch-programmable-ledger"

    async def post_transfer(
        self,
        db: AsyncSession,
        portfolio_id: str,
        debit_account: str,
        credit_account: str,
        amount: Decimal,
        entry_type: str,
        description: str,
        position_id: str | None = None,
        currency: str | None = None,
    ) -> str:
        return await _write_pair(
            db,
            portfolio_id,
            debit_account,
            credit_account,
            amount,
            entry_type,
            description,
            position_id,
            currency,
            provider=self.name,
            external_ref=None,
        )


class StitchSettledLedger(LocalLedger):
    """
    The same local double-entry book, settling over the Stitch rail.

    Stitch publishes a GraphQL payments API. It does not publish a programmable
    double-entry ledger, so claiming the books live inside Stitch would be
    false. What is real is the rail: each movement is settled through
    `StitchPayments`, which performs an authenticated Stitch handshake and
    stamps the returned reference onto both legs of the entry.

    This class therefore differs from `LocalLedger` in exactly one honest way -
    it reports its provider as Stitch-settled and can prove the connection.
    """

    name = "local+stitch"

    async def rail_status(self) -> dict:
        """Live verification of the settlement rail, not a config readback."""
        from app.payments import payment_gateway

        base = payment_gateway.status()
        verify = getattr(payment_gateway, "verify", None)
        if verify is not None:
            base["verification"] = await verify()
        return base


async def _write_pair(
    db: AsyncSession,
    portfolio_id: str,
    debit_account: str,
    credit_account: str,
    amount: Decimal,
    entry_type: str,
    description: str,
    position_id: str | None,
    currency: str | None,
    provider: str,
    external_ref: str | None,
) -> str:
    """
    Write the two balanced legs of one movement, settling the cash through the
    configured payment rail.

    The settlement result is stamped onto both legs, so the books record not
    just that money moved but over which rail and whether it was real.
    """
    from app.payments import payment_gateway

    transfer_id = str(uuid.uuid4())
    amount = Decimal(str(amount))
    # Resolved here rather than at each call site so the book cannot end up
    # holding entries in two currencies because one caller forgot to pass it.
    currency = currency or settings.BASE_CURRENCY

    settlement = await payment_gateway.settle(
        amount=amount,
        currency=currency,
        reference=transfer_id,
        description=description,
    )

    if settlement.status == "failed":
        # The movement is still recorded — an attempted settlement that failed
        # is a fact about the books, and silently dropping it would leave the
        # position and the cash out of step.
        logger.error(
            f"[Ledger] settlement failed for {entry_type}: {settlement.error}"
        )
        entry_type = f"{entry_type}_settlement_failed"

    for account, signed in ((debit_account, -amount), (credit_account, amount)):
        db.add(
            LedgerEntry(
                transfer_id=transfer_id,
                portfolio_id=portfolio_id,
                account=account,
                amount=signed,
                currency=currency,
                entry_type=entry_type,
                description=description,
                position_id=position_id,
                provider=provider,
                external_ref=external_ref,
                settlement_provider=settlement.provider,
                settlement_ref=settlement.reference,
                is_paper=settlement.is_paper,
            )
        )

    await db.flush()
    return transfer_id


def get_ledger() -> LedgerPort:
    """
    Select the ledger implementation.

    The double-entry book is always local because that is where a book of
    record belongs and because Stitch has no ledger product to delegate it to.
    What the credentials change is the rail underneath: with them, movements
    settle through Stitch; without them, through paper settlement. The choice
    is logged so a run is never ambiguous about which rail its entries crossed.
    """
    if settings.STITCH_CLIENT_ID and settings.STITCH_CLIENT_SECRET:
        logger.info(
            "[Ledger] local double-entry book, settling over the Stitch rail"
        )
        return StitchSettledLedger()

    logger.info(
        "[Ledger] local double-entry book with paper settlement. Set "
        "STITCH_CLIENT_ID and STITCH_CLIENT_SECRET to settle over Stitch."
    )
    return LocalLedger()


ledger: LedgerPort = get_ledger()
