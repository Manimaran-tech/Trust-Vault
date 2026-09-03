import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Activity,
  Cpu,
  Fingerprint,
  BarChart3,
  Scale,
  FileCheck,
  Brain,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Zap,
  Search,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  CreditCard,
  MessageSquare,
  BookOpen,
  History,
  Shield,
  Layers
} from 'lucide-react';
import { animate, stagger } from '../lib/animeUtils';

const ALL_AGENTS_DATA = [
  // Context & Retrieval
  {
    id: 'customer_intent',
    name: 'Customer Intent Agent',
    category: 'Context & Ingress',
    harness: 'LangGraph Intent Parser',
    status: 'active',
    accuracy: 99.4,
    hallucinationRate: 0.1,
    confidence: 97,
    avgLatency: '14ms',
    evaluations: 1240,
    drift: '0.02',
    icon: <MessageSquare size={16} color="var(--swatch-4-mint)" />
  },
  {
    id: 'knowledge_rag',
    name: 'Knowledge Agent (RAG)',
    category: 'Context & Ingress',
    harness: 'Vector Store (Cosine Sim)',
    status: 'active',
    accuracy: 98.9,
    hallucinationRate: 0.3,
    confidence: 95,
    avgLatency: '22ms',
    evaluations: 1180,
    drift: '0.04',
    icon: <BookOpen size={16} color="var(--swatch-3-mineral)" />
  },
  {
    id: 'context_memory',
    name: 'Context Memory Agent',
    category: 'Context & Ingress',
    harness: 'Redis Session Graphs',
    status: 'active',
    accuracy: 99.8,
    hallucinationRate: 0.0,
    confidence: 99,
    avgLatency: '4ms',
    evaluations: 1240,
    drift: '0.01',
    icon: <History size={16} color="var(--accent-emerald)" />
  },
  // MoE Domain Experts
  {
    id: 'identity_kyc',
    name: 'Identity Verification Agent',
    category: 'MoE Expert Layer',
    harness: 'Qwen 2.5 / Biometrics',
    status: 'active',
    accuracy: 98.7,
    hallucinationRate: 0.2,
    confidence: 96,
    avgLatency: '120ms',
    evaluations: 942,
    drift: '0.03',
    icon: <Fingerprint size={16} color="var(--swatch-3-mineral)" />
  },
  {
    id: 'fraud_detection',
    name: 'Fraud Detection Agent',
    category: 'MoE Expert Layer',
    harness: 'Graph Neural Net + Darknet IP',
    status: 'active',
    accuracy: 99.1,
    hallucinationRate: 0.4,
    confidence: 94,
    avgLatency: '145ms',
    evaluations: 942,
    drift: '0.05',
    icon: <ShieldAlert size={16} color="var(--accent-crimson)" />
  },
  {
    id: 'financial_risk',
    name: 'Financial Risk Agent',
    category: 'MoE Expert Layer',
    harness: 'Monte Carlo Exposure Sim',
    status: 'active',
    accuracy: 98.2,
    hallucinationRate: 0.3,
    confidence: 93,
    avgLatency: '110ms',
    evaluations: 942,
    drift: '0.02',
    icon: <BarChart3 size={16} color="var(--accent-amber)" />
  },
  {
    id: 'aml_compliance',
    name: 'AML / Compliance Agent',
    category: 'MoE Expert Layer',
    harness: 'OFAC & FinCEN Vector Rules',
    status: 'active',
    accuracy: 99.6,
    hallucinationRate: 0.1,
    confidence: 98,
    avgLatency: '130ms',
    evaluations: 942,
    drift: '0.01',
    icon: <Scale size={16} color="var(--swatch-2-deep)" />
  },
  {
    id: 'policy_validation',
    name: 'Policy Validation Agent',
    category: 'MoE Expert Layer',
    harness: 'Deterministic Rules + Context',
    status: 'active',
    accuracy: 99.9,
    hallucinationRate: 0.0,
    confidence: 99,
    avgLatency: '95ms',
    evaluations: 942,
    drift: '0.00',
    icon: <FileCheck size={16} color="var(--accent-emerald)" />
  },
  {
    id: 'credit_decision',
    name: 'Credit Decision Agent',
    category: 'MoE Expert Layer',
    harness: 'XGBoost + LLM Scorer',
    status: 'active',
    accuracy: 97.9,
    hallucinationRate: 0.4,
    confidence: 92,
    avgLatency: '105ms',
    evaluations: 820,
    drift: '0.06',
    icon: <CreditCard size={16} color="var(--accent-cyan)" />
  },
  {
    id: 'explainability_xai',
    name: 'Explainability & XAI Agent',
    category: 'MoE Expert Layer',
    harness: 'TreeSHAP Attribution Scribe',
    status: 'active',
    accuracy: 99.2,
    hallucinationRate: 0.2,
    confidence: 97,
    avgLatency: '160ms',
    evaluations: 942,
    drift: '0.02',
    icon: <Brain size={16} color="var(--swatch-3-mineral)" />
  },
  // Defense & Guardrails
  {
    id: 'ai_watchdog',
    name: 'AI Watchdog Perimeter',
    category: 'Supervision & Defense',
    harness: 'KS Drift Test + Chaos Defense',
    status: 'active',
    accuracy: 99.5,
    hallucinationRate: 0.0,
    confidence: 99,
    avgLatency: '4ms',
    evaluations: 1240,
    drift: '0.01',
    icon: <Radio size={16} color="var(--accent-crimson)" />
  },
  {
    id: 'governance_opa',
    name: 'Governance OPA Guard',
    category: 'Supervision & Defense',
    harness: 'Open Policy Agent (Rego)',
    status: 'active',
    accuracy: 100.0,
    hallucinationRate: 0.0,
    confidence: 100,
    avgLatency: '2.5ms',
    evaluations: 1240,
    drift: '0.00',
    icon: <ShieldCheck size={16} color="var(--accent-amber)" />
  }
];

