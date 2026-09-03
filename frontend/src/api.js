const API_BASE = 'http://localhost:8000';

// Demo credentials used to recover an expired session without bouncing the
// operator to a login screen mid-session.
const DEMO_USER = 'admin';
const DEMO_PASS = 'Admin@TrustVault2026!';

function getHeaders() {
  const token = localStorage.getItem('trustvault_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// A single in-flight re-authentication shared by every caller. Without this,
// a dozen panels hitting 401 at the same moment would each start their own
// login and race to write the token.
let reauthPromise = null;

async function reauthenticate() {
  if (reauthPromise) return reauthPromise;

  reauthPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: DEMO_USER, password: DEMO_PASS }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      localStorage.setItem('trustvault_token', data.access_token);
      localStorage.setItem('trustvault_user', JSON.stringify(data.user));
      // Let the WebSocket provider reconnect with the new token.
      window.dispatchEvent(new CustomEvent('trustvault:reauthenticated'));
      return data.access_token;
    } catch {
      return null;
    } finally {
      // Cleared on the next tick so callers awaiting this promise all see it.
      setTimeout(() => { reauthPromise = null; }, 0);
    }
  })();
  return reauthPromise;
}

export async function ensureAuth() {
  let token = localStorage.getItem('trustvault_token');
  if (!token) {
    token = await reauthenticate();
  }
  return token;
}

async function handleResponse(response) {
  if (response.ok) return response.json();

  const error = await response.json().catch(() => ({ detail: 'Request failed' }));
  const err = new Error(error.detail || `HTTP ${response.status}`);
  err.status = response.status;
  throw err;
}

/**
 * Perform a request, recovering once from an expired session.
 *
 * Only 401 is retried, and only once: a second failure means the credentials
 * are genuinely wrong rather than merely stale, and looping would hide that.
 */
async function request(path, init = {}, { retry = true } = {}) {
  const doFetch = () =>
    fetch(`${API_BASE}${path}`, { ...init, headers: { ...getHeaders(), ...(init.headers || {}) } });

  let response = await doFetch();

  if (response.status === 401 && retry) {
    const token = await reauthenticate();
    if (token) response = await doFetch();
  }

  return handleResponse(response);
}

/** Same recovery, for endpoints returning binary rather than JSON. */
async function requestBlob(path, init = {}) {
  const doFetch = () =>
    fetch(`${API_BASE}${path}`, { ...init, headers: { ...getHeaders(), ...(init.headers || {}) } });

  let response = await doFetch();
  if (response.status === 401) {
    const token = await reauthenticate();
    if (token) response = await doFetch();
  }
  if (!response.ok) return null;
  return URL.createObjectURL(await response.blob());
}

