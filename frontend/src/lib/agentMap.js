/**
 * Mapping between the office personas the interface is built around and the
 * market expert agents the backend actually runs.
 *
 * The personas are the product's visual identity and stay exactly as they are.
 * What changed is the domain each one owns: the same desk now argues about
 * market positions rather than card transactions.
 */

export const PERSONA_TO_AGENT = {
  overseer: 'explainability',
  jim: 'volatility',
  dwight: 'signal',
  pam: 'exposure',
  kevin: 'liquidity',
  alex: 'sentiment',
  oscar: 'correlation',
};

export const AGENT_TO_PERSONA = Object.fromEntries(
  Object.entries(PERSONA_TO_AGENT).map(([persona, agent]) => [agent, persona])
);

/** Short label shown on a persona card while its agent is working. */
export const AGENT_WORK_TASKS = {
  overseer: 'SYNTHESIS',
  jim: 'VOL MODEL',
  dwight: 'SIGNAL SCAN',
  pam: 'MANDATE',
  kevin: 'EXEC COST',
  alex: 'NEWS DESK',
  oscar: 'CORRELATION',
};

/** What each expert is responsible for, in one line. */
export const AGENT_DOMAINS = {
  explainability: 'Consensus synthesis and the audit record',
  volatility: 'Realised volatility and drawdown survivability',
  signal: 'Directional edge from price action',
  exposure: 'Capital limits and mandate enforcement',
  liquidity: 'Spread, depth and execution cost',
  sentiment: 'News and the information environment',
  correlation: 'Cross-asset concentration risk',
};

export const DECISION_COLORS = {
  approve: '#0D7C66',
  deny: '#DC2626',
  review: '#D97706',
  pending_human_review: '#D97706',
};

export function decisionColor(decision) {
  return DECISION_COLORS[decision] || '#64748B';
}

/**
 * Collapse a stream of WebSocket events into the latest state per agent.
 *
 * Returns { [agentName]: { status, decision, confidence, mode, symbol } }.
 * An agent with no event yet is simply absent — callers render it as idle
 * rather than inventing a figure for it.
 */
export function agentStateFromEvents(events, { quorum = 'market', maxAgeMs = 120000 } = {}) {
  const state = {};
  const now = Date.now();

  // Events arrive newest-first; walk oldest-first so later events win.
  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i];
    if (evt.receivedAt && now - evt.receivedAt > maxAgeMs) continue;
    const d = evt.data || {};
    if (!d.agent) continue;

    // Both quorums broadcast the same event names. Without this filter the
    // transaction pipeline's agents populate the market roster, which then
    // reports agents as reporting while every card renders idle.
    if (quorum && d.quorum && d.quorum !== quorum) continue;

    if (evt.type === 'expert_started') {
      state[d.agent] = { ...(state[d.agent] || {}), status: 'working', symbol: d.symbol };
    } else if (evt.type === 'expert_finished') {
      state[d.agent] = {
        status: 'done',
        decision: d.decision,
        confidence: typeof d.confidence === 'number' ? d.confidence : null,
        mode: d.mode,
        symbol: d.symbol,
      };
    }
  }
  return state;
}

/**
 * The desk's book currency, and the units its figures are read in.
 *
 * The desk trades NSE equities, which quote in rupees. Rendering those with a
 * dollar sign is not a cosmetic slip — it misstates every number on the page
 * by roughly a factor of ninety. Indian figures are also grouped in lakh and
 * crore rather than thousands and millions, so a ₹2,20,00,000 wire reads as
 * "2.20 Cr" to the people who would actually approve it, not "22.0M".
 */
export const CURRENCY_SYMBOL = { INR: '₹', USD: '$', EUR: '€', ZAR: 'R' };

export function currencySymbol(code) {
  return CURRENCY_SYMBOL[(code || 'INR').toUpperCase()] || `${code} `;
}

/**
 * A compact money figure: ₹2.20 Cr, ₹48.00 L, ₹9,450.
 *
 * Indian units are used for INR and Western ones otherwise, because the
 * grouping is a property of the currency's readers, not of the code.
 */
export function formatMoney(value, digits = 0, currency = 'INR') {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const symbol = currencySymbol(currency);
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if ((currency || 'INR').toUpperCase() === 'INR') {
    if (abs >= 1e7) return `${sign}${symbol}${(abs / 1e7).toFixed(2)} Cr`;
    if (abs >= 1e5) return `${sign}${symbol}${(abs / 1e5).toFixed(2)} L`;
    return `${sign}${symbol}${abs.toLocaleString('en-IN', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })}`;
  }

  if (abs >= 1e9) return `${sign}${symbol}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${symbol}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${symbol}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${symbol}${abs.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/**
 * A price, in full.
 *
 * Prices are never abbreviated: RELIANCE at ₹1,412.30 must not render as
 * "₹1.4K" on a screen someone is about to size a position from.
 */
export function formatPrice(value, currency = 'INR', digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const locale = (currency || 'INR').toUpperCase() === 'INR' ? 'en-IN' : undefined;
  return `${currencySymbol(currency)}${Number(value).toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** A share/lot count. Quantities are not money and take no symbol. */
export function formatQty(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  return Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: abs >= 100 ? 0 : digits,
  });
}

export function formatPct(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatSigned(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}