export default function AgentStatusVerticalColumn({ selectedAgentId, onSelectAgent }) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [expandedAgent, setExpandedAgent] = useState(null);
  const columnRef = useRef(null);

  useEffect(() => {
    if (columnRef.current) {
      animate(columnRef.current.children, {
        opacity: [0, 1],
        translateX: [14, 0],
        delay: stagger(30),
        duration: 400,
        ease: 'outExpo'
      });
    }
  }, [categoryFilter]);

  const filteredAgents = ALL_AGENTS_DATA.filter(agent => {
    const matchesSearch = agent.name.toLowerCase().includes(search.toLowerCase()) ||
                          agent.harness.toLowerCase().includes(search.toLowerCase()) ||
                          agent.category.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === 'ALL' ||
                            (categoryFilter === 'MOE' && agent.category.includes('MoE')) ||
                            (categoryFilter === 'CONTEXT' && agent.category.includes('Context')) ||
                            (categoryFilter === 'DEFENSE' && agent.category.includes('Supervision'));
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="glass-card" style={{
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      height: '100%',
      minHeight: '620px',
      maxHeight: '840px',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            background: 'linear-gradient(135deg, #0D2E37 0%, #1A4650 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--swatch-4-mint)'
          }}>
            <Cpu size={15} />
          </div>
          <div>
            <h3 style={{ fontSize: '13.5px', margin: 0, color: 'var(--text-primary)', fontWeight: 800 }}>
              Agent Swarm Harness
            </h3>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              12 ACTIVE MULTI-AGENT RUNTIMES
            </span>
          </div>
        </div>

        <span className="cyber-badge cyber-badge-mint" style={{ fontSize: '10px', padding: '2px 8px' }}>
          <span className="status-dot live" style={{ width: 6, height: 6 }} />
          <span>ALL NOMINAL</span>
        </span>
      </div>

      {/* Category Pills & Search */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div className="pill-filter-group" style={{ padding: '2px', justifyContent: 'space-between' }}>
          {[
            { id: 'ALL', label: 'All (12)' },
            { id: 'MOE', label: 'MoE (7)' },
            { id: 'CONTEXT', label: 'Context (3)' },
            { id: 'DEFENSE', label: 'Defense (2)' }
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              className={`pill-filter-btn ${categoryFilter === tab.id ? 'active' : ''}`}
              style={{ fontSize: '11px', padding: '3px 8px' }}
              onClick={() => setCategoryFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ position: 'relative' }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            className="form-input"
            style={{ paddingLeft: '26px', paddingRight: '8px', paddingTop: '4px', paddingBottom: '4px', fontSize: '11.5px', height: '28px' }}
            placeholder="Filter harness, LLM, or agent..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Agents Scrollable Vertical List */}
      <div
        ref={columnRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          overflowY: 'auto',
          paddingRight: '3px',
          flex: 1
        }}
      >
        {filteredAgents.map(agent => {
          const isSelected = selectedAgentId === agent.id;
          const isExpanded = expandedAgent === agent.id;

          return (
            <div
              key={agent.id}
              style={{
                borderRadius: 'var(--radius-md)',
                background: isSelected ? 'rgba(232, 243, 245, 0.95)' : '#FFFFFF',
                border: `1px solid ${isSelected ? 'var(--swatch-3-mineral)' : 'var(--border-subtle)'}`,
                boxShadow: 'var(--shadow-subtle)',
                padding: '9px 11px',
                cursor: 'pointer',
                transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}
              onClick={() => {
                if (onSelectAgent) onSelectAgent(agent.id);
                setExpandedAgent(isExpanded ? null : agent.id);
              }}
              onMouseOver={e => {
                if (!isSelected) {
                  e.currentTarget.style.borderColor = 'var(--swatch-3-mineral)';
                  e.currentTarget.style.backgroundColor = '#F8FAFA';
                }
              }}
              onMouseOut={e => {
                if (!isSelected) {
                  e.currentTarget.style.borderColor = 'var(--border-subtle)';
                  e.currentTarget.style.backgroundColor = '#FFFFFF';
                }
              }}
            >
              {/* Agent Main Row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: '5px',
                    background: '#EEF4F4',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid var(--border-subtle)'
                  }}>
                    {agent.icon}
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '12px', color: 'var(--text-primary)', lineHeight: 1.1 }}>
                      {agent.name}
                    </div>
                    <span style={{ fontSize: '9.5px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {agent.harness}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 800,
                    fontFamily: 'var(--font-mono)',
                    color: agent.confidence >= 95 ? '#0D7C66' : '#B76E00'
                  }}>
                    {agent.confidence}%
                  </span>
                  {isExpanded ? <ChevronUp size={12} color="var(--text-muted)" /> : <ChevronDown size={12} color="var(--text-muted)" />}
                </div>
              </div>

              {/* Real-time KPI Pills Bar */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                <div style={{
                  background: '#F8FAFA',
                  padding: '3px 5px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-subtle)',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    ACCURACY
                  </div>
                  <div style={{ fontSize: '10.5px', fontWeight: 800, color: 'var(--swatch-2-deep)', fontFamily: 'var(--font-mono)' }}>
                    {agent.accuracy}%
                  </div>
                </div>

                <div style={{
                  background: agent.hallucinationRate > 0.3 ? '#FFF8E6' : '#F8FAFA',
                  padding: '3px 5px',
                  borderRadius: '4px',
                  border: `1px solid ${agent.hallucinationRate > 0.3 ? '#FFE29A' : 'var(--border-subtle)'}`,
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '8px', color: agent.hallucinationRate > 0.3 ? '#B76E00' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    HALLUC.
                  </div>
                  <div style={{
                    fontSize: '10.5px',
                    fontWeight: 800,
                    color: agent.hallucinationRate > 0.3 ? '#B76E00' : '#0D7C66',
                    fontFamily: 'var(--font-mono)'
                  }}>
                    {agent.hallucinationRate}%
                  </div>
                </div>

                <div style={{
                  background: '#F8FAFA',
                  padding: '3px 5px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-subtle)',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    LATENCY
                  </div>
                  <div style={{ fontSize: '10.5px', fontWeight: 800, color: 'var(--swatch-3-mineral)', fontFamily: 'var(--font-mono)' }}>
                    {agent.avgLatency}
                  </div>
                </div>
              </div>

              {/* Collapsible Deep Telemetry Inspector */}
              {isExpanded && (
                <div style={{
                  marginTop: '4px',
                  paddingTop: '8px',
                  borderTop: '1px dashed var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '5px',
                  fontSize: '10.5px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Layer Classification:</span>
                    <span style={{ fontWeight: 700, color: 'var(--swatch-2-deep)' }}>{agent.category}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Processed Evaluations:</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{agent.evaluations.toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>KS Drift Coefficient:</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#0D7C66', fontWeight: 700 }}>{agent.drift} (Stable)</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Quorum Vote Weight:</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>1.0x Full Quorum</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
