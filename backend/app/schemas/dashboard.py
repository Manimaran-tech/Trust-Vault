from pydantic import BaseModel
from typing import Optional


class AgentHealthMetric(BaseModel):
    agent_name: str
    status: str  # active, degraded, suspended
    avg_confidence: float
    total_evaluations: int
    recent_alerts: int


class DashboardMetrics(BaseModel):
    total_transactions: int
    approved_count: int
    denied_count: int
    review_count: int
    approval_rate: float
    avg_confidence: float
    total_flags: int
    total_escalations: int
    agent_health: list[AgentHealthMetric]
    recent_decisions: list[dict]
