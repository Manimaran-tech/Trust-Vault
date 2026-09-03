import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import {
  Inbox,
  Fingerprint,
  ShieldAlert,
  BarChart3,
  Scale,
  FileCheck,
  Brain,
  Vote,
  Building2,
  CheckCircle2,
  Sparkles,
  PenLine,
  Target,
  Send,
  Loader2,
  Zap,
  Activity,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  Play
} from 'lucide-react';
import { animate, createTimeline, stagger, animateCounter, pulseGlow } from '../lib/animeUtils';

const renderAgentIcon = (name, size = 18) => {
  switch (name?.toLowerCase()) {
    case 'identity':
      return <Fingerprint size={size} color="var(--swatch-3-mineral)" />;
    case 'fraud':
      return <ShieldAlert size={size} color="var(--accent-crimson)" />;
    case 'risk':
      return <BarChart3 size={size} color="var(--accent-amber)" />;
    case 'compliance':
      return <Scale size={size} color="var(--swatch-2-deep)" />;
    case 'policy':
      return <FileCheck size={size} color="var(--accent-emerald)" />;
    case 'explainability':
    default:
      return <Brain size={size} color="var(--swatch-3-mineral)" />;
  }
};

const PIPELINE_STAGES = [
  { key: 'received', icon: <Inbox size={14} />, label: 'Received' },
  { key: 'identity', icon: <Fingerprint size={14} />, label: 'Identity' },
  { key: 'fraud', icon: <ShieldAlert size={14} />, label: 'Fraud' },
  { key: 'risk', icon: <BarChart3 size={14} />, label: 'Risk' },
  { key: 'compliance', icon: <Scale size={14} />, label: 'Compliance' },
  { key: 'policy', icon: <FileCheck size={14} />, label: 'Policy' },
  { key: 'explain', icon: <Brain size={14} />, label: 'Explain' },
  { key: 'consensus', icon: <Vote size={14} />, label: 'Consensus' },
  { key: 'governance', icon: <Building2 size={14} />, label: 'Governance' },
  { key: 'final', icon: <CheckCircle2 size={14} />, label: 'Final' },
];

