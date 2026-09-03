import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { ShieldAlert, Zap, Landmark, ShieldX, Fingerprint, Plus, Flame } from 'lucide-react';

// Generate suspicious IPs from known bad ranges
function suspiciousIP() {
  const badRanges = ['185.220.101', '45.154.255', '91.240.118', '103.75.201', '194.163.44'];
  const range = badRanges[Math.floor(Math.random() * badRanges.length)];
  return `${range}.${Math.floor(Math.random() * 256)}`;
}

const DEFAULT_ATTACK_SCENARIOS = [
  {
    name: 'Stolen Card — Geo Anomaly',
    category: 'GEO_ANOMALY',
    amount: 3200.00,
    merchant_name: 'Electronics Mega Store',
    merchant_country: 'Romania',
    iconType: 'geo',
    accentColor: '#DC2626',
    description: 'Sudden purchase from Bucharest while cardholder in SF'
  },
  {
    name: 'CNP Fraud — Velocity Attack',
    category: 'VELOCITY_BURST',
    amount: 499.99,
    merchant_name: 'Quick Gift Cards Online',
    merchant_country: 'United States',
    iconType: 'velocity',
    accentColor: '#B76E00',
    description: '7 rapid transactions in 4 minutes via proxy VPN'
  },
  {
    name: 'AML — Structuring Transfer',
    category: 'AML_STRUCTURING',
    amount: 9500.00,
    merchant_name: 'Cayman National Wire',
    merchant_country: 'Cayman Islands',
    iconType: 'aml',
    accentColor: '#446E73',
    description: 'Just below the ₹10 lakh FIU-IND cash reporting threshold'
  },
  {
    name: 'OFAC Sanctioned Entity',
    category: 'OFAC_SANCTION',
    amount: 2000.00,
    merchant_name: 'Trade Corp International',
    merchant_country: 'Iran',
    iconType: 'ofac',
    accentColor: '#DC2626',
    description: 'Beneficiary on OFAC SDN sanctions list'
  },
  {
    name: 'Darknet Tumbler Velocity',
    category: 'IP_MIXER',
    amount: 14500.00,
    merchant_name: 'Crypto Tumbler Direct',
    merchant_country: 'Unknown (Tor Exit)',
    iconType: 'darknet',
    accentColor: '#0D2E37',
    description: 'Unverified wallet transfer from Tor exit node'
  }
];

