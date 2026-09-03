import React, { useState, useEffect } from 'react';
import { api } from '../api';
import {
  Zap,
  Flame,
  ShieldAlert,
  ShieldCheck,
  Check,
  X,
  Globe,
  AlertTriangle,
  Send,
  Plus,
  ShieldX,
  Target
} from 'lucide-react';
import { formatMoney } from '../lib/agentMap';

// Core testing vectors requested:
// 1. AI Auto-Reject Threat: Obvious violation (OFAC Sanctions) -> AI automatically blocks it (100% Deny)
// 2. Complex Threat: Ambiguous edge-case (AML Structuring) -> AI cannot decide, flags pending_human_review -> Holds in Human Queue
const THREAT_VECTORS = [
  {
    id: 'threat-auto-reject-ofac',
    type: 'auto_reject',
    name: '1. AI Auto-Reject Threat (Sanctions Violation)',
    category: 'OFAC_SANCTION',
    amount: 178000.00,
    merchant_name: 'Trade Corp International',
    merchant_country: 'Tehran, Iran',
    icon: <ShieldX size={16} color="#DC2626" />,
    targetAgents: ['Pam (OFAC SDN)', 'Michael (Governor)', 'Dwight (Fraud)'],
    accentColor: '#DC2626',
    description: 'Beneficiary destination in Tehran, Iran matches SDN international sanctions list. The AI Swarm detects this instantly and reaches unanimous consensus to REJECT.',
    riskLevel: 'CRITICAL',
    expectedOutcome: 'AI AUTO-DENIED (100% Cons.)',
    outcomeBadge: 'AI REJECT'
  },
  {
    id: 'threat-complex-human-aml',
    type: 'human_escalation',
    name: '2. Complex Threat (Sent to Human Hold Queue)',
    category: 'COMPLEX_ESCALATION',
    amount: 985000.00,
    merchant_name: 'Cayman National Wire Ltd',
    merchant_country: 'George Town, Cayman Islands',
    icon: <Target size={16} color="#B76E00" />,
    targetAgents: ['Pam (Sanctions/FIU)', 'Oscar (Audit)', 'Jim (Risk)'],
    accentColor: '#B76E00',
    description: 'Wire pegged at ₹9.85L to sit just under the ₹10L FIU CTR threshold with rotating proxy headers. The AI quorum flags ambiguity and safely holds it in the Human Queue.',
    riskLevel: 'AMBIGUOUS',
    expectedOutcome: 'PENDING HUMAN REVIEW',
    outcomeBadge: 'HOLD QUEUE'
  },
  {
    id: 'threat-darknet-mixer',
    type: 'auto_reject',
    name: 'Darknet Crypto Mixer Ingress',
    category: 'IP_MIXER',
    amount: 1290000.00,
    merchant_name: 'Crypto Tumbler Direct',
    merchant_country: 'Unknown (Tor Exit Node)',
    icon: <ShieldAlert size={16} color="#DC2626" />,
    targetAgents: ['Dwight (Darknet IP)', 'Jim (Exposure)', 'Watchdog'],
    accentColor: '#DC2626',
    description: 'Unverified high-velocity crypto mixer transfer originating from an untrusted Tor exit relay. AI detects malicious IP.',
    riskLevel: 'CRITICAL',
    expectedOutcome: 'AI AUTO-DENIED (98% Cons.)',
    outcomeBadge: 'AI REJECT'
  },
  {
    id: 'threat-geo-anomaly',
    type: 'human_escalation',
    name: 'Cross-Border Travel Anomaly',
    category: 'GEO_ANOMALY',
    amount: 285000.00,
    merchant_name: 'Electronics Mega Store',
    merchant_country: 'Bucharest, Romania',
    icon: <Globe size={16} color="#446E73" />,
    targetAgents: ['Dwight (Fraud)', 'Jim (Risk)', 'Alex (KYC)'],
    accentColor: '#446E73',
    description: 'Sudden high-value purchase from Romania while cardholder device was active in Bengaluru 10 minutes prior.',
    riskLevel: 'ELEVATED',
    expectedOutcome: 'PENDING HUMAN REVIEW',
    outcomeBadge: 'HOLD QUEUE'
  }
];