export default function Simulator() {
  const [scenarios, setScenarios] = useState([]);
  const [form, setForm] = useState({
    transaction_type: 'purchase',
    amount: '',
    merchant_name: '',
    merchant_category: '',
    merchant_country: 'United States',
    card_member_name: '',
    description: '',
    metadata: {}
  });
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [pipelineStage, setPipelineStage] = useState(-1);
  const [selectedScenarioIdx, setSelectedScenarioIdx] = useState(null);

  const scenarioListRef = useRef(null);
  const resultCardRef = useRef(null);
  const pipelineRef = useRef(null);
  const latencyRef = useRef(null);

  useEffect(() => {
    api.getScenarios().then(data => {
      setScenarios(data);
    }).catch(console.error);
  }, []);

  // Animate scenarios into view when loaded
  useEffect(() => {
    if (scenarios.length > 0 && scenarioListRef.current) {
      animate(scenarioListRef.current.children, {
        opacity: [0, 1],
        translateY: [16, 0],
        scale: [0.97, 1],
        delay: stagger(40, { start: 100 }),
        duration: 500,
        ease: 'outBack(1.2)'
      });
    }
  }, [scenarios]);

  // Animate result card when result is received
  useEffect(() => {
    if (result && resultCardRef.current) {
      animate(resultCardRef.current, {
        opacity: [0, 1],
        translateY: [24, 0],
        scale: [0.98, 1],
        duration: 600,
        ease: 'outExpo'
      });

      if (latencyRef.current && result.processing_time_ms) {
        animateCounter(latencyRef.current, 0, Math.round(result.processing_time_ms), {
          duration: 800,
          suffix: 'ms'
        });
      }
    }
  }, [result]);

  const runScenario = async (scenario, idx = null) => {
    setSelectedScenarioIdx(idx);
    setResult(null);
    setError('');
    setProcessing(true);
    setPipelineStage(0);

    const txData = {
      transaction_type: scenario.transaction_type || 'purchase',
      amount: scenario.amount,
      merchant_name: scenario.merchant_name,
      merchant_category: scenario.merchant_category,
      merchant_country: scenario.merchant_country,
      card_member_name: scenario.card_member_name,
      description: scenario.description,
      metadata: scenario.metadata || {},
    };

    // Anime.js pipeline progression timeline
    const animInterval = setInterval(() => {
      setPipelineStage(prev => {
        if (prev < PIPELINE_STAGES.length - 1) {
          return prev + 1;
        }
        return prev;
      });
    }, 600);

    try {
      const res = await api.submitTransaction(txData);
      clearInterval(animInterval);
      setPipelineStage(PIPELINE_STAGES.length);
      setResult(res);
    } catch (err) {
      clearInterval(animInterval);
      setPipelineStage(-1);
      setError(err.message || 'Transaction evaluation failed');
    }
    setProcessing(false);
  };

  const submitCustom = async (e) => {
    e.preventDefault();
    if (!form.amount || !form.card_member_name) return;
    await runScenario({ ...form, amount: parseFloat(form.amount) });
  };

  const fillScenarioToForm = (s) => {
    setForm({
      transaction_type: s.transaction_type || 'purchase',
      amount: s.amount?.toString() || '',
      merchant_name: s.merchant_name || '',
      merchant_category: s.merchant_category || '',
      merchant_country: s.merchant_country || 'United States',
      card_member_name: s.card_member_name || '',
      description: s.description || '',
      metadata: s.metadata || {}
    });
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header Banner */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        background: 'linear-gradient(135deg, rgba(10, 27, 36, 0.95) 0%, rgba(13, 46, 55, 0.9) 100%)',
        padding: '18px 22px',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid rgba(125, 174, 170, 0.3)',
        boxShadow: '0 8px 24px rgba(10, 27, 36, 0.12)',
        color: '#FFFFFF'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34,
              height: 34,
              borderRadius: 'var(--radius-md)',
              background: 'rgba(125, 174, 170, 0.2)',
              border: '1px solid rgba(125, 174, 170, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--swatch-4-mint)'
            }}>
              <Zap size={18} />
            </div>
            <div>
              <h1 style={{ fontSize: 18, margin: 0, color: '#FFFFFF', letterSpacing: '-0.3px' }}>
                Transaction Simulator & MoE Pipeline
              </h1>
              <p style={{ fontSize: 12, margin: '3px 0 0 0', color: '#CCD6D6' }}>
                Inject synthetic financial vectors and inspect multi-agent consensus telemetry in real-time
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="cyber-badge cyber-badge-mint" style={{ background: 'rgba(13, 124, 102, 0.25)', color: '#A3DFD3', border: '1px solid rgba(163, 223, 211, 0.4)' }}>
            <Activity size={12} className="radar-pulse-ring" />
            <span>6 EXPERTS ACTIVE</span>
          </span>
        </div>
      </div>

      {/* Live Pipeline Execution Display */}
      {processing && (
        <div ref={pipelineRef} className="glass-card" style={{ padding: '20px', border: '1px solid var(--accent-mint)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Loader2 size={16} className="spinner" color="var(--swatch-2-deep)" />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--swatch-2-deep)', fontFamily: 'var(--font-mono)' }}>
                EVALUATING MULTI-AGENT QUORUM...
              </span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              STAGE {pipelineStage + 1} OF {PIPELINE_STAGES.length}
            </span>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))',
            gap: 8,
            alignItems: 'center'
          }}>
            {PIPELINE_STAGES.map((stage, i) => {
              const isPast = i < pipelineStage;
              const isCurrent = i === pipelineStage;

              return (
                <div
                  key={stage.key}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '10px 6px',
                    borderRadius: 'var(--radius-md)',
                    background: isPast ? '#E6F5F2' : isCurrent ? 'linear-gradient(135deg, #0D2E37 0%, #163B44 100%)' : 'rgba(255, 255, 255, 0.7)',
                    border: `1.5px solid ${isPast ? '#A3DFD3' : isCurrent ? 'var(--swatch-4-mint)' : 'var(--border-subtle)'}`,
                    color: isPast ? '#0D7C66' : isCurrent ? '#FFFFFF' : 'var(--text-muted)',
                    boxShadow: isCurrent ? '0 0 16px rgba(125, 174, 170, 0.4)' : 'none',
                    transform: isCurrent ? 'scale(1.05)' : 'scale(1)',
                    transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                  }}
                >
                  <div style={{ marginBottom: 4 }}>{stage.icon}</div>
                  <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.2px' }}>{stage.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <div className="glass-card" style={{ background: '#FEF2F2', borderColor: '#FECACA', color: '#DC2626', display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={18} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{error}</span>
        </div>
      )}

      {/* Result Panel */}
      {result && (
        <div ref={resultCardRef} className="glass-card" style={{ padding: 22, border: '1px solid rgba(13, 124, 102, 0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--radius-sm)',
                background: result.final_decision === 'approve' ? '#E6F5F2' : result.final_decision === 'review' ? '#FFF8E6' : '#FEF2F2',
                border: `1px solid ${result.final_decision === 'approve' ? '#A3DFD3' : result.final_decision === 'review' ? '#FFE29A' : '#FECACA'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: result.final_decision === 'approve' ? '#0D7C66' : result.final_decision === 'review' ? '#B76E00' : '#DC2626'
              }}>
                <ShieldCheck size={18} />
              </div>
              <div>
                <h3 style={{ fontSize: 16, margin: 0, color: 'var(--text-primary)' }}>Consensus Quorum Verdict</h3>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  TX: {result.transaction_id || 'TX-SIM-ACTIVE'}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className={`status-badge ${result.final_decision}`} style={{ fontSize: 13, padding: '6px 16px', borderRadius: 'var(--radius-pill)' }}>
                {result.final_decision?.toUpperCase()}
              </span>
              <div style={{
                background: 'rgba(10, 27, 36, 0.05)',
                padding: '5px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--swatch-2-deep)'
              }}>
                <span ref={latencyRef}>{result.processing_time_ms ? `${Math.round(result.processing_time_ms)}ms` : '180ms'}</span>
              </div>
            </div>
          </div>

          {/* Explainability Summary */}
          {result.explainability_summary && (
            <div style={{
              marginBottom: 20,
              padding: 16,
              background: 'linear-gradient(135deg, rgba(248, 250, 250, 0.95) 0%, rgba(232, 243, 245, 0.8) 100%)',
              border: '1px solid rgba(125, 174, 170, 0.3)',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 2px 8px rgba(10, 27, 36, 0.04)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Sparkles size={15} color="var(--swatch-2-deep)" />
                <h4 style={{ fontSize: 12.5, color: 'var(--swatch-2-deep)', margin: 0, textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.5px' }}>
                  AI SHAP Synthesis & Root-Cause Explanation
                </h4>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6, margin: 0 }}>
                {result.explainability_summary}
              </p>
            </div>
          )}

          {/* Agent Verdicts Grid */}
          <h4 style={{ fontSize: 12, marginBottom: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6, fontFamily: 'var(--font-mono)' }}>
            Expert Domain Breakdowns (MoE)
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            {(result.agent_verdicts || []).map(v => (
              <div
                key={v.agent_name}
                className="glass-card"
                style={{
                  padding: 14,
                  background: 'rgba(255, 255, 255, 0.95)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: 'var(--radius-sm)',
                    background: '#EEF4F4',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    {renderAgentIcon(v.agent_name)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ textTransform: 'capitalize', fontWeight: 800, fontSize: 13, color: 'var(--text-primary)' }}>
                      {v.agent_name}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <span className={`status-badge ${v.decision}`} style={{ padding: '1px 6px', fontSize: 9.5 }}>
                        {v.decision}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {(v.confidence * 100).toFixed(0)}% CONF
                      </span>
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  {v.reasoning}
                </div>
                {v.risk_flags?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 10 }}>
                    {v.risk_flags.map((f, i) => (
                      <span key={i} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>
                        {f}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Governance Layer Checks */}
          {result.governance && (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
              <h4 style={{ fontSize: 12, marginBottom: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: 'var(--font-mono)' }}>
                OPA Policy Guardrails & Deterministic Verification
              </h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(result.governance.checks || []).map((check, i) => (
                  <div key={i} style={{
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 11.5,
                    background: check.passed ? '#E6F5F2' : '#FEF2F2',
                    border: `1px solid ${check.passed ? '#A3DFD3' : '#FECACA'}`,
                    color: check.passed ? '#0D7C66' : '#DC2626',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontWeight: 700
                  }}>
                    {check.passed ? <CheckCircle2 size={13} /> : <ShieldAlert size={13} />}
                    <span>{check.check?.replace(/_/g, ' ')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Interactive Scenario Selection & Custom Form Stage */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(340px, 1fr)', gap: 16, alignItems: 'start' }}>
        {/* Left Column: Curated Test Scenarios */}
        <div className="glass-card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Target size={17} color="var(--swatch-2-deep)" />
              <h3 style={{ fontSize: 15, margin: 0, color: 'var(--text-primary)' }}>
                Curated Threat & Behavioral Vectors
              </h3>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {scenarios.length} PRESETS
            </span>
          </div>

          <div ref={scenarioListRef} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 520, overflowY: 'auto', paddingRight: 4 }}>
            {scenarios.map((s, i) => {
              const isSelected = selectedScenarioIdx === i;
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    background: isSelected ? 'rgba(232, 243, 245, 0.85)' : '#FFFFFF',
                    border: `1px solid ${isSelected ? 'var(--swatch-3-mineral)' : 'var(--border-subtle)'}`,
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-primary)',
                    boxShadow: 'var(--shadow-subtle)',
                    transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                    position: 'relative'
                  }}
                  onMouseOver={e => {
                    if (!processing && !isSelected) {
                      e.currentTarget.style.borderColor = 'var(--swatch-3-mineral)';
                      e.currentTarget.style.transform = 'translateX(3px)';
                    }
                  }}
                  onMouseOut={e => {
                    if (!processing && !isSelected) {
                      e.currentTarget.style.borderColor = 'var(--border-subtle)';
                      e.currentTarget.style.transform = 'translateX(0)';
                    }
                  }}
                >
                  <div style={{ flex: 1, paddingRight: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--text-primary)' }}>{s.name}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                      {s.merchant_name || 'Retail'} • {s.merchant_country || 'US'}
                      {s.card_member_name ? ` • Member: ${s.card_member_name}` : ''}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--swatch-2-deep)', fontFamily: 'var(--font-mono)' }}>
                      ${s.amount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>

                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => fillScenarioToForm(s)}
                        title="Load into custom form"
                        style={{
                          padding: '6px 8px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-subtle)',
                          background: '#F4F8F8',
                          color: 'var(--text-secondary)',
                          fontSize: 11,
                          cursor: 'pointer'
                        }}
                      >
                        Fill
                      </button>

                      <button
                        type="button"
                        onClick={() => runScenario(s, i)}
                        disabled={processing}
                        title="Execute scenario through multi-agent quorum"
                        className="btn btn-primary"
                        style={{ padding: '6px 12px', fontSize: 11.5 }}
                      >
                        <Play size={11} />
                        <span>Run</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Custom Vector Form */}
        <div className="glass-card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <PenLine size={17} color="var(--swatch-2-deep)" />
            <h3 style={{ fontSize: 15, margin: 0, color: 'var(--text-primary)' }}>Custom Payload Composer</h3>
          </div>

          <form onSubmit={submitCustom}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label>Transaction Type</label>
                <select
                  className="form-input"
                  value={form.transaction_type}
                  onChange={e => setForm({ ...form, transaction_type: e.target.value })}
                >
                  <option value="purchase">Purchase</option>
                  <option value="transfer">Wire Transfer</option>
                  <option value="withdrawal">ATM Withdrawal</option>
                  <option value="payment">Card Payment</option>
                </select>
              </div>

              <div className="form-group">
                <label>Amount (\u20b9 INR)</label>
                <input
                  className="form-input"
                  type="number"
                  step="0.01"
                  value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })}
                  placeholder="0.00"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label>Card Member / Originator</label>
              <input
                className="form-input"
                value={form.card_member_name}
                onChange={e => setForm({ ...form, card_member_name: e.target.value })}
                placeholder="e.g. Satoshi Nakamoto"
                required
              />
            </div>

            <div className="form-group">
              <label>Merchant / Beneficiary</label>
              <input
                className="form-input"
                value={form.merchant_name}
                onChange={e => setForm({ ...form, merchant_name: e.target.value })}
                placeholder="e.g. Stripe Vault or Darknet Host"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label>Category Code</label>
                <input
                  className="form-input"
                  value={form.merchant_category}
                  onChange={e => setForm({ ...form, merchant_category: e.target.value })}
                  placeholder="e.g. Retail / Crypto"
                />
              </div>
              <div className="form-group">
                <label>Country Destination</label>
                <input
                  className="form-input"
                  value={form.merchant_country}
                  onChange={e => setForm({ ...form, merchant_country: e.target.value })}
                  placeholder="United States"
                />
              </div>
            </div>

            <div className="form-group">
              <label>Transaction Memo / Context</label>
              <input
                className="form-input"
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="Optional telemetry note"
              />
            </div>

            <button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', marginTop: 6, padding: '10px 16px' }}
              disabled={processing}
            >
              {processing ? <Loader2 size={15} className="spinner" /> : <Send size={15} />}
              <span>{processing ? 'Evaluating Through Quorum...' : 'Submit Transaction to MoE'}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
