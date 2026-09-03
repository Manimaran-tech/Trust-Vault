from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.database import get_db
from app.models.watchdog_alert import WatchdogAlert
from app.schemas.watchdog import WatchdogAlertResponse
from app.auth.dependencies import require_role
from app.models.user import User
from app.watchdog import get_agent_health

router = APIRouter(prefix="/api/watchdog", tags=["Watchdog"])


@router.get("/alerts", response_model=list[WatchdogAlertResponse])
async def list_watchdog_alerts(
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """List recent watchdog alerts. Admin only."""
    result = await db.execute(
        select(WatchdogAlert)
        .order_by(desc(WatchdogAlert.created_at))
        .limit(limit)
    )
    alerts = result.scalars().all()
    return [WatchdogAlertResponse.model_validate(a) for a in alerts]


@router.get("/health")
async def get_system_health(
    current_user: User = Depends(require_role("admin")),
):
    """Get health metrics for all monitored agents. Admin only."""
    return {"agents": get_agent_health()}
