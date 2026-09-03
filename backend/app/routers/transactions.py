import logging
import asyncio
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.database import get_db, async_session_factory
from app.models.user import User
from app.models.transaction import Transaction
from app.schemas.transaction import TransactionRequest, TransactionResponse
from app.auth.dependencies import get_current_user
from pydantic import BaseModel
from app.config import get_settings
from app.crypto import FieldEncryptor, sign_transaction, verify_transaction

class ResolveRequest(BaseModel):
    action: str
    reason: str = ""
from app.orchestrator import process_transaction
from app.ws_manager import ws_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/transactions", tags=["Transactions"])
settings = get_settings()
encryptor = FieldEncryptor(settings.ENCRYPTION_KEY)


async def _run_pipeline_background(tx_dict: dict, transaction_id: str):
    """Run the full MoE pipeline in the background using its own DB session."""
    try:
        async with async_session_factory() as db:
            result = await process_transaction(tx_dict, db)
            
            # Broadcast decision via WebSocket
            await ws_manager.broadcast({
                "type": "decision_made",
                "data": {
                    "transaction_id": transaction_id,
                    "decision": result["final_decision"],
                    "confidence": result["aggregated_confidence"],
                    "processing_time_ms": result["processing_time_ms"],
                    "requires_human": result["governance"]["requires_human_approval"],
                    "amount": tx_dict["amount"],
                    "merchant": tx_dict["merchant_name"],
                    "merchant_country": tx_dict["merchant_country"],
                    "description": tx_dict["description"],
                    "explainability_summary": result.get("explainability_summary", ""),
                }
            })
            if result["final_decision"] == "approve":
                # Rollback all decisions and audits flushed in this session
                await db.rollback()
                # Delete the transaction that was created earlier in create_transaction
                tx = await db.get(Transaction, transaction_id)
                if tx:
                    await db.delete(tx)
                    await db.commit()
            else:
                await db.commit()
    except Exception as e:
        logger.error(f"Background pipeline failed for tx {transaction_id}: {e}")
        async with async_session_factory() as db:
            tx = await db.scalar(select(Transaction).where(Transaction.id == transaction_id))
            if tx:
                tx.status = "error"
                await db.commit()


