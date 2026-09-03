import React, { useState, useRef, useEffect } from 'react';
import {
  Layers,
  Cpu,
  Server,
  Database,
  Radio,
  Lock,
  Code2,
  ShieldCheck,
  Brain,
  Zap,
  Activity,
  CheckCircle2,
  Sparkles,
  Info,
  ChevronRight,
  ShieldAlert,
  Vote,
  FileCheck
} from 'lucide-react';
import { animate, stagger } from '../lib/animeUtils';

const NODE_DETAILS = {
  client: {
    title: 'Client / Card Member / CSR / Admin',
    layer: 'Ingress Interface',
    description: 'Multi-channel access points (Mobile App, Web Banking, CSR Agent Portal, and Automated Batch API).',
    tech: 'React 19, Vite, Tailwind Tokens, WebSockets',
    latency: '< 5ms',
    security: 'TLS 1.3, PKCE Auth, Mutual TLS'
  },
  gateway: {
    title: 'API Gateway & Rate Limiter',
    layer: 'Perimeter Defense',
    description: 'Enforces JWT signature verification, IP rate limiting, token-bucket throttling, and payload sanitization.',
    tech: 'FastAPI, Redis Token Bucket, Argon2',
    latency: '1.8ms',
    security: 'JWT (RS256) + RBAC Scope Validation'
  },
  orchestrator: {
    title: 'AI Agent Orchestrator (LangGraph Engine)',
    layer: 'MoE Dispatch & Graph Routing',
    description: 'Stateful directed acyclic graph (DAG) routing engine that broadcasts transaction context in parallel across 6 specialized LLM experts.',
    tech: 'LangGraph, AsyncIO, PyTorch Embeddings',
    latency: '8.4ms',
    security: 'Isolated Context Windows + Zero Data Leakage'
  },
  identity: {
    title: 'Identity & KYC Agent',
    layer: 'Expert Domain (MoE)',
    description: 'Evaluates behavioral biometrics, device fingerprints, velocity of credential changes, and biometric matching scores.',
    tech: 'Qwen 2.5 / Ollama + Cosine Similarity Vectors',
    latency: '120ms',
    security: 'Biometric Hash Hashing'
  },
  fraud: {
    title: 'Fraud Hunter Agent',
    layer: 'Expert Domain (MoE)',
    description: 'Screens against darknet threat feeds, proxy/VPN networks, geolocation teleportation, and historical card-not-present velocity.',
    tech: 'Graph Neural Networks + SHAP Tree Explainer',
    latency: '145ms',
    security: 'Darknet IP Intel + Threat Feed Cache'
  },
  risk: {
    title: 'Risk Analyst Agent',
    layer: 'Expert Domain (MoE)',
    description: 'Quantifies balance exposure, portfolio risk limits, credit utilization variance, and cross-border currency volatility.',
    tech: 'Monte Carlo Exposure Sim + Quant Risk Models',
    latency: '110ms',
    security: 'Real-time Credit Matrix'
  },
  compliance: {
    title: 'Compliance & AML Agent',
    layer: 'Expert Domain (MoE)',
    description: 'Performs automated sanctions screening (OFAC, FinCEN), AML transaction structuring detection, and PEP verification.',
    tech: 'Vector Similarity RAG over OFAC/FinCEN Lists',
    latency: '130ms',
    security: 'Immutable Sanction Hash Validation'
  },
  policy: {
    title: 'Policy Guard Agent',
    layer: 'Expert Domain (MoE)',
    description: 'Enforces card tier spend limits, authorized merchant category codes (MCC), weekend transaction restrictions, and geo-fencing.',
    tech: 'Deterministic Rules + LLM Fuzzy Context Matching',
    latency: '95ms',
    security: 'Deterministic Policy Enforcement'
  },
  explainability: {
    title: 'Audit Scribe & Explainability Agent',
    layer: 'Expert Domain (MoE)',
    description: 'Synthesizes plain-English rationales with SHAP feature attribution weights to guarantee regulatory transparency (FCRA / GDPR Article 22).',
    tech: 'TreeSHAP + Multi-Agent Synthesis Engine',
    latency: '160ms',
    security: 'Cryptographic Decision Signatures'
  },
  consensus: {
    title: 'Consensus Decision Quorum Engine (MoE)',
    layer: 'Decentralized Consensus',
    description: 'Weighted majority voting mechanism with dynamic confidence calibration. Prevents collective hallucination and single-expert failure.',
    tech: 'Bayesian Confidence Aggregator + Quorum Logic',
    latency: '12ms',
    security: '3/6 Quorum Supermajority Requirement'
  },
  governance: {
    title: 'Governance Layer (OPA Guardrails)',
    layer: 'Deterministic Safety Interceptor',
    description: 'Hard deterministic guardrails that override any autonomous AI decisions if hard banking safety caps or legal sanctions are violated.',
    tech: 'Open Policy Agent (OPA) / Rego Engine',
    latency: '2.5ms',
    security: 'Zero-Tolerance Policy Hard Stops'
  },
  watchdog: {
    title: 'AI Watchdog Perimeter',
    layer: 'Continuous AI Alignment & Safety',
    description: 'Monitors real-time confidence drift, agent disagreement spikes, and synthetic adversarial attacks. Triggers self-healing or supervisor alerts.',
    tech: 'Drift Detection (KS-Test) + Anomaly Isolation',
    latency: '4.2ms',
    security: 'Autonomous Circuit Breaker'
  },
  ledger: {
    title: 'Immutable Audit Ledger & Explainability',
    layer: 'Data & Compliance Ledger',
    description: 'Cryptographically signed decision ledger storing full agent voting transcripts, feature importance matrices, and supervisor overrides.',
    tech: 'PostgreSQL + Merkle Tree Decision Signatures',
    latency: '15ms',
    security: 'SHA-256 Chained Hash Trail'
  }
};