export const api = {
  // Auth
  ensureAuth,
  login: (username, password) =>
    fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).then(handleResponse),

  register: (data) =>
    fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(handleResponse),

  getMe: () =>
    request(`/api/auth/me`),

  // Transactions
  submitTransaction: (data) =>
    request(`/api/transactions/`, { method: 'POST', body: JSON.stringify(data) }),

  getTransactions: (limit = 50) =>
    request(`/api/transactions/?limit=${limit}`),

  getTransaction: (id) =>
    request(`/api/transactions/${id}`),

  resolveTransaction: (id, action, reason = '') =>
    request(`/api/transactions/${id}/resolve`, { method: 'POST', body: JSON.stringify({ action, reason }) }),

  // Decisions
  getDecisions: (limit = 50) =>
    request(`/api/decisions/?limit=${limit}`),

  getDecisionDetail: (id) =>
    request(`/api/decisions/${id}`),

  overrideDecision: (id, decision, reason) =>
    request(
      `/api/decisions/${id}/override?override_decision=${decision}&reason=${encodeURIComponent(reason)}`,
      { method: 'POST' }
    ),

  // Dashboard
  getDashboardMetrics: () =>
    request(`/api/dashboard/metrics`),

  // Audit
  getAuditLogs: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/api/audit/?${query}`);
  },

  getAuditTrail: (transactionId) =>
    request(`/api/audit/${transactionId}/trail`),

  // Watchdog
  getWatchdogAlerts: () =>
    request(`/api/watchdog/alerts`),

  getWatchdogHealth: () =>
    request(`/api/watchdog/health`),

  // Scenarios
  getScenarios: () =>
    request(`/api/scenarios`),

  // Health
  healthCheck: () =>
    fetch(`${API_BASE}/api/health`).then(handleResponse),

  // Agent Health (GNN status)
  getAgentHealth: () =>
    fetch(`${API_BASE}/api/health/agents`).then(handleResponse),

  // IP Blocklist
  getBlockedIPs: (limit = 50) =>
    fetch(`${API_BASE}/api/blocklist?limit=${limit}`).then(handleResponse),

  checkIPBlocked: (ip) =>
    fetch(`${API_BASE}/api/blocklist/check/${ip}`).then(handleResponse),

  // ---- Market perception ----
  getMarketSnapshot: () =>
    request(`/api/market/snapshot`),

  getCandles: (symbol, interval = 'FIVE_MINUTE', days = 5) =>
    request(`/api/market/candles/${symbol}?interval=${interval}&days=${days}`),

  getFeedStatus: () =>
    request(`/api/market/feed/status`),

  getMarketNews: () =>
    request(`/api/market/news`),

  // Everything the console needs in one request. The dashboard polls
  // continuously, so this exists to keep that within the rate limit.
  getOverview: (limit = 30) =>
    request(`/api/market/overview?decision_limit=${limit}`),

  // ---- Decision loop ----
  getLoopStatus: () =>
    request(`/api/market/loop/status`),

  runCycle: () =>
    request(`/api/market/loop/cycle`, { method: 'POST' }),

  startReplay: () =>
    request(`/api/market/replay/start`, { method: 'POST' }),

  pauseLoop: () =>
    request(`/api/market/loop/pause`, { method: 'POST' }),

  resumeLoop: () =>
    request(`/api/market/loop/resume`, { method: 'POST' }),

  getMarketDecisions: (limit = 50) =>
    request(`/api/market/decisions?limit=${limit}`),

  getMarketDecision: (id) =>
    request(`/api/market/decisions/${id}`),

  overrideMarketDecision: (id, override, reason) =>
    request(`/api/market/decisions/${id}/override?override=${override}&reason=${encodeURIComponent(reason)}`, { method: 'POST' }),

  // ---- Capital ----
  getPortfolio: () =>
    request(`/api/portfolio`),

  getPositions: (status = 'open') =>
    request(`/api/portfolio/positions?status=${status}`),

  getFills: (limit = 100) =>
    request(`/api/portfolio/fills?limit=${limit}`),

  getLedger: (limit = 100) =>
    request(`/api/portfolio/ledger?limit=${limit}`),

  getTrialBalance: () =>
    request(`/api/portfolio/ledger/trial-balance`),

  // Exercises the settlement credential against the provider rather than
  // reading configuration back, so a green rail badge means an authenticated
  // round trip actually succeeded.
  verifySettlementRail: () =>
    request(`/api/portfolio/ledger/rail`),

  getConstraints: () =>
    request(`/api/portfolio/constraints`),

  updateConstraints: (updates) =>
    request(`/api/portfolio/constraints`, { method: 'PUT', body: JSON.stringify(updates) }),

  haltDesk: (reason) =>
    request(`/api/portfolio/halt?reason=${encodeURIComponent(reason)}`, { method: 'POST' }),

  resumeDesk: () =>
    request(`/api/portfolio/resume`, { method: 'POST' }),

  flattenPositions: (reason) =>
    request(`/api/portfolio/flatten?reason=${encodeURIComponent(reason)}`, { method: 'POST' }),

  // ---- Manual trade entry ----
  getInstruments: () =>
    request(`/api/portfolio/instruments`),

  openPositionManually: (symbol, side, notional) =>
    request(
      `/api/portfolio/positions/open?symbol=${encodeURIComponent(symbol)}&side=${side}` +
        (notional ? `&notional=${notional}` : ''),
      { method: 'POST' }
    ),

  closePositionManually: (positionId) =>
    request(`/api/portfolio/positions/${positionId}/close`, { method: 'POST' }),

  getAgentPerformance: () =>
    request(`/api/portfolio/agents/performance`),

  // ---- Telemetry (measured, not asserted) ----
  getInfrastructureTelemetry: () =>
    request(`/api/telemetry/infrastructure`),

  getPipelineTelemetry: () =>
    request(`/api/telemetry/pipeline`),

  // ---- Voice ----
  getVoiceStatus: () =>
    request(`/api/voice/status`),

  getBriefing: () =>
    request(`/api/voice/briefing`),

  // ---- Synthetic voice fraud range ----
  getFraudRangeStatus: () =>
    request(`/api/voice/fraud/status`),

  getFraudScenarios: () =>
    request(`/api/voice/fraud/scenarios`),

  getFraudProvenance: () =>
    request(`/api/voice/fraud/provenance`),

  // Generates the attack and screens it in one pass. `deep` adds the model's
  // judgement, which is slower and therefore opt-in.
  runFraudScenario: (scenarioId, deep = false) =>
    request(`/api/voice/fraud/run/${scenarioId}?deep=${deep ? 'true' : 'false'}`, {
      method: 'POST',
    }),

  // The generated clip, as an object URL for an <audio> element.
  fetchFraudClip: (scenarioId) =>
    requestBlob(`/api/voice/fraud/generate/${scenarioId}`, { method: 'POST' }),

  screenFraudTranscript: (transcript, deep = true) =>
    request(
      `/api/voice/fraud/screen?transcript=${encodeURIComponent(transcript)}` +
        `&deep=${deep ? 'true' : 'false'}`,
      { method: 'POST' }
    ),

  screenFraudAudio: async (blob, deep = true) => {
    const form = new FormData();
    form.append('file', blob, 'call.webm');
    const token = localStorage.getItem('trustvault_token');
    const res = await fetch(
      `${API_BASE}/api/voice/fraud/screen?deep=${deep ? 'true' : 'false'}`,
      {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      }
    );
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.detail || `Screening failed (${res.status})`);
    }
    return res.json();
  },

  // Returns an object URL for an <audio> element, or null when voice is unconfigured.
  fetchNarrationAudio: (decisionId) =>
    requestBlob(`/api/voice/narration/${decisionId}`),

  speak: (text) =>
    requestBlob(`/api/voice/speak`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  transcribe: async (blob) => {
    const form = new FormData();
    form.append('file', blob, 'speech.webm');
    // FormData sets its own multipart boundary, so the JSON content-type
    // header that `request` adds must not be applied here.
    const send = () => {
      const token = localStorage.getItem('trustvault_token');
      return fetch(`${API_BASE}/api/voice/transcribe`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
    };
    let res = await send();
    if (res.status === 401 && (await reauthenticate())) res = await send();
    return handleResponse(res);
  },

  applySpokenConstraint: (transcript, confirm = false) =>
    request(`/api/voice/constraint?confirm=${confirm}`, { method: 'POST', body: JSON.stringify({ transcript }) }),
};

export const WS_URL = 'ws://localhost:8000/ws/transactions';
