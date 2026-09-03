import React, { useEffect, useState } from 'react';
import {
  Radio,
  Newspaper,
  Vote,
  Sparkles,
  Wallet,
  ArrowLeftRight,
  FileCheck2,
  RefreshCw,
  Database,
  ChevronRight,
  Server,
} from 'lucide-react';
import { api } from '../api';

/**
 * The decision loop, stage by stage, with live counters.
 *
 * Every metric comes from /api/telemetry/pipeline, which derives them from the
 * decisions and fills actually recorded. Stages with nothing to report show a
 * dash rather than a fabricated throughput figure.
 */

const POLL_MS = 12000;

function n(v) {
  if (v === null || v === undefined) return '—';
  return Number(v).toLocaleString();
}

function buildNodes(t) {
  const s = t?.stages || {};
  const perception = s.perception || {};
  const reasoning = s.reasoning || {};
  const allocation = s.allocation || {};
  const execution = s.execution || {};
  const adaptation = s.adaptation || {};
  const audit = s.audit || {};

  return [
    {
      id: 'perception',
      title: '1. Perception',
      sub: 'Price • Spread • Depth',
      icon: <Radio size={13} />,
      metric:
        perception.instruments_total != null
          ? `${perception.instruments_fresh}/${perception.instruments_total} fresh`
          : '—',
      detail: `${perception.provider || 'no provider'} · ${n(perception.ticks_received)} ticks`,
      ok: Boolean(perception.connected),
    },
    {
      id: 'information',
      title: '2. Information',
      sub: 'Headlines • Sentiment',
      icon: <Newspaper size={13} />,
      metric: '—',
      detail: 'Scored and attached to observations',
      ok: true,
    },
    {
      id: 'reasoning',
      title: '3. Expert Quorum',
      sub: 'Six domain experts',
      icon: <Vote size={13} />,
      metric: `${n(reasoning.decisions_total)} decisions`,
      detail:
        reasoning.avg_latency_ms != null
          ? `${Math.round(reasoning.avg_latency_ms)}ms average`
          : 'no latency recorded yet',
      ok: true,
    },
    {
      id: 'consensus',
      title: '4. Consensus',
      sub: 'Adaptive weighted vote',
      icon: <Sparkles size={13} />,
      metric: `${n(allocation.escalated)} escalated`,
      detail: 'Weights move with realised outcomes',
      ok: true,
    },
    {
      id: 'allocation',
      title: '5. Allocation',
      sub: 'Vol target • Kelly • Caps',
      icon: <Wallet size={13} />,
      metric: `${n(allocation.executed)} sized`,
      detail: `${n(allocation.declined)} declined on constraints`,
      ok: true,
    },
    {
      id: 'execution',
      title: '6. Execution',
      sub: 'Spread • Impact • Fees',
      icon: <ArrowLeftRight size={13} />,
      metric: `${n(execution.fills)} fills`,
      detail:
        execution.model_error_bps != null
          ? `cost model off by ${execution.model_error_bps.toFixed(2)} bps`
          : 'no fills to compare yet',
      ok: true,
      warn: execution.model_error_bps != null && Math.abs(execution.model_error_bps) > 5,
    },
    {
      id: 'ledger',
      title: '7. Ledger',
      sub: 'Double-entry capital',
      icon: <Database size={13} />,
      metric: '—',
      detail: 'Every movement written as a balanced pair',
      ok: true,
    },
    {
      id: 'audit',
      title: '8. Audit Chain',
      sub: 'SHA-256 linked',
      icon: <FileCheck2 size={13} />,
      metric: `${n(audit.entries)} entries`,
      detail: 'Each entry hashes the one before it',
      ok: true,
    },
    {
      id: 'adaptation',
      title: '9. Adaptation',
      sub: 'Outcome → weight',
      icon: <RefreshCw size={13} />,
      metric: `${n(adaptation.outcomes_recorded)} outcomes`,
      detail: `${n(adaptation.reassessments)} reassessments triggered`,
      ok: true,
    },
  ];
}

export default function ArchitecturePipelineLiveBar() {
  const [telemetry, setTelemetry] = useState(null);
  const [activeStage, setActiveStage] = useState('reasoning');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const t = await api.getPipelineTelemetry();
        if (!cancelled) setTelemetry(t);
      } catch {
        /* the bar degrades to dashes rather than blocking the dashboard */
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const nodes = buildNodes(telemetry);
  const loop = telemetry?.loop;
  const selected = nodes.find((x) => x.id === activeStage);

  return (
    <div
      className="glass-card"
      style={{
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        overflowX: 'auto',
        marginBottom: '10px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Server size={14} color="var(--swatch-2-deep)" />
          <span
            style={{
              fontSize: '11px',
              fontWeight: 800,
              color: 'var(--swatch-2-deep)',
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
              letterSpacing: '0.4px',
            }}
          >
            Autonomous Decision Loop
          </span>
        </div>
        <span
          style={{
            fontSize: '9.5px',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'nowrap',
          }}
        >
          {loop
            ? `${loop.paused ? 'PAUSED' : loop.running ? 'RUNNING' : 'STOPPED'} · ${n(
                loop.cycles_completed
              )} CYCLES · EVERY ${loop.interval_seconds}S`
            : 'AWAITING TELEMETRY'}
        </span>
      </div>

      {/* Stage ribbon */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          overflowX: 'auto',
          paddingBottom: '2px',
        }}
      >
        {nodes.map((node, i) => {
          const isSelected = activeStage === node.id;
          return (
            <React.Fragment key={node.id}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px',
                  padding: '5px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: isSelected
                    ? 'linear-gradient(135deg, #0D2E37 0%, #173E47 100%)'
                    : '#F8FAFA',
                  border: `1px solid ${
                    isSelected
                      ? 'var(--swatch-4-mint)'
                      : node.warn
                        ? '#FDE68A'
                        : node.ok
                          ? 'var(--border-subtle)'
                          : '#FECACA'
                  }`,
                  color: isSelected ? '#FFFFFF' : 'var(--text-primary)',
                  boxShadow: isSelected ? '0 0 12px rgba(125, 174, 170, 0.35)' : 'none',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => setActiveStage(node.id)}
              >
                <div style={{ color: isSelected ? 'var(--swatch-4-mint)' : 'var(--swatch-3-mineral)' }}>
                  {node.icon}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '10.5px', fontWeight: 800, lineHeight: 1.1 }}>
                    {node.title}
                  </span>
                  <span
                    style={{
                      fontSize: '8.5px',
                      color: isSelected ? '#A3DFD3' : 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {node.metric}
                  </span>
                </div>
              </div>

              {i < nodes.length - 1 && (
                <div
                  style={{
                    color: 'var(--swatch-4-mint)',
                    opacity: 0.6,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <ChevronRight size={12} />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Detail for the selected stage */}
      {selected && (
        <div
          style={{
            fontSize: '10px',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
            borderTop: '1px dashed var(--border-subtle)',
            paddingTop: '6px',
          }}
        >
          <strong style={{ color: 'var(--swatch-2-deep)' }}>{selected.sub}</strong> — {selected.detail}
        </div>
      )}
    </div>
  );
}
