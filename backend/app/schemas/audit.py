from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class AuditLogResponse(BaseModel):
    id: str
    transaction_id: Optional[str] = None
    subject_id: Optional[str] = None
    subject_type: Optional[str] = "transaction"
    event_type: str
    event_data: dict
    agent_name: Optional[str] = None
    severity: str
    description: str
    timestamp: datetime
    prev_hash: Optional[str] = None
    entry_hash: str

    class Config:
        from_attributes = True
