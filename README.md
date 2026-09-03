# TrustVault — Autonomous AI Agent for Real-Time Financial Markets

![TrustVault Dashboard](assets/screenshots/dashboard.png)
![TrustVault Capital](assets/screenshots/capital.png)
![TrustVault Audit Ledger](assets/screenshots/audit_ledger.png)
![TrustVault Watchdog](assets/screenshots/watchdog.png)

A multi-agent system that continuously perceives a live market, reasons about
changing conditions, allocates capital under explicit constraints, executes,
observes what actually happened, and adapts.

The design point is deliberately **not** a price-prediction model. Predicting a
move is the easy half. The system answers the harder question: given expected
return, liquidity, execution cost, volatility, available capital, exposure and
a fixed risk mandate — is acting on this justified, at what size, and does that
answer still hold thirty seconds later?

## The decision loop

Every cycle runs the full sequence. Each stage can veto.

```mermaid
flowchart TD
    Feed["Market Feed<br/>price · spread · depth · volatility"] --> Snapshot
    News["News Feed<br/>headlines scored for sentiment"] --> Snapshot
    Snapshot["Observation<br/>(carries its own age)"] --> Stale{"Fresh<br/>enough?"}
    Stale -->|"no"| Deny["Decline — a stale reading<br/>cannot justify an action"]
    Stale -->|"yes"| Alloc

    Alloc["Capital Allocator<br/>vol-target · fractional Kelly · limit clipping"] --> Sized{"Any size<br/>survives?"}
    Sized -->|"no"| DenyC["Decline — records which<br/>constraint bound"]
    Sized -->|"yes"| Quorum

    subgraph Quorum ["Expert Quorum — six independent votes"]
        direction TB
        Signal["Signal — directional edge"]
        Sentiment["Sentiment — information environment"]
        Volatility["Volatility — downside survivability"]
        Exposure["Exposure — mandate enforcement"]
        Liquidity["Liquidity — execution cost"]
        Correlation["Correlation — concentration risk"]
    end

    Quorum --> Explain["Synthesis<br/>auditable account of the decision"]
    Explain --> Consensus["Weighted Consensus<br/>weights moved by realised outcomes"]

    Consensus -->|"review"| Human["Escalate to human"]
    Consensus -->|"deny"| Record
    Consensus -->|"approve"| Exec["Execution<br/>crosses the book · pays spread, impact, fees"]

    Exec --> Ledger["Double-Entry Ledger<br/>Stitch or local"]
    Ledger --> Position["Open Position<br/>stop · target · thesis · entry votes"]

    Position --> Reassess{"Conditions<br/>changed?"}
    Reassess -->|"stop / target hit"| Mech["Mechanical exit —<br/>not put to a vote"]
    Reassess -->|"moved 1.5σ · data stale ·<br/>adverse news · periodic"| Quorum
    Reassess -->|"no"| Position

    Mech --> Outcome
    Consensus -->|"approve close"| Outcome["Outcome Observed<br/>realised P&L"]
    Outcome --> Adapt["Adaptation<br/>score the agents that voted,<br/>move their weight"]
    Adapt --> Consensus

    Record["Hash-Chained Audit<br/>every step, SHA-256 linked"]
    Exec --> Record
    Outcome --> Record
```

## How each problem requirement is met

| Requirement | Where it lives |
|---|---|
| Continuously process heterogeneous information | [`market/feed.py`](backend/app/market/feed.py) streams price, spread and depth; [`market/news.py`](backend/app/market/news.py) scores headlines and attaches them to observations |
| Evaluate against return, liquidity, cost, volatility, capital, risk | Six experts in [`agents/market/experts.py`](backend/app/agents/market/experts.py), one per dimension, each able to veto |
| Decide dynamically, not by fixed rule | Each expert runs a quantitative pass and hands genuine judgement calls to the LLM; consensus weights move with results |
| Explicit capital, exposure, risk and cost constraints | [`allocator.py`](backend/app/allocator.py) sizes and clips; the exposure agent enforces literally; [`portfolio_service.py`](backend/app/portfolio_service.py) holds the drawdown breaker |
| End-to-end loop including outcome and adaptation | [`autonomous_loop.py`](backend/app/autonomous_loop.py) drives it; [`adaptation.py`](backend/app/adaptation.py) closes it |
| Continuously reassess as conditions change | Positions re-run on a 1.5σ move, stop, target, stale data, adverse news, or periodic review — whichever comes first |
| Distinguish current from outdated information | Every `Observation` carries its own age; past the staleness threshold no agent may act on it |
| Account for execution, not just opportunity | [`execution.py`](backend/app/execution.py) crosses the book at a modelled price and records expected against realised cost per fill |

## Design decisions worth knowing

**A failed agent abstains rather than approving.** Timeouts and errors vote
`review` at low confidence, which pushes a marginal case to escalation instead
of letting silence read as consent.

**Stops and targets bypass the quorum.** The risk envelope is agreed when the
position opens. Re-arguing it at the moment it binds is how a stop-loss stops
protecting anything.

**Mandate enforcement is never down-weighted by P&L.** A risk veto that costs
money is often correct; rewarding the desk for overriding its own limits would
teach exactly the wrong lesson. The exposure agent's weight is fixed.

**NAV is derived from a double-entry ledger, not a mutable number.** Every
movement writes a balanced pair. `/api/portfolio/ledger/trial-balance` reports
whether the books actually balance, and surfaces it rather than adjusting it if
they do not.

