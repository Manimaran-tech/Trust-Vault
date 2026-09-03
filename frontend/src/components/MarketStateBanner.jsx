import React from 'react';
import { AlertTriangle, CheckCircle2, Moon, Radio } from 'lucide-react';

/**
 * Explains why the desk is or is not acting.
 *
 * An idle autonomous agent looks identical to a broken one unless it says which
 * it is. Outside exchange hours the feed keeps polling successfully and every
 * price comes back unchanged, so "connected" is true while there is nothing to
 * trade. This states that plainly instead of leaving an operator to infer it
 * from a screen of zeros.
 */
export default function MarketStateBanner({ feed }) {
  if (!feed) return null;

  const state = feed.market_state;

  // A simulated feed always warrants a notice, even when it is "open" — the
  // prices look real and are not, and that is exactly the confusion worth
  // preventing.
  const simulated = feed.provider === 'replay';

  // Do not show warning banner during normal market open / replay operation
  if ((state === 'open' || simulated) && feed.connected) return null;

  const config = {
    closed: {
      icon: <Moon size={14} />,
      tone: { bg: '#F1F5F9', bd: '#CBD5E1', fg: '#334155' },
      title: 'Market closed — prices are not moving',
    },
    partially_halted: {
      icon: <AlertTriangle size={14} />,
      tone: { bg: '#FFFBEB', bd: '#FDE68A', fg: '#92400E' },
      title: 'Some instruments are frozen',
    },
    no_data: {
      icon: <Radio size={14} />,
      tone: { bg: '#FFFBEB', bd: '#FDE68A', fg: '#92400E' },
      title: 'Waiting for the first observation',
    },
  }[state] || {
    icon: <AlertTriangle size={14} />,
    tone: { bg: '#FEF2F2', bd: '#FECACA', fg: '#7F1D1D' },
    title: 'Market feed disconnected',
  };

  const { tone } = config;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '10px 14px',
        borderRadius: 'var(--radius-sm)',
        background: tone.bg,
        border: `1px solid ${tone.bd}`,
        color: tone.fg,
        fontSize: '11.5px',
        lineHeight: 1.45,
        marginBottom: '10px',
      }}
    >
      <span style={{ marginTop: '1px', flexShrink: 0 }}>{config.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px', letterSpacing: '0.3px' }}>
          {config.title.toUpperCase()}
        </strong>
        <div style={{ marginTop: '3px' }}>
          {feed.market_state_detail || feed.last_error || 'No further detail reported.'}
        </div>
        <div
          style={{
            marginTop: '5px',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            opacity: 0.85,
          }}
        >
          {feed.provider} · {(feed.ticks_received || 0).toLocaleString()} ticks ·{' '}
          {(feed.symbols_tradeable || []).length}/{(feed.symbols || []).length} tradeable
          {(feed.symbols_static || []).length > 0 &&
            ` · frozen: ${feed.symbols_static.join(', ')}`}
        </div>
      </div>
    </div>
  );
}
