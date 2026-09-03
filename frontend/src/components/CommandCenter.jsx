import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal as TerminalIcon,
  Activity,
  CheckSquare,
  Zap,
  MessageSquare,
  Cpu,
  ShieldCheck,
  ShieldAlert,
  Check,
  X,
  Play,
  Square,
  Send,
  Plus
} from 'lucide-react';
import { api } from '../api';

const PRESET_ANOMALIES = [
  {
    name: 'Sanctions Breach (₹49 L Wire)',
    amount: 55000,
    merchant: 'Offshore Trade Syndicate',
    country: 'North Korea',
    mcc: '6051',
    category: 'financial',
    desc: 'High-value wire transfer to sanctioned OFAC jurisdiction'
  },
  {
    name: 'Crypto Mixer Tumbler (₹21 L)',
    amount: 24500,
    merchant: 'Tornado Tumbler V3',
    country: 'Panama',
    mcc: '6012',
    category: 'crypto',
    desc: 'Blocked merchant category code (6012 - Money Services)'
  },
  {
    name: 'Rapid Velocity Spree (₹13 L)',
    amount: 15200,
    merchant: 'Global Luxury Electronics',
    country: 'US',
    mcc: '5732',
    category: 'retail',
    desc: 'Exceeds standard card member per-transaction spend limit'
  }
];

