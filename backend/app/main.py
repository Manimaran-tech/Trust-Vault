"""
TrustVault — Multi-Agent Governance Platform
FastAPI Application Entry Point
"""
import logging
import json
import asyncio
import time
from pathlib import Path
from collections import defaultdict
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Response, Depends
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.config import get_settings
from app.database import create_tables, async_session_factory, get_db
from app.auth.router import router as auth_router
from app.auth import decode_access_token
from app.routers import (
    transactions_router,
    decisions_router,
    audit_router,
    watchdog_router,
    dashboard_router,
    market_router,
    portfolio_router,
    voice_router,
    telemetry_router,
)
from app.ws_manager import ws_manager
from app.data.seed_users import seed_demo_users

settings = get_settings()

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s | %(name)-25s | %(levelname)-7s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("trustvault")


# --- IP Blocklist Middleware ---
class IPBlocklistMiddleware(BaseHTTPMiddleware):
    """Checks incoming requests against the cached IP blocklist in Redis."""
    
    async def dispatch(self, request: Request, call_next):
        client_ip = request.client.host if request.client else "unknown"
        if client_ip != "unknown" and client_ip not in ["127.0.0.1", "localhost", "::1"]:
            try:
                import redis
                from app.config import get_settings
                settings = get_settings()
                r = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
                if r.sismember("blocked_ips", client_ip):
                    return Response(
                        content=json.dumps({"detail": "Access Denied. Your IP address has been blocked due to suspicious activity."}),
                        status_code=403,
                        media_type="application/json",
                    )
            except Exception as e:
                logger.error(f"Redis check failed in IPBlocklistMiddleware: {e}")
                
        return await call_next(request)


