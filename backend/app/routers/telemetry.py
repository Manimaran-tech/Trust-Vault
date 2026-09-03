"""
Infrastructure telemetry.

Every figure here is read from the running system. Where a metric cannot be
obtained the response says so explicitly rather than substituting a plausible
number — a dashboard that invents its own uptime is worse than one that admits
it does not know.
"""
import logging
import time

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.autonomous_loop import autonomous_loop
from app.config import get_settings
from app.database import get_db, engine
from app.ledger import ledger
from app.market.feed import market_feed
from app.market.news import news_feed
from app.models.audit_log import AuditLog
from app.models.market_decision import MarketDecision
from app.models.position import Fill, Position
from app.models.user import User
from app.ws_manager import ws_manager

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/telemetry", tags=["Telemetry"])


def _unavailable(reason: str) -> dict:
    return {"available": False, "reason": reason}


@router.get("/infrastructure")
async def get_infrastructure(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Live service health, measured rather than asserted."""
    return {
        "database": await _database_telemetry(db),
        "redis": await _redis_telemetry(),
        "llm": _llm_telemetry(),
        "market_feed": market_feed.status(),
        "news_feed": news_feed.status(),
        "decision_loop": autonomous_loop.status(),
        "ledger": {"provider": ledger.name},
        "websocket": {"active_connections": len(ws_manager.active_connections)},
    }


async def _database_telemetry(db: AsyncSession) -> dict:
    started = time.perf_counter()
    try:
        await db.execute(text("SELECT 1"))
        latency_ms = (time.perf_counter() - started) * 1000
    except Exception as e:
        return {"connected": False, **_unavailable(str(e))}

    info: dict = {
        "connected": True,
        "available": True,
        "ping_latency_ms": round(latency_ms, 3),
        "dialect": engine.dialect.name,
    }

    pool = engine.pool
    try:
        info["pool"] = {
            "size": pool.size(),
            "checked_out": pool.checkedout(),
            "overflow": pool.overflow(),
        }
    except Exception:
        info["pool"] = _unavailable("pool statistics are not exposed by this dialect")

    # Server-side statistics are PostgreSQL-specific; SQLite has no equivalent.
    if engine.dialect.name == "postgresql":
        try:
            result = await db.execute(
                text(
                    """
                    SELECT numbackends, xact_commit, xact_rollback,
                           blks_read, blks_hit, tup_inserted, tup_fetched
                    FROM pg_stat_database
                    WHERE datname = current_database()
                    """
                )
            )
            row = result.first()
            if row:
                reads, hits = row.blks_read or 0, row.blks_hit or 0
                total = reads + hits
                info["server"] = {
                    "backends": row.numbackends,
                    "commits": row.xact_commit,
                    "rollbacks": row.xact_rollback,
                    "cache_hit_ratio": round(hits / total, 5) if total else None,
                    "rows_inserted": row.tup_inserted,
                    "rows_fetched": row.tup_fetched,
                }
        except Exception as e:
            info["server"] = _unavailable(str(e))
    else:
        info["server"] = _unavailable(
            f"pg_stat_database is not available on {engine.dialect.name}"
        )

    return info


async def _redis_telemetry() -> dict:
    try:
        import redis.asyncio as aioredis

        client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        started = time.perf_counter()
        await client.ping()
        latency_ms = (time.perf_counter() - started) * 1000
        info = await client.info()
        await client.aclose()

        hits = info.get("keyspace_hits", 0)
        misses = info.get("keyspace_misses", 0)
        total = hits + misses

        return {
            "connected": True,
            "available": True,
            "ping_latency_ms": round(latency_ms, 3),
            "version": info.get("redis_version"),
            "used_memory_bytes": info.get("used_memory"),
            "used_memory_human": info.get("used_memory_human"),
            "connected_clients": info.get("connected_clients"),
            "ops_per_second": info.get("instantaneous_ops_per_sec"),
            "keyspace_hits": hits,
            "keyspace_misses": misses,
            "hit_ratio": round(hits / total, 5) if total else None,
            "evicted_keys": info.get("evicted_keys"),
            "uptime_seconds": info.get("uptime_in_seconds"),
        }
    except Exception as e:
        return {"connected": False, **_unavailable(str(e))}


def _llm_telemetry() -> dict:
    return {
        "base_url": settings.LLM_BASE_URL,
        "model": settings.LLM_MODEL,
        "timeout_seconds": settings.LLM_TIMEOUT_SECONDS,
        "max_retries": settings.LLM_MAX_RETRIES,
    }


@router.get("/pipeline")
async def get_pipeline(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Per-stage throughput and latency for the decision loop, measured from the
    decisions actually recorded.
    """
    total = (
        await db.execute(select(func.count(MarketDecision.id)))
    ).scalar() or 0
    executed = (
        await db.execute(
            select(func.count(MarketDecision.id)).where(
                MarketDecision.executed.is_(True)
            )
        )
    ).scalar() or 0
    escalated = (
        await db.execute(
            select(func.count(MarketDecision.id)).where(
                MarketDecision.requires_human_approval.is_(True)
            )
        )
    ).scalar() or 0
    reassessments = (
        await db.execute(
            select(func.count(MarketDecision.id)).where(
                MarketDecision.is_reassessment.is_(True)
            )
        )
    ).scalar() or 0
    avg_latency = (
        await db.execute(select(func.avg(MarketDecision.processing_time_ms)))
    ).scalar()
    audit_entries = (
        await db.execute(select(func.count(AuditLog.id)))
    ).scalar() or 0

    # How far the desk's execution-cost model is from reality.
    fill_stats = (
        await db.execute(
            select(
                func.count(Fill.id),
                func.avg(Fill.expected_slippage_bps),
                func.avg(Fill.realized_slippage_bps),
            )
        )
    ).first()
    fill_count, avg_expected, avg_realized = fill_stats or (0, None, None)

    snapshot = market_feed.snapshot()
    return {
        "stages": {
            "perception": {
                "provider": market_feed.provider,
                "connected": market_feed.status()["connected"],
                "ticks_received": market_feed.status()["ticks_received"],
                "instruments_fresh": len(
                    snapshot.fresh(settings.MARKET_STALENESS_SECONDS)
                ),
                "instruments_total": len(market_feed.symbols),
            },
            "reasoning": {
                "decisions_total": total,
                "avg_latency_ms": round(float(avg_latency), 2) if avg_latency else None,
            },
            "allocation": {
                "executed": executed,
                "declined": total - executed - escalated,
                "escalated": escalated,
            },
            "execution": {
                "fills": fill_count or 0,
                "avg_expected_slippage_bps": round(float(avg_expected), 3)
                if avg_expected
                else None,
                "avg_realized_slippage_bps": round(float(avg_realized), 3)
                if avg_realized
                else None,
                "model_error_bps": round(
                    float(avg_realized) - float(avg_expected), 3
                )
                if avg_expected and avg_realized
                else None,
            },
            "adaptation": {
                "reassessments": reassessments,
                "outcomes_recorded": (
                    await db.execute(
                        select(func.count(MarketDecision.id)).where(
                            MarketDecision.outcome_recorded.is_(True)
                        )
                    )
                ).scalar()
                or 0,
            },
            "audit": {"entries": audit_entries},
        },
        "loop": autonomous_loop.status(),
    }