export default function Architecture() {
  const [selectedNode, setSelectedNode] = useState('consensus');
  const [activeTab, setActiveTab] = useState('full');
  const techGridRef = useRef(null);

  useEffect(() => {
    if (techGridRef.current) {
      animate(techGridRef.current.children, {
        opacity: [0, 1],
        translateY: [16, 0],
        delay: stagger(30, { start: 100 }),
        duration: 500,
        ease: 'outExpo'
      });
    }
  }, []);

  const detail = NODE_DETAILS[selectedNode] || NODE_DETAILS.consensus;

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Top Banner */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'linear-gradient(135deg, rgba(10, 27, 36, 0.95) 0%, rgba(13, 46, 55, 0.9) 100%)',
        padding: '16px 22px',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid rgba(125, 174, 170, 0.3)',
        boxShadow: '0 8px 24px rgba(10, 27, 36, 0.12)',
        color: '#FFFFFF'
      }}>
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
            <Layers size={18} />
          </div>
          <div>
            <h1 style={{ fontSize: 18, margin: 0, color: '#FFFFFF', letterSpacing: '-0.3px' }}>
              System Architecture & MoE Circuit Topology
            </h1>
            <p style={{ fontSize: 12, margin: '2px 0 0 0', color: '#CCD6D6' }}>
              Interactive neural dispatch topology of TrustVault multi-agent governance pipelines
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="pill-filter-group" style={{ background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)' }}>
            {[
              { id: 'full', label: 'Full Topology' },
              { id: 'moe', label: 'MoE Layer' },
              { id: 'gov', label: 'Governance Guardrails' }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                className={`pill-filter-btn ${activeTab === tab.id ? 'active' : ''}`}
                style={{
                  color: activeTab === tab.id ? '#0A1B24' : '#CCD6D6',
                  background: activeTab === tab.id ? '#FFFFFF' : 'transparent'
                }}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Circuit Stage + Live Inspector Panel (Asymmetrical Split) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(320px, 1fr)', gap: 16, alignItems: 'stretch' }}>
        {/* Interactive Neural SVG Canvas */}
        <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
          <div style={{
            position: 'absolute',
            top: 14,
            left: 18,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)'
          }}>
            <Sparkles size={13} color="var(--swatch-3-mineral)" />
            <span>CLICK ANY NODE TO INSPECT LIVE TELEMETRY</span>
          </div>

          <svg viewBox="0 0 900 810" style={{ width: '100%', maxWidth: 840, margin: '24px 0 0 0' }}>
            <defs>
              <linearGradient id="headerSpruceGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: '#0A1B24', stopOpacity: 1 }} />
                <stop offset="100%" style={{ stopColor: '#0D2E37', stopOpacity: 1 }} />
              </linearGradient>
              <linearGradient id="nodeMineralGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: '#0D2E37', stopOpacity: 1 }} />
                <stop offset="100%" style={{ stopColor: '#1E4D57', stopOpacity: 1 }} />
              </linearGradient>
              <linearGradient id="nodeMintGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: '#0D7C66', stopOpacity: 1 }} />
                <stop offset="100%" style={{ stopColor: '#056150', stopOpacity: 1 }} />
              </linearGradient>
              <filter id="softCardGlow">
                <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#0A1B24" floodOpacity="0.1" />
              </filter>
            </defs>

            {/* Circuit Flow Animation CSS */}
            <style>{`
              .animated-flow-line {
                stroke-dasharray: 6 6;
                animation: flowPulse 2s linear infinite;
              }
              @keyframes flowPulse {
                from { stroke-dashoffset: 24; }
                to { stroke-dashoffset: 0; }
              }
              .circuit-node {
                cursor: pointer;
                transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), filter 0.2s ease;
              }
              .circuit-node:hover {
                filter: brightness(1.06) drop-shadow(0 0 8px rgba(125, 174, 170, 0.6));
              }
              .selected-circuit-node {
                filter: drop-shadow(0 0 10px rgba(13, 124, 102, 0.8));
              }
            `}</style>

            {/* Layer 1: Client Ingress */}
            <g className={`circuit-node ${selectedNode === 'client' ? 'selected-circuit-node' : ''}`} onClick={() => setSelectedNode('client')}>
              <rect x="290" y="10" width="320" height="46" rx="8" fill="url(#headerSpruceGrad)" filter="url(#softCardGlow)" stroke={selectedNode === 'client' ? '#7DAEAA' : 'transparent'} strokeWidth="2" />
              <text x="450" y="38" textAnchor="middle" fill="#FFFFFF" fontSize="12.5" fontWeight="700">Client / Card Member / CSR / Admin</text>
            </g>

            {/* Line down */}
            <line x1="450" y1="56" x2="450" y2="82" stroke="#446E73" strokeWidth="2" className="animated-flow-line" />

            {/* Layer 2: API Gateway */}
            <g className={`circuit-node ${selectedNode === 'gateway' ? 'selected-circuit-node' : ''}`} onClick={() => setSelectedNode('gateway')}>
              <rect x="290" y="82" width="320" height="44" rx="8" fill="#FFFFFF" stroke={selectedNode === 'gateway' ? '#0D7C66' : '#446E73'} strokeWidth={selectedNode === 'gateway' ? '2' : '1.5'} filter="url(#softCardGlow)" />
              <text x="450" y="109" textAnchor="middle" fill="#0D2E37" fontSize="12" fontWeight="700">API Gateway (Auth + Token Bucket Limiting)</text>
            </g>

            <line x1="450" y1="126" x2="450" y2="152" stroke="#446E73" strokeWidth="2" className="animated-flow-line" />

            {/* Layer 3: Orchestrator */}
            <g className={`circuit-node ${selectedNode === 'orchestrator' ? 'selected-circuit-node' : ''}`} onClick={() => setSelectedNode('orchestrator')}>
              <rect x="230" y="152" width="440" height="50" rx="8" fill="url(#nodeMineralGrad)" stroke={selectedNode === 'orchestrator' ? '#7DAEAA' : 'transparent'} strokeWidth="2" filter="url(#softCardGlow)" />
              <text x="450" y="182" textAnchor="middle" fill="#FFFFFF" fontSize="13" fontWeight="700">AI Agent Orchestrator (LangGraph Engine)</text>
            </g>

            {/* Fan-out lines to MoE */}
            <line x1="330" y1="202" x2="160" y2="235" stroke="#446E73" strokeWidth="1.5" className="animated-flow-line" />
            <line x1="450" y1="202" x2="450" y2="235" stroke="#446E73" strokeWidth="1.5" className="animated-flow-line" />
            <line x1="570" y1="202" x2="740" y2="235" stroke="#446E73" strokeWidth="1.5" className="animated-flow-line" />

            {/* Layer 4: Context RAG Nodes */}
            <rect x="60" y="235" width="200" height="38" rx="6" fill="#F8FAFA" stroke="#CCD6D6" strokeWidth="1.2" />
            <text x="160" y="259" textAnchor="middle" fill="#0D2E37" fontSize="11" fontWeight="700">Identity Context Memory</text>

            <rect x="350" y="235" width="200" height="38" rx="6" fill="#F8FAFA" stroke="#CCD6D6" strokeWidth="1.2" />
            <text x="450" y="259" textAnchor="middle" fill="#0D2E37" fontSize="11" fontWeight="700">Knowledge RAG Vector Store</text>

            <rect x="640" y="235" width="200" height="38" rx="6" fill="#F8FAFA" stroke="#CCD6D6" strokeWidth="1.2" />
            <text x="740" y="259" textAnchor="middle" fill="#0D2E37" fontSize="11" fontWeight="700">Telemetry & Stream Context</text>

            <line x1="450" y1="273" x2="450" y2="300" stroke="#446E73" strokeWidth="2" className="animated-flow-line" />

            {/* Layer 5: Specialized Expert Domain Layer (MoE) */}
            <rect x="60" y="300" width="780" height="124" rx="10" fill="rgba(242, 246, 246, 0.75)" stroke="#446E73" strokeWidth="1.5" />
            <text x="450" y="322" textAnchor="middle" fill="#0D2E37" fontSize="11.5" fontWeight="800" letterSpacing="0.5px">
              SPECIALIZED EXPERT DOMAIN LAYER (Mixture of Experts)
            </text>

            {[
              { id: 'identity', x: 80, name: 'Identity & KYC', sub: 'Biometrics' },
              { id: 'fraud', x: 205, name: 'Fraud Hunter', sub: 'Darknet / GNN' },
              { id: 'risk', x: 330, name: 'Risk Analyst', sub: 'Exposure Sim' },
              { id: 'compliance', x: 455, name: 'Compliance', sub: 'OFAC / FinCEN' },
              { id: 'policy', x: 580, name: 'Policy Guard', sub: 'Spend Limits' },
              { id: 'explainability', x: 705, name: 'Audit Scribe', sub: 'TreeSHAP' },
            ].map(agent => (
              <g
                key={agent.id}
                className={`circuit-node ${selectedNode === agent.id ? 'selected-circuit-node' : ''}`}
                onClick={() => setSelectedNode(agent.id)}
              >
                <rect
                  x={agent.x}
                  y={336}
                  width="115"
                  height="56"
                  rx="6"
                  fill="#FFFFFF"
                  stroke={selectedNode === agent.id ? '#0D7C66' : '#CCD6D6'}
                  strokeWidth={selectedNode === agent.id ? '2' : '1'}
                  filter="url(#softCardGlow)"
                />
                <text x={agent.x + 57.5} y={358} textAnchor="middle" fill="#0A1B24" fontSize="10.5" fontWeight="800">
                  {agent.name}
                </text>
                <text x={agent.x + 57.5} y={374} textAnchor="middle" fill="#567980" fontSize="8.5" fontWeight="600">
                  {agent.sub}
                </text>
              </g>
            ))}

            <line x1="450" y1="424" x2="450" y2="450" stroke="#0D7C66" strokeWidth="2.5" className="animated-flow-line" />

            {/* Layer 6: Consensus Quorum Engine */}
            <g className={`circuit-node ${selectedNode === 'consensus' ? 'selected-circuit-node' : ''}`} onClick={() => setSelectedNode('consensus')}>
              <rect x="230" y="450" width="440" height="52" rx="8" fill="url(#nodeMintGrad)" filter="url(#softCardGlow)" stroke={selectedNode === 'consensus' ? '#A3DFD3' : 'transparent'} strokeWidth="2" />
              <text x="450" y="482" textAnchor="middle" fill="#FFFFFF" fontSize="13" fontWeight="800">Consensus Decision Quorum Engine (MoE Quorum)</text>
            </g>

            {/* Fan out to Triad: Governance, Watchdog, Human */}
            <line x1="330" y1="502" x2="160" y2="532" stroke="#B76E00" strokeWidth="1.5" className="animated-flow-line" />
            <line x1="450" y1="502" x2="450" y2="532" stroke="#DC2626" strokeWidth="1.5" className="animated-flow-line" />
            <line x1="570" y1="502" x2="740" y2="532" stroke="#0D7C66" strokeWidth="1.5" className="animated-flow-line" />

            {/* Governance, Watchdog, Human Cards */}
            <g className={`circuit-node ${selectedNode === 'governance' ? 'selected-circuit-node' : ''}`} onClick={() => setSelectedNode('governance')}>
              <rect x="60" y="532" width="200" height="54" rx="6" fill="#FFF8E6" stroke={selectedNode === 'governance' ? '#B76E00' : '#FFE29A'} strokeWidth="1.5" filter="url(#softCardGlow)" />
              <text x="160" y="555" textAnchor="middle" fill="#B76E00" fontSize="11.5" fontWeight="800">Governance Layer</text>
              <text x="160" y="572" textAnchor="middle" fill="#78350F" fontSize="9">OPA Hard Policies • Spend Caps</text>
            </g>

            <g className={`circuit-node ${selectedNode === 'watchdog' ? 'selected-circuit-node' : ''}`} onClick={() => setSelectedNode('watchdog')}>
              <rect x="350" y="532" width="200" height="54" rx="6" fill="#FEF2F2" stroke={selectedNode === 'watchdog' ? '#DC2626' : '#FECACA'} strokeWidth="1.5" filter="url(#softCardGlow)" />
              <text x="450" y="555" textAnchor="middle" fill="#DC2626" fontSize="11.5" fontWeight="800">AI Watchdog Perimeter</text>
              <text x="450" y="572" textAnchor="middle" fill="#991B1B" fontSize="9">Drift Detection • Chaos Defense</text>
            </g>

            <g className="circuit-node">
              <rect x="640" y="532" width="200" height="54" rx="6" fill="#E8F3F5" stroke="#A3DFD3" strokeWidth="1.5" filter="url(#softCardGlow)" />
              <text x="740" y="555" textAnchor="middle" fill="#0D2E37" fontSize="11.5" fontWeight="800">Human Supervisor Escalation</text>
              <text x="740" y="572" textAnchor="middle" fill="#567980" fontSize="9">Manual Review • Override Audit</text>
            </g>

            {/* Merge down */}
            <line x1="160" y1="586" x2="450" y2="618" stroke="#B76E00" strokeWidth="1" opacity="0.6" />
            <line x1="450" y1="586" x2="450" y2="618" stroke="#DC2626" strokeWidth="1" opacity="0.6" />
            <line x1="740" y1="586" x2="450" y2="618" stroke="#0D7C66" strokeWidth="1" opacity="0.6" />

            {/* Layer 7: Ledger */}
            <g className={`circuit-node ${selectedNode === 'ledger' ? 'selected-circuit-node' : ''}`} onClick={() => setSelectedNode('ledger')}>
              <rect x="180" y="618" width="540" height="44" rx="6" fill="#E6F5F2" stroke={selectedNode === 'ledger' ? '#0D7C66' : '#A3DFD3'} strokeWidth="1.5" filter="url(#softCardGlow)" />
              <text x="450" y="645" textAnchor="middle" fill="#0D7C66" fontSize="12" fontWeight="800">Immutable Audit Ledger & Explainability (SHA-256 Decision Ledger)</text>
            </g>

            <line x1="450" y1="662" x2="450" y2="688" stroke="#0D7C66" strokeWidth="1.5" className="animated-flow-line" />

            {/* Layer 8: Execution */}
            <rect x="180" y="688" width="540" height="40" rx="6" fill="#FFFFFF" stroke="#CCD6D6" strokeWidth="1" filter="url(#softCardGlow)" />
            <text x="450" y="713" textAnchor="middle" fill="#0A1B24" fontSize="11.5" fontWeight="700">Financial Execution (Card Settlement • ACH • Wire • Ledger Commit)</text>

            <line x1="450" y1="728" x2="450" y2="750" stroke="#446E73" strokeWidth="1" />

            {/* Layer 9: Databases */}
            <rect x="180" y="750" width="540" height="40" rx="6" fill="#F8FAFA" stroke="#CCD6D6" strokeWidth="1" />
            <text x="450" y="775" textAnchor="middle" fill="#567980" fontSize="11" fontWeight="600">PostgreSQL (Relational + Vectors) • Redis Cluster • WebSocket Broadcast</text>
          </svg>
        </div>

        {/* Node Live Inspector Drawer */}
        <div className="glass-card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12 }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--radius-sm)',
              background: '#EEF4F4',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--swatch-2-deep)'
            }}>
              <Info size={16} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700, textTransform: 'uppercase' }}>
                {detail.layer}
              </div>
              <h3 style={{ fontSize: 15, margin: 0, color: 'var(--text-primary)' }}>
                {detail.title}
              </h3>
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
              Subsystem Overview
            </label>
            <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, marginTop: 4 }}>
              {detail.description}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ background: '#F8FAFA', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                RUNTIME STACK & MODELS
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--swatch-2-deep)', marginTop: 2 }}>
                {detail.tech}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ background: '#F8FAFA', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                  BENCHMARK LATENCY
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#0D7C66', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  {detail.latency}
                </div>
              </div>

              <div style={{ background: '#F8FAFA', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                  SECURITY LEVEL
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--swatch-2-deep)', marginTop: 2 }}>
                  {detail.security}
                </div>
              </div>
            </div>
          </div>

          {/* Quick node selector buttons */}
          <div style={{ marginTop: 6, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
              Quick Select Subsystems
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {Object.keys(NODE_DETAILS).map(key => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedNode(key)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: selectedNode === key ? '#0D2E37' : '#F4F8F8',
                    color: selectedNode === key ? '#FFFFFF' : 'var(--text-secondary)',
                    border: `1px solid ${selectedNode === key ? '#0D2E37' : 'var(--border-subtle)'}`,
                    textTransform: 'capitalize'
                  }}
                >
                  {key}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Technology Stack Grid */}
      <div className="glass-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Code2 size={18} color="var(--swatch-2-deep)" />
          <h3 style={{ fontSize: 15, margin: 0, color: 'var(--text-primary)' }}>
            Enterprise Technology Architecture & Libraries
          </h3>
        </div>

        <div
          ref={techGridRef}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 12
          }}
        >
          {[
            { layer: 'Frontend UI/UX', tech: 'React 19 + Anime.js + Three.js', icon: <Code2 size={16} color="#0D2E37" /> },
            { layer: 'Backend Gateway', tech: 'FastAPI (Python 3.10+ Async)', icon: <Server size={16} color="#0D7C66" /> },
            { layer: 'Multi-Agent MoE', tech: 'LangGraph Quorum DAG', icon: <Cpu size={16} color="#446E73" /> },
            { layer: 'LLM Reasoning', tech: 'Qwen 2.5 / Ollama & OpenAI NIM', icon: <Brain size={16} color="#0D2E37" /> },
            { layer: 'Governance Engine', tech: 'Open Policy Agent (OPA) / Rego', icon: <ShieldCheck size={16} color="#B76E00" /> },
            { layer: 'Storage Ledger', tech: 'PostgreSQL + Merkle Hash Trails', icon: <Database size={16} color="#446E73" /> },
            { layer: 'Real-Time Bus', tech: 'Redis PubSub & WebSockets', icon: <Radio size={16} color="#0D7C66" /> },
            { layer: 'Cryptography', tech: 'JWT RS256 + Argon2 Password KDF', icon: <Lock size={16} color="#DC2626" /> },
          ].map(item => (
            <div
              key={item.layer}
              style={{
                padding: '12px 14px',
                background: '#F8FAFA',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                boxShadow: 'var(--shadow-subtle)',
                transition: 'all 0.18s ease'
              }}
              onMouseOver={e => {
                e.currentTarget.style.borderColor = 'var(--swatch-3-mineral)';
                e.currentTarget.style.backgroundColor = '#FFFFFF';
              }}
              onMouseOut={e => {
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
                e.currentTarget.style.backgroundColor = '#F8FAFA';
              }}
            >
              <div style={{
                width: 34,
                height: 34,
                borderRadius: 6,
                background: '#EEF4F4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                {item.icon}
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontWeight: 700 }}>
                  {item.layer}
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text-primary)' }}>
                  {item.tech}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
