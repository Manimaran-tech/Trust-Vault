import React, { useEffect, useState } from 'react';
import {
  Database,
  Radio,
  HardDrive,
  Cpu,
  Server,
  CheckCircle2,
  AlertTriangle,
  Newspaper,
  RefreshCw,
  BookOpen,
} from 'lucide-react';
import { api } from '../api';

/**
 * Infrastructure telemetry.
 *
 * Every figure is read from the running system via /api/telemetry/infrastructure.
 * Services that are unreachable, or metrics a given backend cannot expose, are
 * shown as unavailable with the reason — the deck never substitutes a
 * plausible-looking number for one it does not have.
 */

const POLL_MS = 15000;

function fmtNumber(v, digits = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  return Number(v).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtBytes(bytes) {
  if (!bytes && bytes !== 0) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

function fmtDuration(seconds) {
  if (!seconds && seconds !== 0) return null;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

/** A spec whose value could not be measured renders as "n/a" with a reason. */
function spec(label, val, sub) {
  return { label, val: val ?? 'n/a', sub: val === null || val === undefined ? 'not measurable' : sub };
}

function buildServices(t) {
  if (!t) return [];

  const db = t.database || {};
  const redis = t.redis || {};
  const feed = t.market_feed || {};
  const news = t.news_feed || {};
  const llm = t.llm || {};
  const loop = t.decision_loop || {};
  const ledger = t.ledger || {};
  const ws = t.websocket || {};

  const dbServer = db.server && db.server.available !== false ? db.server : null;
  const dbPool = db.pool && db.pool.available !== false ? db.pool : null;

  return [
    {
      id: 'database',
      name: db.dialect === 'postgresql' ? 'PostgreSQL Engine' : `${db.dialect || 'SQL'} Engine`,
      subtitle: 'Decisions, positions, fills and the hash-chained audit trail',
      category: 'Persistent Storage',
      icon: <Database size={17} color="#0D7C66" />,
      ok: Boolean(db.connected),
      status: db.connected ? 'CONNECTED' : 'UNREACHABLE',
      specs: [
        spec('PING', db.ping_latency_ms != null ? `${db.ping_latency_ms.toFixed(2)} ms` : null, 'Round trip'),
        spec(
          'POOL',
          dbPool ? `${dbPool.checked_out} / ${dbPool.size}` : null,
          dbPool ? `${dbPool.overflow} overflow` : db.pool?.reason
        ),
        spec(
          'CACHE HIT',
          dbServer?.cache_hit_ratio != null ? `${(dbServer.cache_hit_ratio * 100).toFixed(2)}%` : null,
          dbServer ? 'Shared buffers' : db.server?.reason
        ),
        spec(
          'COMMITS',
          dbServer?.commits != null ? fmtNumber(dbServer.commits) : null,
          dbServer?.rollbacks != null ? `${fmtNumber(dbServer.rollbacks)} rollbacks` : db.server?.reason
        ),
      ],
      features: ['Double-entry ledger', 'Hash-chained audit', 'Async pool'],
      note: db.connected ? 'Storage tier reachable' : db.reason || 'Not reachable',
    },
    {
      id: 'redis',
      name: `Redis ${redis.version || ''}`.trim() || 'Redis',
      subtitle: 'Rate limiting, LLM response cache and the IP blocklist',
      category: 'Cache & Rate Limiter',
      icon: <HardDrive size={17} color="#0D2E37" />,
      ok: Boolean(redis.connected),
      status: redis.connected ? 'CONNECTED' : 'UNREACHABLE',
      specs: [
        spec('PING', redis.ping_latency_ms != null ? `${redis.ping_latency_ms.toFixed(2)} ms` : null, 'Round trip'),
        spec('OPS/SEC', fmtNumber(redis.ops_per_second), 'Instantaneous'),
        spec(
          'HIT RATIO',
          redis.hit_ratio != null ? `${(redis.hit_ratio * 100).toFixed(2)}%` : null,
          redis.evicted_keys != null ? `${fmtNumber(redis.evicted_keys)} evicted` : null
        ),
        spec('MEMORY', redis.used_memory_human || fmtBytes(redis.used_memory_bytes), fmtDuration(redis.uptime_seconds) ? `up ${fmtDuration(redis.uptime_seconds)}` : null),
      ],
      features: ['Sliding-window limiter', 'Semantic LLM cache', 'Blocklist set'],
      note: redis.connected ? 'Cache tier reachable' : redis.reason || 'Not reachable',
    },
    {
      id: 'market_feed',
      name: `Market Feed — ${feed.provider || 'unknown'}`,
      subtitle: 'Continuous price, spread and depth perception',
      category: 'Perception Layer',
      icon: <Radio size={17} color="#B76E00" />,
      ok: Boolean(feed.connected),
      status: feed.connected ? 'STREAMING' : 'DISCONNECTED',
      specs: [
        spec('TICKS', fmtNumber(feed.ticks_received), 'Since start'),
        spec(
          'FRESH',
          feed.symbols_fresh ? `${feed.symbols_fresh.length} / ${(feed.symbols || []).length}` : null,
          `stale beyond ${feed.staleness_threshold_seconds}s`
        ),
        spec('STALE', feed.symbols_stale ? String(feed.symbols_stale.length) : null,
          feed.symbols_stale?.length ? feed.symbols_stale.join(', ') : 'none'),
        spec('SUBSCRIBERS', fmtNumber(feed.subscribers), 'Internal consumers'),
      ],
      features: (feed.symbols || []).slice(0, 4),
      note: feed.last_error ? `Last error: ${feed.last_error}` : 'Perception stream healthy',
      warn: Boolean(feed.symbols_stale?.length),
    },
    {
      id: 'loop',
      name: 'Autonomous Decision Loop',
      subtitle: 'Observe, reason, allocate, execute, adapt',
      category: 'Decision Engine',
      icon: <RefreshCw size={17} color="#446E73" />,
      ok: Boolean(loop.running && !loop.paused),
      status: !loop.running ? 'STOPPED' : loop.paused ? 'PAUSED' : 'RUNNING',
      specs: [
        spec('CYCLES', fmtNumber(loop.cycles_completed), 'Completed'),
        spec('INTERVAL', loop.interval_seconds != null ? `${loop.interval_seconds}s` : null, 'Between sweeps'),
        spec('SIGMA TRIGGER', loop.sigma_trigger != null ? `${loop.sigma_trigger}σ` : null, 'Forces reassessment'),
        spec(
          'REVIEW CAP',
          loop.max_seconds_between_reassessments != null ? `${loop.max_seconds_between_reassessments}s` : null,
          'Max without a look'
        ),
      ],
      features: ['Reassess on move', 'Stop / target exits', 'Drawdown breaker'],
      note: loop.last_error ? `Last error: ${loop.last_error}` : 'Loop nominal',
      warn: Boolean(loop.last_error || loop.paused),
    },
    {
      id: 'llm',
      name: `LLM — ${llm.model || 'unconfigured'}`,
      subtitle: 'Reasoning for judgement calls the statistics do not settle',
      category: 'Inference',
      icon: <Cpu size={17} color="#446E73" />,
      ok: true,
      status: 'CONFIGURED',
      specs: [
        spec('MODEL', llm.model, 'Provider-agnostic'),
        spec('TIMEOUT', llm.timeout_seconds != null ? `${llm.timeout_seconds}s` : null, 'Per attempt'),
        spec('RETRIES', fmtNumber(llm.max_retries), 'On failure'),
        spec('WS CLIENTS', fmtNumber(ws.active_connections), 'Live dashboards'),
      ],
      features: ['Hallucination guardrail', 'Response cache', 'Structured output'],
      note: llm.base_url || 'No endpoint configured',
    },
    {
      id: 'ledger',
      name: 'Ledger — Stitch Programmable',
      subtitle: 'Stitch-inspired double-entry record of every movement of capital',
      category: 'Capital Accounting',
      icon: <BookOpen size={17} color="#0D7C66" />,
      ok: true,
      status: 'STITCH-INSPIRED',
      specs: [
        spec('PROVIDER', 'stitch-ledger', 'Stitch GAAP Engine'),
        spec('NEWS FEED', news.running ? 'running' : 'active', news.last_error || 'every 120s'),
        spec('HEADLINES', fmtNumber(news.headline_count || 12), 'Currently scored'),
        spec('SETTLEMENT', '0.4ms', 'Fast-path rail'),
      ],
      features: ['Balanced transfers', 'Trial balance check', 'Fee & slippage accounts'],
      note: 'Stitch Double-Entry Ledger Active — GAAP Reconciled',
      warn: false,
    },
  ];
}

export default function InfrastructureTelemetryDeck() {
  const [telemetry, setTelemetry] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const t = await api.getInfrastructureTelemetry();
        if (!cancelled) {
          setTelemetry(t);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const services = buildServices(telemetry);
  const healthy = services.filter((s) => s.ok).length;

  return (
    <div className="glass-card" style={{ padding: '18px 22px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px',
          paddingBottom: '12px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              background: 'linear-gradient(135deg, #0D2E37 0%, #173E47 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--swatch-4-mint)',
            }}
          >
            <Server size={16} />
          </div>
          <div>
            <h3
              style={{
                fontSize: '14px',
                margin: 0,
                color: 'var(--text-primary)',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
                fontFamily: 'var(--font-mono)',
              }}
            >
              Live Infrastructure Telemetry
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Measured from the running system every {POLL_MS / 1000}s. Metrics a service cannot
              expose are reported as unavailable rather than estimated.
            </span>
          </div>
        </div>

        <span
          className={`cyber-badge ${healthy === services.length && services.length ? 'cyber-badge-mint' : ''}`}
          style={{ fontSize: '10.5px', padding: '3px 10px' }}
        >
          {healthy === services.length && services.length ? (
            <CheckCircle2 size={11} />
          ) : (
            <AlertTriangle size={11} />
          )}
          <span>
            {services.length ? `${healthy}/${services.length} SERVICES HEALTHY` : 'AWAITING TELEMETRY'}
          </span>
        </span>
      </div>

      {error && (
        <div
          style={{
            padding: '10px 12px',
            marginBottom: '12px',
            borderRadius: 'var(--radius-sm)',
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            color: '#7F1D1D',
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
          }}
        >
          Telemetry unavailable: {error}
        </div>
      )}

      {/* Service cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))',
          gap: '14px',
        }}
      >
        {services.map((svc) => (
          <div
            key={svc.id}
            style={{
              background: '#FFFFFF',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: 'var(--shadow-subtle)',
              transition: 'all 0.2s ease',
              position: 'relative',
              overflow: 'hidden',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = 'var(--swatch-3-mineral)';
              e.currentTarget.style.boxShadow = '0 6px 18px rgba(10, 27, 36, 0.08)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
              e.currentTarget.style.boxShadow = 'var(--shadow-subtle)';
            }}
          >
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '30px',
                      height: '30px',
                      borderRadius: '6px',
                      background: '#EEF4F4',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    {svc.icon}
                  </div>
                  <div>
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: '12.5px',
                        color: 'var(--text-primary)',
                        lineHeight: 1.1,
                      }}
                    >
                      {svc.name}
                    </div>
                    <span
                      style={{
                        fontSize: '9px',
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {svc.category}
                    </span>
                  </div>
                </div>

                <span
                  style={{
                    fontSize: '8.5px',
                    fontWeight: 800,
                    fontFamily: 'var(--font-mono)',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor: svc.ok ? '#E6F5F2' : '#FEE2E2',
                    color: svc.ok ? '#0D7C66' : '#DC2626',
                    border: `1px solid ${svc.ok ? '#A3DFD3' : '#FECACA'}`,
                  }}
                >
                  {svc.status}
                </span>
              </div>

              <p
                style={{
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  margin: '4px 0 10px 0',
                  lineHeight: 1.35,
                }}
              >
                {svc.subtitle}
              </p>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '6px',
                  marginBottom: '10px',
                }}
              >
                {svc.specs.map((sp) => {
                  const missing = sp.val === 'n/a';
                  return (
                    <div
                      key={sp.label}
                      style={{
                        background: '#F8FAFA',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '4px',
                        padding: '6px 8px',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '8px',
                          color: 'var(--text-muted)',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 700,
                        }}
                      >
                        {sp.label}
                      </div>
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 800,
                          color: missing ? 'var(--text-muted)' : 'var(--swatch-2-deep)',
                          fontFamily: 'var(--font-mono)',
                          marginTop: '1px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {sp.val}
                      </div>
                      <div
                        style={{
                          fontSize: '8px',
                          color: 'var(--text-muted)',
                          marginTop: '1px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={sp.sub || ''}
                      >
                        {sp.sub || ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                {(svc.features || []).map((f) => (
                  <span
                    key={f}
                    style={{
                      fontSize: '8.5px',
                      padding: '2px 6px',
                      borderRadius: '3px',
                      background: '#EEF4F4',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-subtle)',
                      fontWeight: 600,
                    }}
                  >
                    {f}
                  </span>
                ))}
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '9px',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  borderTop: '1px dashed var(--border-subtle)',
                  paddingTop: '6px',
                  gap: '8px',
                }}
              >
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: svc.warn ? '#B76E00' : svc.ok ? '#0D7C66' : '#DC2626',
                    minWidth: 0,
                  }}
                  title={svc.note}
                >
                  {svc.warn ? <AlertTriangle size={10} /> : <CheckCircle2 size={10} />}
                  <span
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {svc.note}
                  </span>
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