**Unmeasurable metrics report as unavailable.** The telemetry deck shows what it
measured and says so when it could not. A dashboard that invents its own uptime
is worse than one that admits ignorance.

## Integrations

**Stitch** — programmable double-entry ledger. When `STITCH_CLIENT_ID`,
`STITCH_CLIENT_SECRET` and `STITCH_LEDGER_ID` are set, every capital movement is
posted to Stitch and mirrored locally. Without them the built-in ledger runs and
the loop is unaffected; the active provider is logged at startup. A failed Stitch
post still writes the local entry, flagged for reconciliation, so the desk's own
books are never incomplete.

**ElevenLabs** — voice out and constraints in. The desk speaks each executed
action and its reasoning, so an operator can follow a loop that runs faster than
anyone reads. Spoken instructions set risk limits or halt the desk. They cannot
order a specific trade: humans define the envelope, the agent decides within it.
Instructions are interpreted and shown before anything changes, then clamped to
validated bounds — a misheard "fifty" for "fifteen" cannot hand the agent more
risk than the range allows.

## Quick start

### 1. Services

```bash
docker-compose up -d
```

### 2. Local model

```bash
ollama pull qwen3:8b
```

The quantitative passes run without a model, but the experts abstain on
judgement calls when no model is reachable — which correctly means the desk will
refuse to commit capital.

### 3. Backend

```bash
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000
```

### 4. Frontend

```bash
cd frontend && npm install && npm run dev
```

Open **http://localhost:5173**. API docs at **http://localhost:8000/docs**.

### Running offline

Set `MARKET_FEED_PROVIDER=replay` for a deterministic generator with realistic
volatility and genuine cross-asset correlation. The data source is simulated;
the agents, allocator, execution model, ledger and adaptation all run for real
against it.

### Demo credentials

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `admin123` |
| CSR Agent | `csr_agent` | `csr123` |
| Card Member | `card_member` | `member123` |
## API

| Endpoint | Purpose |
|---|---|
| `GET /api/market/snapshot` | Current view of every instrument, each with its age |
| `GET /api/market/decisions/{id}` | One decision in full, with its hash-chained audit trail |
| `POST /api/market/loop/cycle` | Run one cycle immediately |
| `POST /api/market/loop/pause` · `/resume` | Suspend or restart decision-making |
| `GET /api/portfolio` | NAV, exposure, drawdown, positions marked to market |
| `GET /api/portfolio/fills` | Expected against realised execution cost, per fill |
| `GET /api/portfolio/ledger/trial-balance` | Account balances and the integrity check |
| `GET /api/portfolio/agents/performance` | Each expert's track record and current weight |
| `PUT /api/portfolio/constraints` | Change the risk envelope |
| `POST /api/portfolio/halt` · `/resume` · `/flatten` | Operator controls |
| `GET /api/telemetry/infrastructure` | Measured service health |
| `GET /api/telemetry/pipeline` | Per-stage throughput and latency |
| `POST /api/voice/constraint` | Interpret a spoken instruction (dry run by default) |
| `GET /api/voice/briefing` | Spoken status summary |

## ⚙️ Configuration

All configuration is in `.env`:

```env
# LLM Provider (Ollama / NVIDIA NIM / OpenAI)
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen3:8b
LLM_API_KEY=ollama

# Database
DATABASE_URL=postgresql+asyncpg://trustvault:trustvault@localhost:5432/trustvault

# Redis
REDIS_URL=redis://localhost:6379/0
```

## Project Structure

```
backend/app/
├── market/              # perception: feed, news, indicators, types
├── agents/market/       # the six experts + synthesis
├── allocator.py         # capital allocation under constraints
├── execution.py         # crossing the book, slippage, fees
├── ledger.py            # double-entry; Stitch adapter + local fallback
├── portfolio_service.py # NAV, exposure, drawdown breaker
├── market_orchestrator.py # one pass of the decision pipeline
├── autonomous_loop.py   # the continuous loop
├── adaptation.py        # outcome → agent weight
├── consensus.py         # weighted voting, shared with governance
├── voice.py             # ElevenLabs narration and spoken constraints
└── routers/             # market, portfolio, voice, telemetry
```

The transaction-governance pipeline (identity, fraud, compliance, policy) remains
in place and shares the same consensus engine, audit chain and watchdog.

## Key Features

- **Real LLM-Powered Agents** — Each expert uses domain-specific prompts with structured output
- **Consensus Decision Engine** — Weighted majority voting with confidence aggregation
- **Governance Layer** — Spend limits, MCC restrictions, geographic blocks
- **AI Watchdog** — Confidence drift detection, disagreement monitoring
- **Immutable Audit Trail** — Full decision trace in PostgreSQL
- **WebSocket Live Feed** — Real-time transaction processing updates
- **Role-Based Access** — Card Member / CSR / Admin with JWT auth
- **Provider-Agnostic LLM** — Swap between Ollama, NVIDIA NIM, OpenAI via `.env`

## References

- [1] Wu et al., "Council Mode," arXiv, 2026
- [2] Li et al., "MARCH," ACL, 2026
- [3] Jamshidi, "Collective Hallucination in Multi-Agent LLMs," arXiv, 2026
- [4] Bai et al., "Hallucination Survey," arXiv, 2024

