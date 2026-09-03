import React, { useCallback, useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Send, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../api';
import { formatMoney, decisionColor } from '../lib/agentMap';

/**
 * Put a specific action to the quorum.
 *
 * This is not a manual override. The operator chooses what gets considered; the
 * six experts still decide whether it happens, the allocator still clips the
 * size to the capital limits, and the execution model still charges spread and
 * fees. A requested notional can only ever reduce what the allocator granted —
 * otherwise the limits would be advisory.
 */
export default function TradeEntryPanel({ onDone }) {
  const [instruments, setInstruments] = useState([]);
  const [marketState, setMarketState] = useState(null);
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState('long');
  const [notional, setNotional] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getInstruments();
      setInstruments(data.instruments || []);
      setMarketState(data.market_state);
      setSymbol((prev) => {
        if (prev) return prev;
        const first = (data.instruments || []).find((i) => i.tradeable);
        return first ? first.symbol : (data.instruments?.[0]?.symbol || '');
      });
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const selected = instruments.find((i) => i.symbol === symbol);
  const canSubmit = Boolean(selected?.tradeable) && !busy;
  const edge = selected
    ? side === 'long'
      ? selected.edge_long_bps
      : selected.edge_short_bps
    : null;

  const submit = async () => {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const r = await api.openPositionManually(
        symbol,
        side,
        notional ? Number(notional) : null
      );
      setResult(r);
      if (onDone) onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div>
        <h3 style={titleStyle}>Propose a trade</h3>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 12px 0', lineHeight: 1.45 }}>
          You choose what the quorum considers. The six experts still vote, the allocator still
          clips the size to the capital limits, and execution still pays spread and fees. A
          requested size can only reduce what the allocator grants.
        </p>
      </div>

      {marketState && marketState !== 'open' && (
        <Note tone="warn">
          Market state is <strong>{marketState}</strong>. Instruments whose price is not moving
          cannot be traded — there is no volatility to size against and no spread to cost.
        </Note>
      )}

      {/* Instrument */}
      <div>
        <label style={labelStyle}>Instrument</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
          {instruments.map((i) => {
            const active = i.symbol === symbol;
            return (
              <button
                key={i.symbol}
                onClick={() => setSymbol(i.symbol)}
                title={i.reason || `${i.symbol} is tradeable`}
                style={{
                  padding: '6px 11px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${active ? 'var(--swatch-2-deep)' : 'var(--border-subtle)'}`,
                  background: active ? '#EBF4F5' : i.tradeable ? '#FFFFFF' : '#F1F5F9',
                  color: i.tradeable ? 'var(--text-primary)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  fontWeight: 700,
                  textAlign: 'left',
                  opacity: i.tradeable ? 1 : 0.6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: i.tradeable ? '#0D7C66' : '#94A3B8',
                      flexShrink: 0,
                    }}
                  />
                  {i.symbol}
                </div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {i.price ? i.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                  {i.volatility ? ` · ${(i.volatility * 100).toFixed(0)}% vol` : ''}
                </div>
              </button>
            );
          })}
          {!instruments.length && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              No instruments reported yet.
            </span>
          )}
        </div>
        {selected && !selected.tradeable && (
          <div style={{ fontSize: '10px', color: '#B76E00', marginTop: '6px' }}>
            {selected.symbol} cannot be traded: {selected.reason}
          </div>
        )}
      </div>

      {/* Side + size */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={labelStyle}>Side</label>
          <div style={{ display: 'flex', gap: '5px', marginTop: '6px' }}>
            {[
              { id: 'long', icon: <TrendingUp size={12} />, label: 'LONG' },
              { id: 'short', icon: <TrendingDown size={12} />, label: 'SHORT' },
            ].map((s) => (
              <button
                key={s.id}
                onClick={() => setSide(s.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '7px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${side === s.id ? (s.id === 'long' ? '#0D7C66' : '#DC2626') : 'var(--border-subtle)'}`,
                  background: side === s.id ? (s.id === 'long' ? '#0D7C66' : '#DC2626') : '#FFFFFF',
                  color: side === s.id ? '#FFFFFF' : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  fontWeight: 800,
                }}
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: '170px' }}>
          <label style={labelStyle}>Notional (optional)</label>
          <input
            type="number"
            min="0"
            value={notional}
            onChange={(e) => setNotional(e.target.value)}
            placeholder="leave blank to let the allocator size it"
            style={{
              width: '100%',
              marginTop: '6px',
              padding: '7px 10px',
              fontSize: '12px',
              fontFamily: 'var(--font-mono)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '4px',
              background: '#FFFFFF',
            }}
          />
        </div>

        <button
          onClick={submit}
          disabled={!canSubmit}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 16px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--swatch-2-deep)',
            background: canSubmit ? 'var(--swatch-2-deep)' : '#E2E8F0',
            color: canSubmit ? '#FFFFFF' : 'var(--text-muted)',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--font-mono)',
            fontSize: '10.5px',
            fontWeight: 800,
            whiteSpace: 'nowrap',
          }}
        >
          <Send size={12} />
          {busy ? 'EVALUATING…' : 'PUT TO QUORUM'}
        </button>
      </div>

      {selected?.tradeable && edge !== null && (
        <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Estimated edge for {side} {symbol}:{' '}
          <strong style={{ color: edge > 0 ? '#0D7C66' : '#DC2626' }}>
            {edge > 0 ? '+' : ''}{edge.toFixed(2)} bps
          </strong>
          {edge <= 0 && ' — the experts will very likely decline this.'}
        </div>
      )}

      {error && <Note tone="bad">{error}</Note>}

      {result && <DecisionResult result={result} />}
    </div>
  );
}