export default function AnomalyInjectionPanel() {
  const [scenarios, setScenarios] = useState(DEFAULT_ATTACK_SCENARIOS);
  const [loading, setLoading] = useState(false);
  const [injectedId, setInjectedId] = useState(null);

  useEffect(() => {
    loadScenarios();
  }, []);

  const loadScenarios = async () => {
    try {
      const data = await api.getScenarios();
      if (data && Array.isArray(data) && data.length > 0) {
        const anomalies = data.filter(s => 
          s.name?.includes('Fraud') || 
          s.name?.includes('AML') || 
          s.name?.includes('Stolen') || 
          s.name?.includes('Sanctioned')
        );
        if (anomalies.length > 0) {
          setScenarios(anomalies);
        }
      }
    } catch (err) {
      // Keep defaults
    }
  };

  const renderScenarioIcon = (scenario) => {
    const size = 15;
    const color = scenario.accentColor || '#DC2626';
    switch (scenario.iconType || scenario.category) {
      case 'geo':
      case 'GEO_ANOMALY':
        return <ShieldAlert size={size} color={color} />;
      case 'velocity':
      case 'VELOCITY_BURST':
        return <Zap size={size} color={color} />;
      case 'aml':
      case 'AML_STRUCTURING':
        return <Landmark size={size} color={color} />;
      case 'ofac':
      case 'OFAC_SANCTION':
        return <ShieldX size={size} color={color} />;
      case 'darknet':
      case 'IP_MIXER':
      default:
        return <Fingerprint size={size} color={color} />;
    }
  };

  const injectScenario = async (scenario) => {
    setLoading(true);
    setInjectedId(scenario.name);
    try {
      await api.submitTransaction({
        transaction_type: scenario.transaction_type || 'transfer',
        amount: scenario.amount,
        merchant_name: scenario.merchant_name,
        merchant_category: scenario.merchant_category || 'General',
        merchant_country: scenario.merchant_country || 'Unknown',
        card_member_name: scenario.card_member_name || 'Sarah Johnson',
        description: scenario.description,
        metadata: {
          ...(scenario.metadata || {
            ip_location: scenario.merchant_country,
            device: 'Anomalous Device',
            credit_limit: 25000,
            current_balance: 12000,
            account_standing: 'watch',
          }),
          source_ip: suspiciousIP()
        }
      });
    } catch (err) {
      console.error('Injection failed', err);
    } finally {
      setTimeout(() => {
        setLoading(false);
        setInjectedId(null);
      }, 600);
    }
  };

  const injectRandomAnomaly = async () => {
    setLoading(true);
    setInjectedId('custom');
    try {
      const randomAmount = (Math.random() * 45000 + 5000).toFixed(2);
      const payload = {
        transaction_type: 'transfer',
        amount: parseFloat(randomAmount),
        merchant_name: 'Darknet Tumbler Node #92',
        merchant_category: 'Crypto Wire',
        merchant_country: 'High-Risk Jurisdiction',
        card_member_name: 'Adversary Injection',
        description: 'Zero-Day Multi-Vector Fraud Attack',
        metadata: {
          ip_location: 'Pyongyang, NK (Proxy Tor)',
          device: 'Tor Browser v13.2',
          credit_limit: 5000,
          current_balance: 4800,
          account_standing: 'flagged',
          source_ip: suspiciousIP()
        }
      };
      await api.submitTransaction(payload);
    } catch (err) {
      console.error('Injection failed', err);
    } finally {
      setTimeout(() => {
        setLoading(false);
        setInjectedId(null);
      }, 600);
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '12px 14px' }}>
      {/* Header Ribbon */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '10px',
        paddingBottom: '8px',
        borderBottom: '1px solid var(--border-subtle)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '26px',
            height: '26px',
            borderRadius: '6px',
            background: 'rgba(220, 38, 38, 0.1)',
            border: '1px solid rgba(220, 38, 38, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-crimson)'
          }}>
            <Flame size={15} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '13px', fontWeight: '800', color: 'var(--text-primary)' }}>
              Threat Injection Center
            </h3>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              Adversarial Chaos Testing
            </span>
          </div>
        </div>
        <span style={{
          padding: '2px 8px',
          borderRadius: 'var(--radius-pill)',
          fontSize: '9.5px',
          fontWeight: '700',
          fontFamily: 'var(--font-mono)',
          backgroundColor: '#FEF2F2',
          color: '#DC2626',
          border: '1px solid #FECACA'
        }}>
          LIVE INJECTOR
        </span>
      </div>

      {/* Scenario List */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        flex: 1,
        overflowY: 'auto',
        paddingRight: '2px',
        maxHeight: '160px'
      }}>
        {scenarios.map((scenario, idx) => {
          const isThisInjected = injectedId === scenario.name;
          const accent = scenario.accentColor || '#DC2626';

          return (
            <button
              key={idx}
              onClick={() => injectScenario(scenario)}
              disabled={loading}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '7px 10px',
                backgroundColor: isThisInjected ? '#FEE2E2' : '#F9FBFA',
                border: `1px solid ${isThisInjected ? '#EF4444' : 'var(--border-subtle)'}`,
                borderLeft: `3.5px solid ${accent}`,
                borderRadius: '6px',
                cursor: loading ? 'wait' : 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
                boxShadow: '0 1px 3px rgba(10, 27, 36, 0.03)'
              }}
              onMouseOver={(e) => {
                if (!loading) {
                  e.currentTarget.style.backgroundColor = '#FFFFFF';
                  e.currentTarget.style.borderColor = accent;
                  e.currentTarget.style.boxShadow = '0 3px 10px rgba(10, 27, 36, 0.08)';
                }
              }}
              onMouseOut={(e) => {
                if (!loading) {
                  e.currentTarget.style.backgroundColor = isThisInjected ? '#FEE2E2' : '#F9FBFA';
                  e.currentTarget.style.borderColor = isThisInjected ? '#EF4444' : 'var(--border-subtle)';
                  e.currentTarget.style.boxShadow = '0 1px 3px rgba(10, 27, 36, 0.03)';
                }
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '4px',
                  background: '#EEF4F4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {renderScenarioIcon(scenario)}
                </div>
                <div>
                  <div style={{ fontWeight: '700', fontSize: '11.5px', color: 'var(--text-primary)' }}>
                    {scenario.name}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '1px' }}>
                    ${scenario.amount?.toLocaleString()} • {scenario.merchant_country || 'Unknown'}
                  </div>
                </div>
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: 'rgba(68, 110, 115, 0.08)',
                color: accent,
                fontSize: '9.5px',
                fontWeight: '700',
                fontFamily: 'var(--font-mono)'
              }}>
                <Zap size={9} />
                INJECT
              </div>
            </button>
          );
        })}
      </div>

      {/* Custom Trigger Button */}
      <button
        onClick={injectRandomAnomaly}
        disabled={loading}
        className="btn btn-danger"
        style={{
          marginTop: '8px',
          width: '100%',
          justifyContent: 'center',
          padding: '8px 12px',
          fontSize: '11.5px',
          fontWeight: '700'
        }}
      >
        <Plus size={14} strokeWidth={2.5} />
        Inject Custom Zero-Day Threat
      </button>
    </div>
  );
}
