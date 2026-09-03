from app.routers.transactions import router as transactions_router
from app.routers.decisions import router as decisions_router
from app.routers.audit import router as audit_router
from app.routers.watchdog import router as watchdog_router
from app.routers.dashboard import router as dashboard_router
from app.routers.market import router as market_router
from app.routers.portfolio import router as portfolio_router
from app.routers.voice import router as voice_router
from app.routers.telemetry import router as telemetry_router

__all__ = [
    "transactions_router",
    "decisions_router",
    "audit_router",
    "watchdog_router",
    "dashboard_router",
    "market_router",
    "portfolio_router",
    "voice_router",
    "telemetry_router",
]