function DecisionResult({ result }) {
  const color = decisionColor(result.final_decision);
  const votes = Object.entries(result.voting_breakdown || {});

  return (
    <div
      style={{
        border: `1px solid ${color}33`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 'var(--radius-sm)',
        background: '#F8FAFA',
        padding: '12px 14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        {result.executed ? <CheckCircle2 size={14} color={color} /> : <XCircle size={14} color={color} />}
        <strong style={{ color, fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
          {result.final_decision.replace(/_/g, ' ').toUpperCase()}
        </strong>
        <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {(result.confidence * 100).toFixed(0)}% consensus ·{' '}
          {formatMoney(result.notional)} ·{' '}
          {result.executed ? 'executed' : 'not executed'} ·{' '}
          {Math.round(result.processing_time_ms)}ms
          {result.binding_constraint ? ` · bound by ${result.binding_constraint}` : ''}
        </span>
      </div>

      {result.execution_error && (
        <div style={{ fontSize: '11px', color: '#B76E00', marginTop: '6px' }}>
          Approved but not executed: {result.execution_error}
        </div>
      )}

      <p style={{ fontSize: '11.5px', margin: '8px 0 0 0', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
        {result.summary}
      </p>

      {votes.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '9px' }}>
          {votes.map(([agent, v]) => (
            <span
              key={agent}
              title={v.reasoning || ''}
              style={{
                fontSize: '9px',
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                padding: '2px 7px',
                borderRadius: '3px',
                background: '#FFFFFF',
                border: `1px solid ${decisionColor(v.decision)}55`,
                color: decisionColor(v.decision),
              }}
            >
              {agent} {v.decision.slice(0, 3).toUpperCase()} {(v.confidence * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Note({ tone, children }) {
  const palette = {
    warn: { bg: '#FFFBEB', bd: '#FDE68A', fg: '#92400E' },
    bad: { bg: '#FEF2F2', bd: '#FECACA', fg: '#7F1D1D' },
  }[tone];
  return (
    <div
      style={{
        display: 'flex',
        gap: '7px',
        alignItems: 'flex-start',
        padding: '9px 12px',
        borderRadius: 'var(--radius-sm)',
        background: palette.bg,
        border: `1px solid ${palette.bd}`,
        color: palette.fg,
        fontSize: '11px',
        lineHeight: 1.45,
      }}
    >
      <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </div>
  );
}

const titleStyle = {
  margin: '0 0 6px 0',
  fontSize: '11px',
  fontWeight: 800,
  fontFamily: 'var(--font-mono)',
  color: 'var(--swatch-2-deep)',
  textTransform: 'uppercase',
  letterSpacing: '0.4px',
};

const labelStyle = {
  fontSize: '9px',
  fontWeight: 800,
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.3px',
};
