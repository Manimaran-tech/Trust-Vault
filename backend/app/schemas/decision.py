from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class AgentVerdictResponse(BaseModel):
    id: str
    agent_name: str
    decision: str
    confidence: float
    reasoning: str
    risk_flags: list[str] = []
    processing_time_ms: Optional[float] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ConsensusResponse(BaseModel):
    final_decision: str
    aggregated_confidence: float
    voting_breakdown: dict
    dissenting_opinions: list = []


class GovernanceCheckResponse(BaseModel):
    passed: bool
    checks: list[dict]
    requires_human_approval: bool
    escalation_reason: Optional[str] = None


class DecisionResponse(BaseModel):
    id: str
    transaction_id: str
    final_decision: str
    aggregated_confidence: float
    requires_human_approval: bool
    human_override: Optional[str] = None
    explainability_summary: Optional[str] = None
    processing_time_ms: Optional[float] = None
    created_at: datetime
    # Joined transaction fields
    amount: Optional[float] = None
    merchant_name: Optional[str] = None
    merchant_country: Optional[str] = None
    transaction_type: Optional[str] = None

    class Config:
        from_attributes = True


class DecisionDetailResponse(BaseModel):
    id: str
    transaction_id: str
    final_decision: str
    aggregated_confidence: float
    voting_breakdown: dict
    dissenting_opinions: list = []
    governance_result: dict = {}
    explainability_summary: Optional[str] = None
    requires_human_approval: bool
    human_override: Optional[str] = None
    human_override_reason: Optional[str] = None
    processing_time_ms: Optional[float] = None
    created_at: datetime
    agent_verdicts: list[AgentVerdictResponse] = []
    transaction: Optional[dict] = None

    class Config:
        from_attributes = True
