import React, { useState } from 'react';
import { ShieldCheck, ShieldAlert, Check, X, Bot } from 'lucide-react';

export default function HumanInterventionPanel({ activeAnomaly, onResolve }) {
  const [loading, setLoading] = useState(false);

  if (!activeAnomaly) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '16px'
      }}>
        <div style={{
          width: '38px',
          height: '38px',
          borderRadius: '10px',
          background: 'rgba(13, 124, 102, 0.1)',
          border: '1px solid rgba(13, 124, 102, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--accent-emerald)',
          marginBottom: '8px',
          boxShadow: '0 2px 10px rgba(13, 124, 102, 0.12)'
        }}>
          <ShieldCheck size={20} />
        </div>
        <h3 style={{ margin: 0, fontSize: '13.5px', fontWeight: '800', color: 'var(--text-primary)' }}>
          Autonomous Perimeter Nominal
        </h3>
        <p style={{ margin: '4px 0 8px 0', fontSize: '11px', color: 'var(--text-muted)', maxWidth: '280px', lineHeight: '1.35' }}>
          All 6 AI experts are executing consensus quorum. No supervisor escalations pending.
        </p>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '3px 9px',
          borderRadius: 'var(--radius-pill)',
          backgroundColor: '#E6F5F2',
          border: '1px solid #A3DFD3',
          fontSize: '10px',
          fontWeight: '700',
          fontFamily: 'var(--font-mono)',
          color: '#0D7C66'
        }}>
          <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#0D7C66', display: 'inline-block' }} />
          QUORUM 6/6 ENGAGED
        </div>
      </div>
    );
  }

  const handleAction = async (action) => {
    setLoading(true);
    await onResolve(activeAnomaly.transaction_id, action);
    setLoading(false);
  };

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      border: '1.5px solid #EF4444',
      borderRadius: 'var(--radius-lg)',
      background: '#FEF2F2',
      overflow: 'hidden'
    }}>
      {/* Alert Header */}
      <div style={{
        background: 'linear-gradient(135deg, #0A1B24 0%, #0D2E37 40%, #B91C1C 100%)',
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid rgba(239, 68, 68, 0.3)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldAlert size={16} color="#FCA5A5" />
          <div>
            <div style={{ fontSize: '11.5px', fontWeight: '800', letterSpacing: '0.3px', color: '#FFFFFF', textTransform: 'uppercase' }}>
              Supervisor Escalation
            </div>
            <div style={{ fontSize: '9px', color: 'var(--swatch-4-mint)', fontFamily: 'var(--font-mono)' }}>
              FLAGGED TX: {activeAnomaly.transaction_id}
            </div>
          </div>
        </div>
        <span style={{
          backgroundColor: 'rgba(239, 68, 68, 0.3)',
          padding: '2px 7px',
          borderRadius: '4px',
          fontSize: '9px',
          fontWeight: '800',
          fontFamily: 'var(--font-mono)',
          color: '#FFFFFF',
          border: '1px solid rgba(248, 113, 113, 0.4)'
        }}>
          GOVERNOR HOLD
        </span>
      </div>

      {/* Content */}
      <div style={{ padding: '10px 12px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Metric Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div style={{ background: '#FFFFFF', border: '1px solid #FECACA', padding: '6px 8px', borderRadius: '6px' }}>
            <div style={{ fontSize: '9px', color: '#7F1D1D', fontWeight: '700', textTransform: 'uppercase' }}>Amount</div>
            <div style={{ fontSize: '15px', fontWeight: '800', color: '#DC2626' }}>
              ${activeAnomaly.amount?.toLocaleString() || '0.00'}
            </div>
          </div>
          <div style={{ background: '#FFFFFF', border: '1px solid #FECACA', padding: '6px 8px', borderRadius: '6px' }}>
            <div style={{ fontSize: '9px', color: '#7F1D1D', fontWeight: '700', textTransform: 'uppercase' }}>Beneficiary Entity</div>
            <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '1px' }}>
              {activeAnomaly.merchant || 'Flagged Entity'}
            </div>
          </div>
        </div>

        {/* AI Rationale Summary */}
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #FECACA',
          padding: '8px',
          borderRadius: '6px',
          display: 'flex',
          flexDirection: 'column',
          gap: '3px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Bot size={12} color="#0D2E37" />
            <span style={{ fontSize: '9.5px', fontWeight: '700', color: '#0D2E37', textTransform: 'uppercase' }}>
              Consensus Quorum Rationale
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '10.5px', color: '#450A0A', lineHeight: '1.35' }}>
            {activeAnomaly.explainability_summary || activeAnomaly.reason || "High velocity risk breach detected. Transaction deviates from standard cardholder baseline by >4.2 sigma with unverified geographic routing."}
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ padding: '8px 12px', background: '#FFFFFF', borderTop: '1px solid #FECACA', display: 'flex', gap: '8px' }}>
        <button
          onClick={() => handleAction('approve')}
          disabled={loading}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '6px 10px',
            backgroundColor: '#E6F5F2',
            border: '1px solid #0D7C66',
            borderRadius: '6px',
            color: '#0D7C66',
            fontWeight: '700',
            fontSize: '11px',
            cursor: loading ? 'wait' : 'pointer',
            transition: 'all 0.15s ease'
          }}
          onMouseOver={e => e.currentTarget.style.backgroundColor = '#D1FAE5'}
          onMouseOut={e => e.currentTarget.style.backgroundColor = '#E6F5F2'}
        >
          <Check size={13} strokeWidth={2.5} />
          Override & Approve
        </button>

        <button
          onClick={() => handleAction('deny')}
          disabled={loading}
          className="btn btn-danger"
          style={{ flex: 1, justifyContent: 'center', padding: '6px 10px', fontSize: '11px' }}
        >
          <X size={13} strokeWidth={2.5} />
          Block Transaction
        </button>
      </div>
    </div>
  );
}
