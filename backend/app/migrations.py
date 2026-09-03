"""
Small, idempotent schema and data migrations run at startup.

The project uses `create_all`, which adds new tables but never alters an
existing one. Columns added to a model after a table already exists therefore
never appear, and the resulting failure is a runtime `no such column` in the
middle of a request rather than an error at boot. These migrations close that
gap for the handful of changes that need it, and every one of them is safe to
run repeatedly.
"""
import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# (table, column, DDL type + default) for columns added after first release.
_ADDED_COLUMNS = [
    ("agent_performance", "votes_cast", "INTEGER DEFAULT 0"),
    ("agent_performance", "last_vote_at", "TIMESTAMP"),
    ("agent_performance", "hallucinations_detected", "INTEGER DEFAULT 0"),
    ("audit_logs", "subject_id", "VARCHAR(36)"),
    ("audit_logs", "subject_type", "VARCHAR(32) DEFAULT 'transaction'"),
]


async def run_migrations(db: AsyncSession) -> dict:
    """Apply every pending migration. Returns what it actually changed."""
    applied: list[str] = []

    applied += await _add_missing_columns(db)
    applied += await _align_book_currency(db)

    await db.commit()
    if applied:
        logger.info("[Migrations] applied: %s", ", ".join(applied))
    return {"applied": applied}


async def _add_missing_columns(db: AsyncSession) -> list[str]:
    applied = []
    for table, column, ddl in _ADDED_COLUMNS:
        if not await _table_exists(db, table):
            continue
        if await _column_exists(db, table, column):
            continue
        await db.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
        applied.append(f"{table}.{column}")
    return applied


async def _align_book_currency(db: AsyncSession) -> list[str]:
    """
    Bring an existing book onto the configured currency.

    A book opened before the desk was retargeted at NSE carries USD rows while
    every price the feed now reports is in rupees. Left alone the totals are
    arithmetically fine and semantically meaningless, so the currency label is
    corrected in place. Only the label moves — no amount is converted, because
    inventing an FX rate here would be worse than the mismatch.
    """
    applied = []
    target = settings.BASE_CURRENCY

    for table in ("portfolios",):
        if not await _table_exists(db, table):
            continue
        result = await db.execute(
            text(f"UPDATE {table} SET base_currency = :c WHERE base_currency != :c"),
            {"c": target},
        )
        if result.rowcount:
            applied.append(f"{table}.base_currency -> {target} ({result.rowcount} rows)")

    for table in ("ledger_entries",):
        if not await _table_exists(db, table):
            continue
        result = await db.execute(
            text(f"UPDATE {table} SET currency = :c WHERE currency != :c"),
            {"c": target},
        )
        if result.rowcount:
            applied.append(f"{table}.currency -> {target} ({result.rowcount} rows)")

    return applied


async def _table_exists(db: AsyncSession, table: str) -> bool:
    result = await db.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name = :t"),
        {"t": table},
    )
    return result.first() is not None


async def _column_exists(db: AsyncSession, table: str, column: str) -> bool:
    result = await db.execute(text(f"PRAGMA table_info({table})"))
    return any(row[1] == column for row in result.fetchall())
