import React, { useRef, useEffect } from 'react';
import {
  ShieldAlert,
  Wallet,
  Gauge,
  TrendingUp,
  Clock,
  Layers,
  Activity,
} from 'lucide-react';
import { animate, stagger } from '../lib/animeUtils';
import { formatMoney, formatPct } from '../lib/agentMap';

/**
 * Capital and decision-loop KPIs.
 *
 * Every value is derived from the backend's portfolio state or its recorded
 * decisions. A metric that is not yet computable renders as an em dash rather
 * than a placeholder number.
 */
export default function KpiTelemetryRibbon({ portfolio = null, loop = null, avgLatency = null }) {
  const ribbonRef = useRef(null);

  useEffect(() => {
    if (ribbonRef.current) {
      animate(ribbonRef.current.children, {
        opacity: [0, 1],
        translateY: [-10, 0],
        scale: [0.98, 1],
        delay: stagger(30),
        duration: 450,
        ease: 'outExpo',
      });
    }
  }, []);

  const nav = portfolio?.nav ?? null;
  const returnPct = portfolio?.return_pct ?? null;
  const exposurePct = portfolio?.exposure_pct ?? null;
  const maxExposure = portfolio?.max_exposure_pct ?? null;
  const drawdown = portfolio?.drawdown_pct ?? null;
  const maxDrawdown = portfolio?.max_drawdown_pct ?? null;
  const realized = portfolio?.realized_pnl ?? null;
  const unrealized = portfolio?.unrealized_pnl ?? null;
  const openCount = portfolio?.open_position_count ?? 0;
  const halted = portfolio?.halted ?? false;

  // Exposure and drawdown are shown against their ceilings, so a number is
  // never presented without the limit that makes it meaningful.
  const exposureRatio = exposurePct !== null && maxExposure ? exposurePct / maxExposure : null;
  const drawdownRatio = drawdown !== null && maxDrawdown ? drawdown / maxDrawdown : null;

  const cards = [
    {
      key: 'nav',
      icon: <Wallet size={16} />,
      label: 'Net Asset Value',
      value: formatMoney(nav),
      accent: 'var(--swatch-2-deep)',
      iconBg: '#EEF4F4',
      iconBorder: 'var(--border-subtle)',
      badge: returnPct === null ? '—' : `${returnPct >= 0 ? '+' : ''}${formatPct(returnPct, 2)}`,
      badgeTone: returnPct === null ? 'neutral' : returnPct >= 0 ? 'good' : 'bad',
    },
    {
      key: 'pnl',
      icon: <TrendingUp size={16} />,
      label: 'Realised P&L',
      value: formatMoney(realized, 2),
      accent: realized === null ? 'var(--text-primary)' : realized >= 0 ? '#0D7C66' : '#DC2626',
      iconBg: realized !== null && realized < 0 ? '#FEE2E2' : '#E6F5F2',
      iconBorder: realized !== null && realized < 0 ? '#FECACA' : '#A3DFD3',
      badge: unrealized === null ? '—' : `${formatMoney(unrealized, 2)} open`,
      badgeTone: 'neutral',
    },
    {
      key: 'exposure',
      icon: <Gauge size={16} />,
      label: 'Gross Exposure',
      value: formatPct(exposurePct, 1),
      accent: 'var(--text-primary)',
      iconBg: '#EEF4F4',
      iconBorder: 'var(--border-subtle)',
      badge: maxExposure === null ? '—' : `cap ${formatPct(maxExposure, 0)}`,
      badgeTone: exposureRatio !== null && exposureRatio > 0.9 ? 'warn' : 'neutral',
      meter: exposureRatio,
    },
    {
      key: 'drawdown',
      icon: <ShieldAlert size={16} />,
      label: halted ? 'Halted — Drawdown' : 'Drawdown From Peak',
      value: formatPct(drawdown, 2),
      accent: halted ? '#DC2626' : 'var(--text-primary)',
      iconBg: halted ? '#FEE2E2' : '#EEF4F4',
      iconBorder: halted ? '#FECACA' : 'var(--border-subtle)',
      badge: maxDrawdown === null ? '—' : `halt ${formatPct(maxDrawdown, 0)}`,
      badgeTone: halted ? 'bad' : drawdownRatio !== null && drawdownRatio > 0.7 ? 'warn' : 'neutral',
      meter: drawdownRatio,
      alert: halted,
    },
    {
      key: 'positions',
      icon: <Layers size={16} />,
      label: 'Open Positions',
      value: `${openCount}`,
      accent: 'var(--text-primary)',
      iconBg: '#EEF4F4',
      iconBorder: 'var(--border-subtle)',
      badge: loop ? `${loop.cycles_completed ?? 0} cycles` : '—',
      badgeTone: 'neutral',
    },
    {
      key: 'latency',
      icon: <Clock size={16} />,
      label: 'Decision Latency',
      value: avgLatency === null ? '—' : `${Math.round(avgLatency)}ms`,
      accent: 'var(--text-primary)',
      iconBg: '#EEF4F4',
      iconBorder: 'var(--border-subtle)',
      badge: loop
        ? loop.paused
          ? 'PAUSED'
          : loop.running
            ? `every ${loop.interval_seconds}s`
            : 'STOPPED'
        : '—',
      badgeTone: loop?.running && !loop?.paused ? 'good' : 'warn',
    },
  ];

  return (
    <div
      ref={ribbonRef}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '10px',
        marginBottom: '10px',
      }}
    >
      {cards.map((card) => (
        <div
          key={card.key}
          className="glass-card"
          style={{
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: card.alert ? '#FEF2F2' : undefined,
            border: card.alert ? '1px solid #EF4444' : undefined,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: card.iconBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: card.accent,
                border: `1px solid ${card.iconBorder}`,
                flexShrink: 0,
              }}
            >
              {card.icon}
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: '9.5px',
                  color: 'var(--text-muted)',
                  fontWeight: '700',
                  textTransform: 'uppercase',
                  fontFamily: 'var(--font-mono)',
                  whiteSpace: 'nowrap',
                }}
              >
                {card.label}
              </div>
              <div
                style={{
                  fontSize: '15.5px',
                  fontWeight: '800',
                  color: card.accent,
                  fontFamily: 'var(--font-mono)',
                  lineHeight: 1.1,
                }}
              >
                {card.value}
              </div>
            </div>
          </div>

          <span style={toneStyle(card.badgeTone)}>{card.badge}</span>

          {/* Utilisation bar against the governing limit */}
          {typeof card.meter === 'number' && (
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: '2.5px',
                background: '#DCE5E5',
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, Math.max(0, card.meter * 100))}%`,
                  height: '100%',
                  background:
                    card.meter > 0.9 ? '#DC2626' : card.meter > 0.7 ? '#D97706' : '#0D7C66',
                  transition: 'width 0.6s ease',
                }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function toneStyle(tone) {
  const base = {
    fontSize: '9.5px',
    fontWeight: '700',
    fontFamily: 'var(--font-mono)',
    padding: '2px 6px',
    borderRadius: '4px',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };
  if (tone === 'good')
    return { ...base, backgroundColor: '#E6F5F2', color: '#0D7C66', border: '1px solid #A3DFD3' };
  if (tone === 'bad')
    return { ...base, backgroundColor: '#DC2626', color: '#FFFFFF', border: '1px solid #DC2626' };
  if (tone === 'warn')
    return { ...base, backgroundColor: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' };
  return {
    ...base,
    backgroundColor: '#F8FAFA',
    color: 'var(--text-muted)',
    border: '1px solid var(--border-subtle)',
  };
}