export default function OperationsWorkbench({
  pendingQueue = [],
  activeAnomaly = null,
  onResolveAnomaly = () => {},
}) {
  // Normalize queue: prioritize pendingQueue array, fallback to activeAnomaly
  const queue = pendingQueue && pendingQueue.length 
    ? pendingQueue 
    : (activeAnomaly ? [activeAnomaly] : []);

  const [activeTab, setActiveTab] = useState(queue.length ? 'human' : 'threats');
  const [loading, setLoading] = useState(false);
  const [injectedId, setInjectedId] = useState(null);
  const [showCustomModal, setShowCustomModal] = useState(false);

  // Custom simulation input
  const [customTx, setCustomTx] = useState({
    amount: 12500.00,
    merchant_name: 'Razorpay Merchant Settlement',
    merchant_country: 'India',
    merchant_category: 'E-Commerce'
  });

  // Switch to human tab automatically when an anomaly arrives in queue
  useEffect(() => {
    if (queue.length > 0 && activeTab !== 'human') {
      setActiveTab('human');
    }
  }, [queue.length]);

  const handleInjectThreat = (scenario) => {
    setLoading(true);
    setInjectedId(scenario.id);

    api.submitTransaction({
      transaction_type: 'transfer',
      amount: scenario.amount,
      merchant_name: scenario.merchant_name,
      merchant_category: scenario.category,
      merchant_country: scenario.merchant_country,
      card_member_name: 'Sarah Johnson',
      description: scenario.description,
      metadata: {
        ip_location: scenario.merchant_country,
        device: 'Anomalous Ingress Node',
        credit_limit: 25000,
        current_balance: 12000,
        account_standing: 'watch'
      }
    }).catch(err => console.error('Threat injection failed', err));

    setTimeout(() => {
      setLoading(false);
      setInjectedId(null);
      if (scenario.type === 'human_escalation') {
        setActiveTab('human');
      }
    }, 700);
  };

  const handleSendCustom = (e) => {
    if (e) e.preventDefault();
    setLoading(true);

    api.submitTransaction({
      transaction_type: 'purchase',
      amount: parseFloat(customTx.amount),
      merchant_name: customTx.merchant_name,
      merchant_category: customTx.merchant_category,
      merchant_country: customTx.merchant_country,
      card_member_name: 'Sarah Johnson',
      description: 'Custom ingress test transaction',
      metadata: { ip_location: customTx.merchant_country, device: 'Custom Ingress Node' }
    }).catch(err => console.error('Custom submit failed', err));

    setTimeout(() => {
      setShowCustomModal(false);
      setLoading(false);
    }, 600);
  };

  const handleAction = async (item, action) => {
    setLoading(true);
    await onResolveAnomaly(item, action);
    setLoading(false);
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: '#FFFFFF',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border-subtle)',
      boxShadow: 'var(--shadow-card)',
      overflow: 'hidden'
    }}>
      {/* 1. EXECUTIVE SEGMENTED CONSOLE HEADER */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        background: 'linear-gradient(135deg, #0A1B24 0%, #0D2E37 60%, #153A43 100%)',
        borderBottom: '1px solid rgba(125, 174, 170, 0.25)'
      }}>
        {/* Floating Capsule Tabs */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          background: 'rgba(10, 27, 36, 0.6)',
          padding: '3px',
          borderRadius: '8px',
          border: '1px solid rgba(125, 174, 170, 0.2)'
        }}>
          {/* TAB 1: THREAT INJECTION LAB */}
          <button
            onClick={() => setActiveTab('threats')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '6px',
              fontSize: '11.5px',
              fontWeight: '700',
              fontFamily: 'var(--font-mono)',
              border: '1px solid',
              borderColor: activeTab === 'threats' ? 'rgba(239, 68, 68, 0.45)' : 'transparent',
              cursor: 'pointer',
              backgroundColor: activeTab === 'threats' ? 'rgba(220, 38, 38, 0.25)' : 'transparent',
              color: activeTab === 'threats' ? '#FFFFFF' : '#CCD6D6',
              boxShadow: activeTab === 'threats' ? '0 0 10px rgba(239, 68, 68, 0.2)' : 'none',
              transition: 'all 0.16s ease'
            }}
          >
            <Flame size={13} color={activeTab === 'threats' ? '#FCA5A5' : '#CCD6D6'} />
            <span>INJECT THREAT</span>
          </button>

          {/* TAB 2: HUMAN ACTION & HOLDING QUEUE */}
          <button
            onClick={() => setActiveTab('human')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '6px',
              fontSize: '11.5px',
              fontWeight: '700',
              fontFamily: 'var(--font-mono)',
              border: '1px solid',
              borderColor: activeTab === 'human' ? (queue.length ? '#EF4444' : 'rgba(125, 174, 170, 0.45)') : 'transparent',
              cursor: 'pointer',
              backgroundColor: activeTab === 'human' ? (queue.length ? '#DC2626' : 'rgba(125, 174, 170, 0.22)') : 'transparent',
              color: '#FFFFFF',
              boxShadow: activeTab === 'human' ? '0 0 12px rgba(125, 174, 170, 0.2)' : 'none',
              transition: 'all 0.16s ease'
            }}
          >
            <ShieldAlert size={13} color={queue.length ? '#FFFFFF' : (activeTab === 'human' ? 'var(--swatch-4-mint)' : '#CCD6D6')} />
            <span>HUMAN ACTION</span>
            {queue.length > 0 && (
              <span style={{
                backgroundColor: '#FFFFFF',
                color: '#DC2626',
                borderRadius: '10px',
                padding: '0 6px',
                height: '16px',
                fontSize: '10px',
                fontWeight: '900',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginLeft: '4px'
              }}>
                {queue.length}
              </span>
            )}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            fontSize: '9.5px',
            fontFamily: 'var(--font-mono)',
            fontWeight: '700',
            color: 'var(--swatch-4-mint)',
            letterSpacing: '0.6px'
          }}>
            SOC LAB
          </span>
        </div>
      </div>

      {/* =========================================================================
          PANEL 1: THREAT INJECTION LAB
          ========================================================================= */}
      {activeTab === 'threats' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '16px', gap: '14px', overflowY: 'auto' }}>
          
          {/* Header Banner */}
          <div style={{
            background: 'linear-gradient(135deg, #F8FAFA 0%, #EFF6F6 100%)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: '800', color: 'var(--text-primary)' }}>
                Anomaly &amp; Threat Injector
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                Test multi-agent consensus defense: compare instant AI auto-rejection vs human escalation holding queue.
              </div>
            </div>
            <button
              onClick={() => setShowCustomModal(v => !v)}
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '5px 10px', whiteSpace: 'nowrap' }}
            >
              <Plus size={12} /> Custom Vector
            </button>
          </div>

          {/* Custom Ingress Modal */}
          {showCustomModal && (
            <div style={{
              padding: '14px',
              backgroundColor: '#F8FAFA',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}>
              <div style={{ fontSize: '12px', fontWeight: '800', color: 'var(--text-primary)' }}>
                Custom Ingress Payload
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)' }}>AMOUNT (₹)</label>
                  <input
                    type="number"
                    value={customTx.amount}
                    onChange={e => setCustomTx(prev => ({ ...prev, amount: e.target.value }))}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-subtle)', fontSize: '12px' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)' }}>MERCHANT / ENTITY</label>
                  <input
                    type="text"
                    value={customTx.merchant_name}
                    onChange={e => setCustomTx(prev => ({ ...prev, merchant_name: e.target.value }))}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-subtle)', fontSize: '12px' }}
                  />
                </div>
              </div>
              <button
                onClick={handleSendCustom}
                disabled={loading}
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', padding: '7px', fontSize: '11.5px', fontWeight: '700' }}
              >
                <Send size={12} /> Inject Custom Ingress Packet
              </button>
            </div>
          )}

          {/* Core Threat Cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {THREAT_VECTORS.map(sc => {
              const isInjectingThis = injectedId === sc.id;
              const isAutoReject = sc.type === 'auto_reject';

              return (
                <div
                  key={sc.id}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: isInjectingThis ? '#FEE2E2' : '#FFFFFF',
                    border: `1.5px solid ${isInjectingThis ? '#EF4444' : (isAutoReject ? '#FECACA' : '#FDE68A')}`,
                    boxShadow: 'var(--shadow-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '7px',
                    transition: 'all 0.16s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '6px',
                        backgroundColor: isAutoReject ? '#FEF2F2' : '#FFFBEB',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        {sc.icon}
                      </div>

                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '13px', fontWeight: '800', color: 'var(--text-primary)' }}>
                            {sc.name}
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleInjectThreat(sc)}
                      disabled={loading}
                      style={{
                        padding: '6px 14px',
                        borderRadius: '5px',
                        fontSize: '11px',
                        fontWeight: '800',
                        fontFamily: 'var(--font-mono)',
                        border: `1px solid ${isAutoReject ? '#FECACA' : '#FDE68A'}`,
                        backgroundColor: isInjectingThis 
                          ? (isAutoReject ? '#DC2626' : '#B76E00') 
                          : (isAutoReject ? '#FEF2F2' : '#FFFBEB'),
                        color: isInjectingThis 
                          ? '#FFFFFF' 
                          : (isAutoReject ? '#DC2626' : '#92400E'),
                        cursor: loading ? 'wait' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.15s ease',
                        boxShadow: '0 2px 6px rgba(10, 27, 36, 0.06)'
                      }}
                    >
                      <Zap size={12} />
                      {isInjectingThis ? 'INJECTED ✓' : `INJECT ${isAutoReject ? 'AI-REJECT' : 'HOLD-QUEUE'}`}
                    </button>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                    <span style={{ fontWeight: '800', color: 'var(--text-primary)' }}>
                      {formatMoney(sc.amount, 0, 'INR')} • {sc.merchant_country} • {sc.merchant_name}
                    </span>
                    <span style={{
                      fontSize: '9px',
                      fontWeight: '800',
                      padding: '1px 6px',
                      borderRadius: '3px',
                      backgroundColor: isAutoReject ? '#FEF2F2' : '#FFFBEB',
                      color: isAutoReject ? '#DC2626' : '#92400E',
                      border: `1px solid ${isAutoReject ? '#FECACA' : '#FDE68A'}`
                    }}>
                      EXPECTED: {sc.expectedOutcome}
                    </span>
                  </div>

                  <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                    {sc.description}
                  </p>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Targets:</span>
                    {sc.targetAgents?.map((t, idx) => (
                      <span key={idx} style={{ fontSize: '9px', background: '#F0F6F6', color: 'var(--swatch-2-deep)', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =========================================================================
          PANEL 2: HUMAN ACTION & SUPERVISOR HOLDING QUEUE
          ========================================================================= */}
      {activeTab === 'human' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '16px', gap: '12px', overflowY: 'auto' }}>
          {queue.length === 0 ? (
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '40px 16px'
            }}>
              <div style={{
                width: '52px',
                height: '52px',
                borderRadius: '12px',
                backgroundColor: '#E6F5F2',
                border: '1px solid #A3DFD3',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#0D7C66',
                marginBottom: '12px',
                boxShadow: '0 4px 16px rgba(13, 124, 102, 0.15)'
              }}>
                <ShieldCheck size={28} />
              </div>
              <h3 style={{ fontSize: '15px', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>
                Supervisor Holding Queue Clear
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '6px 0 16px 0', maxWidth: '340px', lineHeight: '1.5' }}>
                All transactions are actively verified by the autonomous AI quorum. No escalations currently waiting for supervisor review.
              </p>
              <button
                onClick={() => setActiveTab('threats')}
                className="btn btn-primary"
                style={{ fontSize: '11.5px', padding: '8px 16px' }}
              >
                <Flame size={13} /> Open Threat Lab to Inject Complex Case
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '12px' }}>
              {/* Queue Status Header */}
              <div style={{
                padding: '10px 14px',
                backgroundColor: '#FEF2F2',
                border: '1.5px solid #EF4444',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 4px 14px rgba(220, 38, 38, 0.12)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <AlertTriangle size={18} color="#DC2626" />
                  <div>
                    <span style={{ fontSize: '13px', fontWeight: '800', color: '#991B1B' }}>
                      SUPERVISOR HOLDING QUEUE ({queue.length} PENDING)
                    </span>
                    <div style={{ fontSize: '10.5px', color: '#B91C1C', fontFamily: 'var(--font-mono)' }}>
                      AI desk operates normally in background while these items await your decision
                    </div>
                  </div>
                </div>
                <span className="cyber-badge cyber-badge-crimson" style={{ fontSize: '9.5px' }}>
                  HOLD ACTIVE
                </span>
              </div>

              {/* List of Escalated Items in Queue */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {queue.map((item, idx) => (
                  <div
                    key={item.id || idx}
                    style={{
                      padding: '14px',
                      backgroundColor: '#F8FAFA',
                      border: '1px solid #FECACA',
                      borderRadius: 'var(--radius-md)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      boxShadow: 'var(--shadow-subtle)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                        {formatMoney(item.amount, 2, 'INR')}
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                        {item.merchant} ({item.merchant_country || 'Direct'})
                      </span>
                    </div>

                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      REF: #{item.id?.slice(0, 12)} • {item.isMarket ? 'Market Asset Order' : 'Ingress Transaction'}
                    </div>

                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-primary)', lineHeight: '1.45' }}>
                      {item.reason}
                    </p>

                    {item.explainability_summary && (
                      <div style={{
                        padding: '8px 10px',
                        backgroundColor: '#FFFFFF',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '4px',
                        fontSize: '11px',
                        color: 'var(--text-secondary)'
                      }}>
                        <strong>XAI Scribe:</strong> {item.explainability_summary}
                      </div>
                    )}

                    {/* Action Buttons for this item */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '6px' }}>
                      <button
                        onClick={() => handleAction(item, 'approve')}
                        disabled={loading}
                        className="btn btn-primary"
                        style={{ justifyContent: 'center', padding: '9px', fontSize: '11.5px', fontWeight: '800' }}
                      >
                        <Check size={14} /> APPROVE &amp; RELEASE
                      </button>
                      <button
                        onClick={() => handleAction(item, 'deny')}
                        disabled={loading}
                        className="btn btn-danger"
                        style={{ justifyContent: 'center', padding: '9px', fontSize: '11.5px', fontWeight: '800' }}
                      >
                        <X size={14} /> QUARANTINE &amp; BLOCK
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
