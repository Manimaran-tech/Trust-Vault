import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Float, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class WatchdogAlert(Base):
    __tablename__ = "watchdog_alerts"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    alert_type: Mapped[str] = mapped_column(
        String(100), nullable=False
    )  # confidence_drift, repeated_disagreement, anomaly_detected, model_drift, auto_suspension
    severity: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # low, medium, high, critical
    agent_name: Mapped[str] = mapped_column(String(100), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[dict] = mapped_column(JSON, nullable=True, default=dict)
    anomaly_score: Mapped[float] = mapped_column(Float, nullable=True)
    is_resolved: Mapped[bool] = mapped_column(default=False)
    resolved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    def __repr__(self):
        return f"<WatchdogAlert {self.alert_type} [{self.severity}]>"
