from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.database import get_db
from app.models.audit_log import AuditLog
from app.schemas.audit import AuditLogResponse
from app.auth.dependencies import require_role
from app.models.user import User
from typing import Optional
import hashlib

router = APIRouter(prefix="/api/audit", tags=["Audit"])


@router.get("/", response_model=list[AuditLogResponse])
async def list_audit_logs(
    transaction_id: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin", "csr", "member")),
):
    """Query audit logs with optional filters."""
    query = select(AuditLog).order_by(desc(AuditLog.timestamp))

    if transaction_id:
        query = query.where((AuditLog.transaction_id == transaction_id) | (AuditLog.subject_id == transaction_id))
    if event_type:
        query = query.where(AuditLog.event_type == event_type)
    if severity:
        query = query.where(AuditLog.severity == severity)

    query = query.limit(limit).offset(offset)
    result = await db.execute(query)
    logs = result.scalars().all()
    return [AuditLogResponse.model_validate(l) for l in logs]


@router.get("/verify")
async def verify_audit_chain(
    transaction_id: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin", "csr", "member")),
):
    """Verify the integrity of the audit hash chain."""
    query = select(AuditLog).order_by(AuditLog.timestamp)
    if transaction_id:
        query = query.where((AuditLog.transaction_id == transaction_id) | (AuditLog.subject_id == transaction_id))
    query = query.limit(limit)
    result = await db.execute(query)
    logs = result.scalars().all()

    if not logs:
        return {"valid": True, "entries_checked": 0, "message": "No logs to verify"}

    for i, log in enumerate(logs):
        if i == 0:
            content = f"{log.id}:{log.transaction_id or log.subject_id}:{log.event_type}:{log.description}:{log.timestamp.isoformat()}"
            expected_hash = hashlib.sha256(content.encode()).hexdigest()
        else:
            prev = logs[i - 1]
            if log.prev_hash != prev.entry_hash:
                return {
                    "valid": False,
                    "broken_at_id": log.id,
                    "expected_prev_hash": prev.entry_hash,
                    "actual_prev_hash": log.prev_hash,
                    "entries_checked": i,
                }
            content = f"{log.id}:{log.transaction_id or log.subject_id}:{log.event_type}:{log.description}:{log.timestamp.isoformat()}:{log.prev_hash}"
            expected_hash = hashlib.sha256(content.encode()).hexdigest()

        if log.entry_hash != expected_hash:
            return {
                "valid": False,
                "corrupted_id": log.id,
                "expected_hash": expected_hash,
                "actual_hash": log.entry_hash,
                "entries_checked": i + 1,
            }

    return {
        "valid": True,
        "entries_checked": len(logs),
        "chain_head": logs[-1].entry_hash if logs else None,
        "chain_tail": logs[0].entry_hash if logs else None,
    }


@router.get("/{transaction_id}/trail", response_model=list[AuditLogResponse])
async def get_transaction_audit_trail(
    transaction_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("admin", "csr", "member")),
):
    """Get the full cryptographic audit trail for a specific transaction."""
    query = (
        select(AuditLog)
        .where((AuditLog.transaction_id == transaction_id) | (AuditLog.subject_id == transaction_id))
        .order_by(AuditLog.timestamp)
    )
    result = await db.execute(query)
    logs = result.scalars().all()
    return [AuditLogResponse.model_validate(l) for l in logs]


def _compute_hash(event_type: str, event_data: str, description: str, prev_hash: str) -> str:
    """Compute SHA-256 hash for audit chain verification."""
    content = f"{event_type}|{event_data}|{description}|{prev_hash}"
    return hashlib.sha256(content.encode()).hexdigest()