# --- Rate Limiting Middleware ---
class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple sliding-window rate limiter per IP address."""

    def __init__(self, app, general_limit: int = 100, auth_limit: int = 10, window: int = 60):
        super().__init__(app)
        self.general_limit = general_limit
        self.auth_limit = auth_limit
        self.window = window
        self._requests: dict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next):
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        path = request.url.path

        # Determine the limit for this request
        is_auth = path.startswith("/api/auth/")
        limit = self.auth_limit if is_auth else self.general_limit

        # Clean old entries and check
        key = f"{client_ip}:{('auth' if is_auth else 'general')}"
        self._requests[key] = [t for t in self._requests[key] if now - t < self.window]

        if len(self._requests[key]) >= limit:
            return Response(
                content=json.dumps({"detail": "Rate limit exceeded. Try again later."}),
                status_code=429,
                media_type="application/json",
                headers={"Retry-After": str(self.window)},
            )

        self._requests[key].append(now)
        response = await call_next(request)
        return response


from app.migrations import run_migrations

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan — startup and shutdown events."""
    logger.info("=" * 60)
    logger.info("  TrustVault — Multi-Agent Governance Platform")
    logger.info("=" * 60)

    # Create database tables
    logger.info("Creating database tables...")
    try:
        await create_tables()
        logger.info("✅ Database tables created")
    except Exception as e:
        logger.error(f"❌ Database connection failed: {e}")
        logger.info("Make sure PostgreSQL is running: docker-compose up -d")

    # Schema and data migrations. `create_all` adds tables but never alters
    # one, so columns added later have to be applied explicitly or they surface
    # as a `no such column` failure mid-request.
    try:
        async with async_session_factory() as session:
            result = await run_migrations(session)
        if result["applied"]:
            logger.info(f"[OK] Migrations applied: {result['applied']}")
        else:
            logger.info("[OK] Schema up to date")
    except Exception as e:
        logger.warning(f"[WARN] Migrations failed: {e}")

    # Seed users (passwords from environment)
    try:
        async with async_session_factory() as session:
            await seed_demo_users(session)
            logger.info("✅ Seed users checked")
    except Exception as e:
        logger.warning(f"⚠️ Could not seed users: {e}")

    # Check LLM health
    try:
        from app.llm.client import check_llm_health
        llm_ok = await check_llm_health()
        if llm_ok:
            logger.info(f"✅ LLM connected ({settings.LLM_MODEL} at {settings.LLM_BASE_URL})")
        else:
            logger.warning(f"⚠️ LLM not reachable at {settings.LLM_BASE_URL}")
            logger.info("  Make sure Ollama is running: ollama serve")
            logger.info(f"  And model is pulled: ollama pull {settings.LLM_MODEL}")
    except Exception as e:
        logger.warning(f"⚠️ LLM health check failed: {e}")

    # Baseline agent performance records, so the adaptation layer has something
    # to move from on the very first closed position.
    try:
        from app.adaptation import ensure_performance_records
        async with async_session_factory() as session:
            await ensure_performance_records(session)
            await session.commit()
        logger.info("[OK] Agent performance baselines ready")
    except Exception as e:
        logger.warning(f"[WARN] Could not initialise agent baselines: {e}")

    # Voice: report configuration state plainly rather than failing silently later.
    try:
        from app.voice import status as voice_status
        vs = voice_status()
        if vs["configured"]:
            logger.info(f"[OK] ElevenLabs voice ready (model {vs['model_id']})")
        else:
            logger.info(f"[--] Voice narration disabled: {vs['reason']}")
    except Exception as e:
        logger.warning(f"[WARN] Voice status check failed: {e}")

    # Ledger provider — Stitch when credentials are present, local otherwise.
    try:
        from app.ledger import ledger
        from app.payments import payment_gateway
        logger.info(f"[OK] Ledger provider: {ledger.name}")
        rail = payment_gateway.status()
        logger.info(
            f"[OK] Payment rail: {rail['provider']} "
            f"({'PAPER - no funds move' if rail['is_paper'] else 'LIVE'})"
        )
    except Exception as e:
        logger.warning(f"[WARN] Ledger unavailable: {e}")

    # Market perception. The feed runs regardless of the decision loop, so the
    # dashboard shows live data even when trading is paused.
    try:
        from app.market.feed import market_feed
        from app.market.news import news_feed
        await market_feed.start()
        await news_feed.start()
        logger.info(
            f"[OK] Market feed started "
            f"({market_feed.provider}: {', '.join(market_feed.symbols)})"
        )
    except Exception as e:
        logger.error(f"[FAIL] Market feed failed to start: {e}")

    # The autonomous decision loop.
    if settings.AUTONOMOUS_LOOP_ENABLED:
        try:
            from app.autonomous_loop import autonomous_loop
            await autonomous_loop.start()
            logger.info(
                f"[OK] Autonomous decision loop running every "
                f"{settings.DECISION_INTERVAL_SECONDS}s"
            )
        except Exception as e:
            logger.error(f"[FAIL] Autonomous loop failed to start: {e}")
    else:
        logger.info("[--] Autonomous loop disabled (AUTONOMOUS_LOOP_ENABLED=false)")

    logger.info("=" * 60)
    logger.info("  Server ready! API docs: http://localhost:8000/docs")
    logger.info("=" * 60)

    yield

    # Shutdown — stop the loop before the feed so no cycle runs against a
    # feed that is already tearing down.
    logger.info("TrustVault shutting down...")
    try:
        from app.autonomous_loop import autonomous_loop
        from app.market.feed import market_feed
        from app.market.news import news_feed
        await autonomous_loop.stop()
        await news_feed.stop()
        await market_feed.stop()
    except Exception as e:
        logger.warning(f"Shutdown cleanup incomplete: {e}")


# Create FastAPI app
app = FastAPI(
    title="TrustVault API",
    description="Multi-Agent Governance Platform for Financial Services",
    version="1.0.0",
    lifespan=lifespan,
)

# IP Blocklist (Applied before Rate Limiting, so it runs first on incoming requests)
app.add_middleware(IPBlocklistMiddleware)

# Rate Limiting
app.add_middleware(
    RateLimitMiddleware,
    general_limit=settings.RATE_LIMIT_GENERAL,
    auth_limit=settings.RATE_LIMIT_AUTH,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth_router)
app.include_router(transactions_router)
app.include_router(decisions_router)
app.include_router(audit_router)
app.include_router(watchdog_router)
app.include_router(dashboard_router)
app.include_router(market_router)
app.include_router(portfolio_router)
app.include_router(voice_router)
app.include_router(telemetry_router)


# WebSocket endpoint with authentication
WS_AUTH_TIMEOUT = 5  # seconds to wait for auth message