@router.post("/", response_model=dict, status_code=201)
async def create_transaction(
    request: Request,
    tx_data: TransactionRequest,
    background_tasks: BackgroundTasks,
    x_hmac_signature: str = Header(None, alias="X-HMAC-Signature"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Submit a new transaction for multi-agent evaluation.
    Fire-and-forget: returns immediately while pipeline runs in background.
    """
    payload_dict = tx_data.model_dump()
    
    # 1. Verify HMAC if provided
    if x_hmac_signature and settings.HMAC_SECRET:
        if not verify_transaction(payload_dict, x_hmac_signature, settings.HMAC_SECRET):
            raise HTTPException(status_code=400, detail="Invalid HMAC signature")
    
    # 2. Compute signature to store (using our canonical representation)
    stored_signature = sign_transaction(payload_dict, settings.HMAC_SECRET) if settings.HMAC_SECRET else None

    # 3. Encrypt PII Fields
    card_member = tx_data.card_member_name
    merchant = tx_data.merchant_name
    ip_loc = (tx_data.metadata or {}).get("ip_location", "")
    device = (tx_data.metadata or {}).get("device", "")
    
    encrypted_fields_list = ["card_member_name"]
    if merchant:
        encrypted_fields_list.append("merchant_name")
    
    # We encrypt fields on write
    enc_card_member = encryptor.encrypt(card_member)
    enc_merchant = encryptor.encrypt(merchant) if merchant else merchant
    
    meta = tx_data.metadata or {}
    # Prefer source_ip from metadata (for simulated multi-IP traffic) over request.client.host
    real_client_ip = request.client.host if request.client else "unknown"
    meta["client_ip"] = meta.get("source_ip") or real_client_ip
    
    if ip_loc:
        meta["ip_location_enc"] = encryptor.encrypt(ip_loc)
        encrypted_fields_list.append("metadata_json.ip_location")
    if device:
        meta["device_enc"] = encryptor.encrypt(device)
        encrypted_fields_list.append("metadata_json.device")

    # 4. Create the transaction record
    transaction = Transaction(
        user_id=current_user.id,
        transaction_type=tx_data.transaction_type,
        amount=tx_data.amount,
        currency=tx_data.currency,
        merchant_name=enc_merchant,
        merchant_category=tx_data.merchant_category,
        merchant_country=tx_data.merchant_country,
        card_member_name=enc_card_member,
        description=tx_data.description,
        metadata_json=meta,
        status="processing",
        hmac_signature=stored_signature,
        encrypted_fields=encrypted_fields_list,
    )
    db.add(transaction)
    await db.flush()
    await db.refresh(transaction)

    # 5. Broadcast: transaction received
    await ws_manager.broadcast({
        "type": "transaction_received",
        "data": {
            "id": transaction.id,
            "amount": float(transaction.amount),
            "merchant": merchant, # send plaintext via WS (TLS protected)
            "status": "processing",
            "transaction_type": transaction.transaction_type,
        }
    })

    # 6. Build plaintext transaction dict for the orchestrator (agents need plaintext)
    tx_dict = {
        "id": transaction.id,
        "user_id": current_user.id,
        "transaction_type": transaction.transaction_type,
        "amount": float(transaction.amount),
        "currency": transaction.currency,
        "merchant_name": merchant,
        "merchant_category": transaction.merchant_category,
        "merchant_country": transaction.merchant_country,
        "card_member_name": card_member,
        "description": transaction.description,
        "metadata": tx_data.metadata or {},
        "created_at": transaction.created_at.isoformat(),
    }

    # 7. Fire-and-forget: spawn background task
    asyncio.create_task(_run_pipeline_background(tx_dict, transaction.id))

    return {"transaction_id": transaction.id, "status": "processing"}


@router.post("/batch", response_model=dict, status_code=201)
async def create_batch_transactions(
    request: Request,
    tx_data_list: list[TransactionRequest],
    background_tasks: BackgroundTasks,
    x_hmac_signature: str = Header(None, alias="X-HMAC-Signature"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Submit multiple transactions for multi-agent evaluation concurrently.
    Fire-and-forget: returns immediately while pipelines run in background.
    """
    transaction_ids = []
    
    for tx_data in tx_data_list:
        payload_dict = tx_data.model_dump()
        
        stored_signature = sign_transaction(payload_dict, settings.HMAC_SECRET) if settings.HMAC_SECRET else None

        card_member = tx_data.card_member_name
        merchant = tx_data.merchant_name
        ip_loc = (tx_data.metadata or {}).get("ip_location", "")
        device = (tx_data.metadata or {}).get("device", "")
        
        encrypted_fields_list = ["card_member_name"]
        if merchant:
            encrypted_fields_list.append("merchant_name")
        
        enc_card_member = encryptor.encrypt(card_member)
        enc_merchant = encryptor.encrypt(merchant) if merchant else merchant
        
        meta = tx_data.metadata or {}
        real_client_ip = request.client.host if request.client else "unknown"
        meta["client_ip"] = meta.get("source_ip") or real_client_ip
        
        if ip_loc:
            meta["ip_location_enc"] = encryptor.encrypt(ip_loc)
            encrypted_fields_list.append("metadata_json.ip_location")
        if device:
            meta["device_enc"] = encryptor.encrypt(device)
            encrypted_fields_list.append("metadata_json.device")

        transaction = Transaction(
            user_id=current_user.id,
            transaction_type=tx_data.transaction_type,
            amount=tx_data.amount,
            currency=tx_data.currency,
            merchant_name=enc_merchant,
            merchant_category=tx_data.merchant_category,
            merchant_country=tx_data.merchant_country,
            card_member_name=enc_card_member,
            description=tx_data.description,
            metadata_json=meta,
            status="processing",
            hmac_signature=stored_signature,
            encrypted_fields=encrypted_fields_list,
        )
        db.add(transaction)
        await db.flush()
        await db.refresh(transaction)

        await ws_manager.broadcast({
            "type": "transaction_received",
            "data": {
                "id": transaction.id,
                "amount": float(transaction.amount),
                "merchant": merchant,
                "status": "processing",
                "transaction_type": transaction.transaction_type,
            }
        })

        tx_dict = {
            "id": transaction.id,
            "user_id": current_user.id,
            "transaction_type": transaction.transaction_type,
            "amount": float(transaction.amount),
            "currency": transaction.currency,
            "merchant_name": merchant,
            "merchant_category": transaction.merchant_category,
            "merchant_country": transaction.merchant_country,
            "card_member_name": card_member,
            "description": transaction.description,
            "metadata": tx_data.metadata or {},
            "created_at": transaction.created_at.isoformat(),
        }

        asyncio.create_task(_run_pipeline_background(tx_dict, transaction.id))
        
        transaction_ids.append(transaction.id)

    return {"transaction_ids": transaction_ids, "status": "processing"}


def _decrypt_transaction(t: Transaction) -> TransactionResponse:
    """Helper to decrypt a transaction before returning."""
    enc_fields = t.encrypted_fields or []
    
    card_name = encryptor.decrypt(t.card_member_name) if "card_member_name" in enc_fields else t.card_member_name
    merch_name = encryptor.decrypt(t.merchant_name) if "merchant_name" in enc_fields and t.merchant_name else t.merchant_name
    
    return TransactionResponse(
        id=t.id,
        user_id=t.user_id,
        transaction_type=t.transaction_type,
        amount=t.amount,
        currency=t.currency,
        merchant_name=merch_name,
        merchant_category=t.merchant_category,
        merchant_country=t.merchant_country,
        card_member_name=card_name,
        description=t.description,
        status=t.status,
        created_at=t.created_at,
        processed_at=t.processed_at,
    )

@router.get("/", response_model=list[TransactionResponse])
async def list_transactions(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List transactions. Card members see only their own; CSR/Admin see all."""
    query = select(Transaction).order_by(desc(Transaction.created_at))

    if current_user.role == "card_member":
        query = query.where(Transaction.user_id == current_user.id)

    query = query.limit(limit).offset(offset)
    result = await db.execute(query)
    transactions = result.scalars().all()
    
    return [_decrypt_transaction(t) for t in transactions]


@router.get("/{transaction_id}", response_model=TransactionResponse)
async def get_transaction(
    transaction_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific transaction."""
    result = await db.execute(
        select(Transaction).where(Transaction.id == transaction_id)
    )
    transaction = result.scalar_one_or_none()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    if current_user.role == "card_member" and transaction.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    return _decrypt_transaction(transaction)


@router.post("/{transaction_id}/resolve", response_model=dict)
async def resolve_transaction(
    transaction_id: str,
    resolve_data: ResolveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Resolve a transaction pending human review."""
    if current_user.role == "card_member":
        raise HTTPException(status_code=403, detail="Access denied")

    # Get transaction
    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id))
    transaction = result.scalar_one_or_none()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    if transaction.status != "pending_human_review":
        raise HTTPException(status_code=400, detail="Transaction is not pending human review")

    # Get decision
    from app.models.decision import Decision
    decision_result = await db.execute(select(Decision).where(Decision.transaction_id == transaction_id))
    decision = decision_result.scalar_one_or_none()
    if not decision:
        raise HTTPException(status_code=404, detail="Decision not found")

    action = resolve_data.action.lower()
    if action not in ["approve", "deny"]:
        raise HTTPException(status_code=400, detail="Invalid action")

    transaction.status = action
    decision.final_decision = action
    decision.human_override = action
    decision.human_override_reason = resolve_data.reason

    if action == "deny":
        client_ip = (transaction.metadata_json or {}).get("client_ip")
        if client_ip and client_ip not in ["unknown", "127.0.0.1", "localhost"]:
            from app.models.blocklist import IPBlocklist
            import redis.asyncio as redis
            # Add to DB
            block_entry = IPBlocklist(ip_address=client_ip, reason=f"Human rejected transaction {transaction_id}")
            db.add(block_entry)
            # Add to Redis
            try:
                r = redis.from_url(settings.REDIS_URL, decode_responses=True)
                await r.sadd("blocked_ips", client_ip)
            except Exception as e:
                logger.error(f"Failed to cache blocked IP in Redis: {e}")

    # Add audit log
    from app.orchestrator import _log_audit
    await _log_audit(db, transaction.id, "human_resolution", {
        "action": action,
        "reason": resolve_data.reason,
        "user_id": current_user.id
    }, f"Human resolved transaction as {action.upper()}", severity="info")

    await db.commit()
    await db.flush()

    # Broadcast
    await ws_manager.broadcast({
        "type": "human_resolved",
        "data": {
            "transaction_id": transaction.id,
            "decision": action
        }
    })

    return {"status": "success", "decision": action}