export default function CommandCenter({
  events = [],
  metrics = {},
  inbox = [],
  onResolveAnomaly = () => {},
  onInjectAnomaly = () => {},
  selectedAgentId = null,
  onSelectAgent = () => {}
}) {
  const [activeTab, setActiveTab] = useState('terminal');
  const [autoMode, setAutoMode] = useState(true);
  const [terminalLogs, setTerminalLogs] = useState([]);
  const [chatMessages, setChatMessages] = useState([
    {
      sender: 'Michael (Watchdog)',
      text: 'Command Center connected. 6 AI banking experts are active at their desks.',
      time: '12:00:01'
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isInjecting, setIsInjecting] = useState(false);
  const terminalEndRef = useRef(null);

  // Auto-generate terminal logs from incoming events
  useEffect(() => {
    if (!events || events.length === 0) return;
    const latest = events[events.length - 1];

    let logText = '';
    const now = new Date().toLocaleTimeString();

    if (latest.type === 'transaction_received') {
      logText = `[INGRESS] Ingress packet #${latest.data?.transaction_id || 'TX'}: $${latest.data?.amount} at ${latest.data?.merchant || 'Entity'} (MCC: ${latest.data?.mcc || '5411'})`;
    } else if (latest.type === 'expert_started') {
      logText = `[EVAL] Expert [${latest.data?.agent?.toUpperCase()}] analyzing domain vectors... [latency: ~${Math.floor(Math.random() * 25 + 12)}ms]`;
    } else if (latest.type === 'expert_finished') {
      const isApprove = latest.data?.decision === 'approve';
      logText = `[RESULT] Expert [${latest.data?.agent?.toUpperCase()}] returned ${latest.data?.decision?.toUpperCase()} (conf: ${(latest.data?.confidence * 100).toFixed(0)}%) [${isApprove ? 'APPROVED' : 'FLAGGED'}]`;
    } else if (latest.type === 'decision_made') {
      logText = `[CONSENSUS] Verdict: ${latest.data?.decision?.toUpperCase()} | Weight Conf: ${(latest.data?.confidence * 100).toFixed(0)}% | Humans Needed: ${latest.data?.requires_human ? 'YES' : 'NO'}`;
    } else if (latest.type === 'human_resolved') {
      logText = `[OVERRIDE] Human supervisor executed: ${latest.data?.decision?.toUpperCase()} for ${latest.data?.transaction_id}`;
    }

    if (logText) {
      setTerminalLogs(prev => [...prev.slice(-50), { text: logText, time: now, type: latest.type }]);
    }
  }, [events]);

  // Scroll terminal
  useEffect(() => {
    if (activeTab === 'terminal' && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLogs, activeTab]);

  // Auto-stream logger
  useEffect(() => {
    let interval;
    if (autoMode) {
      const sampleMerchants = [
        { name: 'Apple Store Digital', amount: 14.99, cat: 'digital', mcc: '5734' },
        { name: 'BigBasket', amount: 2480.00, cat: 'grocery', mcc: '5411' },
        { name: 'Third Wave Coffee', amount: 420.00, cat: 'dining', mcc: '5812' },
        { name: 'Shell Fuel Corp', amount: 48.50, cat: 'fuel', mcc: '5541' },
        { name: 'Amazon Web Services India', amount: 118400.00, cat: 'cloud', mcc: '7372' },
        { name: 'Uber Technologies', amount: 28.30, cat: 'transport', mcc: '4121' }
      ];

      const agentDecisions = [
        '[IdentityExpert]   Validating biometric hash... OK (99.8%) [PASS]',
        '[FraudExpert]      Velocity normal. No darknet exit nodes detected [PASS]',
        '[RiskExpert]       Exposure delta: +0.02. Within Tier-1 card limits [PASS]',
        '[ComplianceOPA]    OFAC Sanctions: COMPLIANT [PASS]',
        '[PolicyGuard]      Card spend cap verified. Approved [PASS]',
        '[Explainability]   Cryptographic attestation signed to audit roll [LOGGED]',
        '[ConsensusEngine]  Consensus Reached -> APPROVED (6/6 Quorum, 98% Conf)'
      ];

      let decisionStep = 0;

      interval = setInterval(() => {
        const now = new Date().toLocaleTimeString();
        const sample = sampleMerchants[Math.floor(Math.random() * sampleMerchants.length)];
        const amount = (sample.amount + Number((Math.random() * 3).toFixed(2))).toFixed(2);
        
        if (decisionStep % 7 === 0) {
          setTerminalLogs(prev => [
            ...prev.slice(-50),
            { text: `[INGRESS] #${Math.floor(Math.random() * 89999 + 10000)}: $${amount} at ${sample.name}`, time: now, type: 'transaction_received' }
          ]);
        } else {
          const stepText = agentDecisions[(decisionStep % 7) - 1];
          setTerminalLogs(prev => [
            ...prev.slice(-50),
            { text: stepText, time: now, type: 'eval' }
          ]);
        }

        decisionStep++;
      }, 1600);
    }
    return () => clearInterval(interval);
  }, [autoMode]);

  const handleSendChat = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userMsg = chatInput;
    setChatMessages(prev => [
      ...prev,
      { sender: 'You', text: userMsg, time: new Date().toLocaleTimeString() }
    ]);
    setChatInput('');

    setTimeout(() => {
      let reply = 'All 6 expert desks are operating at nominal latency (18ms).';
      const lower = userMsg.toLowerCase();
      if (lower.includes('anomaly') || lower.includes('flag')) {
        reply = 'Dwight (Fraud) and Pam (Compliance) monitor OFAC lists. Alerts appear in the Tasks inbox.';
      } else if (lower.includes('coffee') || lower.includes('pretzel')) {
        reply = 'Stanley says: Schrute Farms dark roast is ready in the break room.';
      }
      setChatMessages(prev => [
        ...prev,
        { sender: 'Watchdog MoE', text: reply, time: new Date().toLocaleTimeString() }
      ]);
    }, 500);
  };

  const handleInjectPreset = async (preset) => {
    setIsInjecting(true);
    try {
      const tx = {
        transaction_type: 'wire',
        amount: preset.amount,
        currency: 'USD',
        merchant_name: preset.merchant,
        merchant_category: preset.category,
        merchant_country: preset.country,
        card_member_name: 'Alex Vance',
        description: preset.desc,
        metadata: { mcc: preset.mcc, card_tier: 'standard' }
      };
      const res = await api.submitTransaction(tx);
      if (onInjectAnomaly) {
        onInjectAnomaly({
          transaction_id: res.transaction_id || `TX-${Date.now().toString().slice(-6)}`,
          merchant: preset.merchant,
          amount: preset.amount,
          country: preset.country,
          reason: res.governance?.escalation_reason || preset.desc,
          confidence: res.aggregated_confidence || 0.94,
          timestamp: new Date().toLocaleTimeString()
        });
      }
    } catch (e) {
      if (onInjectAnomaly) {
        onInjectAnomaly({
          transaction_id: `TX-${Date.now().toString().slice(-6)}`,
          merchant: preset.merchant,
          amount: preset.amount,
          country: preset.country,
          reason: preset.desc,
          confidence: 0.95,
          timestamp: new Date().toLocaleTimeString()
        });
      }
    } finally {
      setIsInjecting(false);
    }
  };

  return (
    <div className="command-center-box" style={{ height: 580, maxHeight: 580 }}>
      {/* Header */}
      <div className="command-center-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 18, height: 18, background: '#2B262D', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFDF7', fontSize: 10, fontWeight: 900 }}>
            ⌘
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.8px', color: '#2B262D' }}>
              COMMAND CENTER
            </div>
            <div style={{ fontSize: 9, color: '#57534E' }}>
              ● working Michael runs...
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <button
            onClick={() => setAutoMode(!autoMode)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: autoMode ? '#D5E8D4' : '#EFECE6',
              border: '1.5px solid #2B262D',
              borderRadius: 3,
              padding: '2px 6px',
              fontSize: 9.5,
              fontWeight: 800,
              cursor: 'pointer'
            }}
          >
            {autoMode ? <Square className="h-2.5 w-2.5" /> : <Play className="h-2.5 w-2.5" />}
            <span>{autoMode ? '▶ auto' : '⏸ pause'}</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="command-center-tabs">
        {[
          { id: 'terminal', label: '>_ terminal' },
          { id: 'monitor', label: 'monitor' },
          { id: 'tasks', label: `tasks (${inbox.length})` },
          { id: 'triggers', label: 'triggers' },
          { id: 'chat', label: 'assistant' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`cmd-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Body */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#1F2228', padding: 10 }}>
        {/* TAB 1: TERMINAL */}
        {activeTab === 'terminal' && (
          <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#A3BE8C', lineHeight: 1.5 }}>
            <div style={{ borderBottom: '1px solid #333842', paddingBottom: 4, marginBottom: 8, color: '#8892B0', display: 'flex', justifyContent: 'space-between' }}>
              <span>● Run py apy-god</span>
              <span>12ms • 2.8k tokens</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {terminalLogs.map((log, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 6 }}>
                  <span style={{ color: '#5C6370', flexShrink: 0 }}>[{log.time}]</span>
                  <span
                    style={{
                      color:
                        log.text.includes('ANOMALY') || log.text.includes('FLAGGED')
                          ? '#E06C75'
                          : log.text.includes('APPROVED') || log.text.includes('[PASS]')
                          ? '#98C379'
                          : log.text.includes('INGRESS')
                          ? '#61AFEF'
                          : '#ABB2BF'
                    }}
                  >
                    {log.text}
                  </span>
                </div>
              ))}
              <div ref={terminalEndRef} />
            </div>
          </div>
        )}

        {/* TAB 2: MONITOR */}
        {activeTab === 'monitor' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, color: '#FFFFFF', fontSize: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div style={{ background: '#282C34', border: '1px solid #3E4451', borderRadius: 4, padding: 8 }}>
                <div style={{ color: '#8892B0', fontSize: 8.5 }}>EVALUATED VOLUME</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#61AFEF', marginTop: 2 }}>
                  {metrics.total_transactions || 128}
                </div>
              </div>

              <div style={{ background: '#282C34', border: '1px solid #3E4451', borderRadius: 4, padding: 8 }}>
                <div style={{ color: '#8892B0', fontSize: 8.5 }}>APPROVAL RATE</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#98C379', marginTop: 2 }}>
                  {metrics.approval_rate || 98.4}%
                </div>
              </div>
            </div>

            <div style={{ background: '#282C34', border: '1px solid #3E4451', borderRadius: 4, padding: 8 }}>
              <div style={{ color: '#8892B0', fontSize: 8.5, marginBottom: 6 }}>EXPERT STATUS</div>
              {['Michael', 'Jim', 'Dwight', 'Pam', 'Kevin', 'Oscar', 'Alex'].map(n => (
                <div key={n} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <span>{n}</span>
                  <span style={{ color: '#98C379', fontWeight: 800 }}>● ONLINE (12ms)</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: TASKS / INBOX */}
        {activeTab === 'tasks' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {inbox.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 10px', color: '#5C6370', fontSize: 10.5 }}>
                <ShieldCheck className="h-8 w-8 text-emerald-500" style={{ margin: '0 auto 8px' }} />
                <div>Governance Perimeter Clear</div>
                <div style={{ fontSize: 9, marginTop: 4 }}>Trigger an anomaly from Triggers tab to test.</div>
              </div>
            ) : (
              inbox.map(item => (
                <div
                  key={item.transaction_id}
                  style={{
                    background: '#2C1B1E',
                    border: '1.5px solid #E06C75',
                    borderRadius: 4,
                    padding: 8,
                    fontSize: 10
                  }}
                >
                  <div style={{ color: '#E06C75', fontWeight: 900 }}>
                    ANOMALY: ${item.amount?.toLocaleString()}
                  </div>
                  <div style={{ color: '#ABB2BF', fontSize: 9, marginTop: 2 }}>
                    Entity: {item.merchant} ({item.country || 'Restricted'})
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button
                      onClick={() => onResolveAnomaly(item.transaction_id, 'approve')}
                      style={{ flex: 1, background: '#2E7D32', color: '#FFFFFF', border: 'none', padding: '4px', borderRadius: 3, fontSize: 9.5, fontWeight: 800, cursor: 'pointer' }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => onResolveAnomaly(item.transaction_id, 'deny')}
                      style={{ flex: 1, background: '#C62828', color: '#FFFFFF', border: 'none', padding: '4px', borderRadius: 3, fontSize: 9.5, fontWeight: 800, cursor: 'pointer' }}
                    >
                      Deny
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 4: TRIGGERS */}
        {activeTab === 'triggers' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, color: '#8892B0' }}>1-CLICK ANOMALY SUITE:</div>
            {PRESET_ANOMALIES.map((preset, i) => (
              <button
                key={i}
                disabled={isInjecting}
                onClick={() => handleInjectPreset(preset)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 8px',
                  background: '#282C34',
                  border: '1px solid #E06C75',
                  borderRadius: 3,
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: '#E06C75',
                  fontSize: 9.5,
                  fontWeight: 800
                }}
              >
                <span>{preset.name}</span>
                <span>${preset.amount.toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}

        {/* TAB 5: CHAT */}
        {activeTab === 'chat' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', maxHeight: 320 }}>
              {chatMessages.map((msg, i) => (
                <div key={i} style={{ background: '#282C34', border: '1px solid #3E4451', borderRadius: 4, padding: 6, fontSize: 9.5 }}>
                  <div style={{ color: '#61AFEF', fontSize: 8.5 }}>{msg.sender} [{msg.time}]</div>
                  <div style={{ color: '#ABB2BF', marginTop: 2 }}>{msg.text}</div>
                </div>
              ))}
            </div>

            <form onSubmit={handleSendChat} style={{ display: 'flex', gap: 4, marginTop: 8 }}>
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                placeholder="Ask Michael or team..."
                style={{ flex: 1, padding: '5px 8px', background: '#282C34', border: '1px solid #3E4451', borderRadius: 3, color: '#FFFFFF', fontSize: 9.5, fontFamily: 'monospace' }}
              />
              <button
                type="submit"
                style={{ background: '#3E4451', color: '#FFFFFF', border: 'none', borderRadius: 3, padding: '0 8px', cursor: 'pointer' }}
              >
                <Send className="h-3 w-3" />
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Input Bar matching screenshot */}
      <div className="cmd-input-bar">
        <span style={{ fontSize: 9, color: '#57534E', flex: 1 }}>
          Michael is busy - queue a message
        </span>
        <button style={{ background: '#D2CBC0', border: '1.5px solid #2B262D', borderRadius: 3, padding: '2px 5px', fontSize: 8.5, fontWeight: 800, cursor: 'pointer' }}>
          + files
        </button>
        <button style={{ background: '#D2CBC0', border: '1.5px solid #2B262D', borderRadius: 3, padding: '2px 5px', fontSize: 8.5, fontWeight: 800, cursor: 'pointer' }}>
          send →
        </button>
      </div>
    </div>
  );
}