@app.websocket("/ws/transactions")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket with token-based authentication.
    Client must send {"type": "auth", "token": "<JWT>"} as the first message.
    """
    await websocket.accept()

    # Wait for auth message
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=WS_AUTH_TIMEOUT)
        auth_msg = json.loads(raw)

        if auth_msg.get("type") != "auth" or not auth_msg.get("token"):
            await websocket.send_json({"type": "error", "message": "First message must be {\"type\": \"auth\", \"token\": \"...\"}"})
            await websocket.close(code=4001, reason="Authentication required")
            return

        payload = decode_access_token(auth_msg["token"])
        if payload is None:
            await websocket.send_json({"type": "error", "message": "Invalid or expired token"})
            await websocket.close(code=4001, reason="Invalid token")
            return

        # Authentication successful
        await websocket.send_json({"type": "auth_ok", "user_id": payload.get("sub")})

    except asyncio.TimeoutError:
        await websocket.close(code=4001, reason="Authentication timeout")
        return
    except (json.JSONDecodeError, Exception) as e:
        try:
            await websocket.close(code=4001, reason="Authentication failed")
        except Exception:
            pass
        return

    # Authenticated — add to connection manager
    ws_manager.active_connections.append(websocket)
    logger.info(f"WebSocket authenticated. Total: {len(ws_manager.active_connections)}")

    try:
        while True:
            # Keep connection alive, receive heartbeats
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)


# Health check
@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": "TrustVault", "version": "1.0.0"}


# Agent health — reports GNN mode (real PyTorch vs mock fallback)
@app.get("/api/health/agents")
async def agent_health():
    """Return status of each AI agent, including GNN mode."""
    from app.agents.graph_risk_agent import TORCH_AVAILABLE
    from app.market_orchestrator import MARKET_EXPERTS, explainability_agent
    from app.voice import status as voice_status

    market_agents = [
        {
            "name": a.name,
            "quorum": "market",
            "status": "active",
            "mode": "quantitative+llm",
            "base_weight": a.weight,
        }
        for a in MARKET_EXPERTS
    ]
    market_agents.append(
        {
            "name": explainability_agent.name,
            "quorum": "market",
            "status": "active",
            "mode": "llm",
            "base_weight": explainability_agent.weight,
        }
    )

    governance_agents = [
        {"name": n, "quorum": "governance", "status": "active", "mode": "rule+llm"}
        for n in ("identity", "fraud", "risk", "compliance", "policy")
    ]
    governance_agents.append(
        {
            "name": "graph_risk",
            "quorum": "governance",
            # This agent abstains unless trained weights are actually loaded,
            # so its reported status reflects what it can really do.
            "status": "active" if TORCH_AVAILABLE else "abstaining",
            "mode": "gnn_pytorch" if TORCH_AVAILABLE else "unavailable",
            "torch_available": TORCH_AVAILABLE,
        }
    )
    governance_agents.append(
        {"name": "explainability", "quorum": "governance", "status": "active", "mode": "llm"}
    )

    return {
        "agents": market_agents + governance_agents,
        "llm": {"model": settings.LLM_MODEL, "base_url": settings.LLM_BASE_URL},
        "voice": voice_status(),
    }


# IP Blocklist API
@app.get("/api/blocklist")
async def list_blocked_ips(
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """List all blocked IPs for easy retrieval."""
    from app.models.blocklist import IPBlocklist
    result = await db.execute(
        select(IPBlocklist).order_by(IPBlocklist.created_at.desc()).limit(limit)
    )
    blocked = result.scalars().all()
    return [
        {
            "id": b.id,
            "ip_address": b.ip_address,
            "reason": b.reason,
            "created_at": b.created_at.isoformat() if b.created_at else None,
        }
        for b in blocked
    ]


@app.get("/api/blocklist/check/{ip_address}")
async def check_ip_blocked(
    ip_address: str,
    db: AsyncSession = Depends(get_db),
):
    """Check if a specific IP is blocked."""
    from app.models.blocklist import IPBlocklist
    result = await db.execute(
        select(IPBlocklist).where(IPBlocklist.ip_address == ip_address)
    )
    entry = result.scalar_one_or_none()
    return {
        "ip_address": ip_address,
        "blocked": entry is not None,
        "reason": entry.reason if entry else None,
        "blocked_at": entry.created_at.isoformat() if entry and entry.created_at else None,
    }


# Sample scenarios endpoint (requires auth)
@app.get("/api/scenarios")
async def get_scenarios():
    """Return the pre-built test scenarios."""
    scenarios_path = Path(__file__).parent / "data" / "sample_scenarios.json"
    with open(scenarios_path, "r") as f:
        return json.load(f)

