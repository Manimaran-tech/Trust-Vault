from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class WatchdogAlertResponse(BaseModel):
    id: str
    alert_type: str
    severity: str
    agent_name: Optional[str] = None
    description: str
    details: dict = {}
    anomaly_score: Optional[float] = None
    is_resolved: bool
    created_at: datetime

    class Config:
        from_attributes = True
