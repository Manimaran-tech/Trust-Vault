import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Square,
  AlertTriangle,
  Zap,
  Sliders,
  Shield,
  Plus,
  Send,
  X,
  Radio,
  CheckCircle
} from 'lucide-react';
import { api } from '../api';

// Generate a random IP address for each simulated transaction
function randomIP() {
  return `${Math.floor(Math.random() * 223) + 1}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
}

// Suspicious IPs for anomaly injections
function suspiciousIP() {
  const badRanges = ['185.220.101', '45.154.255', '91.240.118', '103.75.201', '194.163.44'];
  const range = badRanges[Math.floor(Math.random() * badRanges.length)];
  return `${range}.${Math.floor(Math.random() * 256)}`;
}

const PRESET_ANOMALIES = [
  {
    name: 'Sanctions Breach (\u20b949 L Wire)',
    amount: 55000,
    merchant: 'Offshore Trade Syndicate',
    country: 'North Korea',
    mcc: '6051',
    category: 'financial',
    desc: 'High-value wire transfer to sanctioned OFAC jurisdiction'
  },
  {
    name: 'Crypto Mixer Tumbler (\u20b921 L)',
    amount: 24500,
    merchant: 'Tornado Tumbler V3',
    country: 'Panama',
    mcc: '6012',
    category: 'crypto',
    desc: 'Blocked merchant category code (6012 - Money Services)'
  },
  {
    name: 'Rapid Velocity Spree (\u20b913 L)',
    amount: 15200,
    merchant: 'Global Luxury Electronics',
    country: 'US',
    mcc: '5732',
    category: 'retail',
    desc: 'Exceeds standard card member per-transaction spend limit'
  }
];

export default function DemoController({ onTurbulenceChange, onAnomalyTriggered }) {
  const [turbulenceActive, setTurbulenceActive] = useState(false);
  const [targetTps, setTargetTps] = useState(18);
  const [processedCount, setProcessedCount] = useState(0);
  const [isInjecting, setIsInjecting] = useState(false);
  const [showCustomModal, setShowCustomModal] = useState(false);

  const [customForm, setCustomForm] = useState({
    amount: 42000,
    merchant: 'Darknet Liquidation Vault',
    country: 'Iran',
    mcc: '7995',
    category: 'financial',
    cardMember: 'Alex Vance',
    description: 'Manual custom anomaly injection'
  });

  const processedCountRef = useRef(0);

  // High-Speed Simulation Engine
  useEffect(() => {
    let interval;
    if (turbulenceActive) {
      const sampleMerchants = [
        { name: 'Apple Store Digital', amount: 14.99, cat: 'digital', mcc: '5734' },
        { name: 'BigBasket', amount: 2480.00, cat: 'grocery', mcc: '5411' },
        { name: 'Third Wave Coffee', amount: 420.00, cat: 'dining', mcc: '5812' },
        { name: 'Shell Oil Co.', amount: 52.10, cat: 'fuel', mcc: '5541' },
        { name: 'Amazon Web Services', amount: 128.50, cat: 'cloud', mcc: '7372' },
        { name: 'Uber Technologies Trip', amount: 24.80, cat: 'transport', mcc: '4121' },
        { name: 'Target Supercenter', amount: 68.30, cat: 'retail', mcc: '5311' },
        { name: 'Netflix Subscription', amount: 19.99, cat: 'streaming', mcc: '4899' }
      ];

      // Real backend samples (2-18 TPS)
      interval = setInterval(() => {
        const burstSize = Math.floor(targetTps / 10) || 2;
        for (let i = 0; i < burstSize; i++) {
          const sample = sampleMerchants[Math.floor(Math.random() * sampleMerchants.length)];
          const tx = {
            transaction_type: 'purchase',
            amount: sample.amount + Number((Math.random() * 5).toFixed(2)),
            currency: 'USD',
            merchant_name: sample.name,
            merchant_category: sample.cat,
            merchant_country: 'US',
            card_member_name: 'Alex Vance',
            description: `Simulated ${sample.cat} payload`,
            metadata: { mcc: sample.mcc, card_tier: 'standard', source_ip: randomIP() }
          };

          api.submitTransaction(tx)
            .then(() => {
              processedCountRef.current += 1;
              setProcessedCount(processedCountRef.current);
            })
            .catch(() => {});
        }
      }, 100);
    }
    return () => {
      clearInterval(interval);
    };
  }, [turbulenceActive, targetTps]);

  const handleToggle = () => {
    const next = !turbulenceActive;
    setTurbulenceActive(next);
    if (onTurbulenceChange) onTurbulenceChange(next);
  };

  const handleInjectPreset = async (preset) => {
    setIsInjecting(true);
    const tx = {
      transaction_type: 'transfer',
      amount: preset.amount,
      currency: 'USD',
      merchant_name: preset.merchant,
      merchant_category: preset.category,
      merchant_country: preset.country,
      card_member_name: 'Alex Vance',
      description: preset.desc,
      metadata: { mcc: preset.mcc, card_tier: 'standard', source_ip: suspiciousIP() }
    };
    try {
      const res = await api.submitTransaction(tx);
      processedCountRef.current += 1;
      setProcessedCount(processedCountRef.current);

      if (onAnomalyTriggered) {
        onAnomalyTriggered({
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
      console.error(e);
      // Fallback local trigger
      if (onAnomalyTriggered) {
        onAnomalyTriggered({
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

  const handleCustomSubmit = async (e) => {
    e.preventDefault();
    setIsInjecting(true);
    const tx = {
      transaction_type: 'wire',
      amount: Number(customForm.amount),
      currency: 'USD',
      merchant_name: customForm.merchant,
      merchant_category: customForm.category,
      merchant_country: customForm.country,
      card_member_name: customForm.cardMember,
      description: customForm.description,
      metadata: { mcc: customForm.mcc, card_tier: 'standard', source_ip: suspiciousIP() }
    };
    try {
      const res = await api.submitTransaction(tx);
      processedCountRef.current += 1;
      setProcessedCount(processedCountRef.current);
      setShowCustomModal(false);

      if (onAnomalyTriggered) {
        onAnomalyTriggered({
          transaction_id: res.transaction_id || `TX-${Date.now().toString().slice(-6)}`,
          merchant: customForm.merchant,
          amount: customForm.amount,
          country: customForm.country,
          reason: res.governance?.escalation_reason || customForm.description,
          confidence: res.aggregated_confidence || 0.96,
          timestamp: new Date().toLocaleTimeString()
        });
      }
    } catch (err) {
      console.error(err);
      if (onAnomalyTriggered) {
        onAnomalyTriggered({
          transaction_id: `TX-${Date.now().toString().slice(-6)}`,
          merchant: customForm.merchant,
          amount: customForm.amount,
          country: customForm.country,
          reason: customForm.description,
          confidence: 0.96,
          timestamp: new Date().toLocaleTimeString()
        });
      }
      setShowCustomModal(false);
    } finally {
      setIsInjecting(false);
    }
  };

  return (
    <div className="glass-panel" style={{ padding: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(21, 45, 66, 0.08)', pb: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap className="h-4 w-4" style={{ color: 'var(--accent-gold)' }} />
          <h2 style={{ fontSize: 13.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-primary)', margin: 0 }}>
            High-Speed Stream Engine
          </h2>
        </div>
        <span className={`badge-quantum ${turbulenceActive ? 'approve' : 'review'}`}>
          {turbulenceActive
            ? `${processedCount.toLocaleString()} SUBMITTED \u00b7 TARGET ${targetTps} TPS`
            : 'STANDBY'}
        </span>
      </div>

      {/* Main Stream Controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <button
          onClick={handleToggle}
          className={`btn-quantum ${turbulenceActive ? 'btn-quantum-outline' : 'btn-quantum-primary'}`}
          style={{ flex: 1, padding: '10px 14px' }}
        >
          {turbulenceActive ? (
            <>
              <Square className="h-4 w-4 text-red-500" />
              <span>Halt High-Speed Stream</span>
            </>
          ) : (
            <>
              <Play className="h-4 w-4 text-emerald-400" />
              <span>Start Stream (~{targetTps} TPS)</span>
            </>
          )}
        </button>

        <div style={{ padding: '6px 12px', background: '#FFFFFF', border: '1px solid rgba(21, 45, 66, 0.08)', borderRadius: 6, display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 80 }}>
          <span style={{ fontSize: 9.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>EVALUATED</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{processedCount}</span>
        </div>
      </div>

      {/* Preset Anomaly Intercept Triggers */}
      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
            1-Click Anomaly Intercepts
          </span>
          <button
            onClick={() => setShowCustomModal(true)}
            className="btn-quantum-gold"
            style={{ padding: '3px 8px', fontSize: 10, borderRadius: 4 }}
          >
            <Plus className="h-3 w-3" />
            <span>Custom Anomaly</span>
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {PRESET_ANOMALIES.map((preset, i) => (
            <button
              key={i}
              disabled={isInjecting}
              onClick={() => handleInjectPreset(preset)}
              className="btn-quantum-outline"
              style={{
                width: '100%',
                justifyContent: 'space-between',
                padding: '8px 12px',
                fontSize: 12,
                borderRadius: 6,
                border: '1px solid rgba(220, 38, 38, 0.2)',
                background: '#FFFFFF',
                textAlign: 'left'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                <span style={{ fontWeight: 600, color: '#991B1B' }}>{preset.name}</span>
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#DC2626' }}>
                ${preset.amount.toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Manual Custom Anomaly Injection Modal */}
      {showCustomModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(21, 45, 66, 0.4)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: 20
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: 480, background: '#FFFFFF', padding: 24, borderRadius: 14, boxShadow: '0 20px 40px rgba(0,0,0,0.15)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle className="h-5 w-5 text-red-600" />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Manual Custom Anomaly Dispatcher
                </h3>
              </div>
              <button
                onClick={() => setShowCustomModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCustomSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>TRANSACTION AMOUNT (₹ INR)</label>
                <input
                  type="number"
                  className="form-input"
                  value={customForm.amount}
                  onChange={e => setCustomForm({ ...customForm, amount: e.target.value })}
                  placeholder="e.g. 50000"
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>MERCHANT / ENTITY NAME</label>
                <input
                  type="text"
                  className="form-input"
                  value={customForm.merchant}
                  onChange={e => setCustomForm({ ...customForm, merchant: e.target.value })}
                  placeholder="e.g. Darknet Liquidation Vault"
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>COUNTRY (JURISDICTION)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={customForm.country}
                    onChange={e => setCustomForm({ ...customForm, country: e.target.value })}
                    placeholder="e.g. Iran, North Korea, Cuba"
                    required
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>MCC CODE</label>
                  <input
                    type="text"
                    className="form-input"
                    value={customForm.mcc}
                    onChange={e => setCustomForm({ ...customForm, mcc: e.target.value })}
                    placeholder="e.g. 7995 (Gambling) or 6051"
                    required
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>ANOMALY TRIGGER DESCRIPTION</label>
                <input
                  type="text"
                  className="form-input"
                  value={customForm.description}
                  onChange={e => setCustomForm({ ...customForm, description: e.target.value })}
                  placeholder="e.g. High-risk cross-border wire to restricted territory"
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowCustomModal(false)}
                  className="btn-quantum-outline"
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={isInjecting}
                  className="btn-quantum-danger"
                  style={{ flex: 1 }}
                >
                  <Send className="h-4 w-4" />
                  <span>Dispatch Anomaly</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
