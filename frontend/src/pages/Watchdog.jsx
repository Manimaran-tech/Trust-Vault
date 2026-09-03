import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
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
  RefreshCw,
  Gauge,
  Sliders,
  Sparkles,
  Play
} from 'lucide-react';
import { animate, stagger, animateCounter } from '../lib/animeUtils';

const renderAgentIcon = (name, size = 20) => {
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

export default function Watchdog() {
  const [alerts, setAlerts] = useState([]);
  const [health, setHealth] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [simulatingDrift, setSimulatingDrift] = useState(false);

  const gridRef = useRef(null);
  const alertsRef = useRef(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [alertData, healthData] = await Promise.all([
        api.getWatchdogAlerts(),
        api.getWatchdogHealth(),
      ]);
      setAlerts(alertData);
      const agents = healthData.agents || [];
      setHealth(agents);

      // Trigger Anime.js staggered entrance
      setTimeout(() => {
        if (gridRef.current) {
          animate(gridRef.current.children, {
            opacity: [0, 1],
            translateY: [20, 0],
            scale: [0.96, 1],
            delay: stagger(60, { start: 100 }),
            duration: 600,
            ease: 'outBack(1.4)'
          });
        }
      }, 50);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const handleSimulateDrift = () => {
    setSimulatingDrift(true);
    setTimeout(() => {
      const newAlert = {
        id: `drift-${Date.now()}`,
        severity: 'high',
        alert_type: 'CONFIDENCE_DRIFT_ANOMALY',
        agent_name: 'fraud',
        anomaly_score: 0.88,
        description: 'Simulated multi-agent drift: Disagreement spiked beyond 35% threshold on recent transaction evaluations.',
        created_at: new Date().toISOString()
      };
      setAlerts(prev => [newAlert, ...prev]);
      setSimulatingDrift(false);

      if (alertsRef.current) {
        animate(alertsRef.current, {
          scale: [0.98, 1],
          boxShadow: ['0 0 20px rgba(220, 38, 38, 0.4)', '0 0 0 transparent'],
          duration: 800,
          ease: 'outExpo'
        });
      }
    }, 1000);
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner" />
        <span>Synthesizing multi-agent health telemetry...</span>
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header Banner */}
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
            <Radio size={18} />
          </div>
          <div>
            <h1 style={{ fontSize: 18, margin: 0, color: '#FFFFFF', letterSpacing: '-0.3px' }}>
              Autonomous AI Watchdog Perimeter
            </h1>
            <p style={{ fontSize: 12, margin: '2px 0 0 0', color: '#CCD6D6' }}>
              Real-time MoE agent drift detection, alignment monitoring, and chaos immunity guardrails
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn btn-outline"
            onClick={handleSimulateDrift}
            disabled={simulatingDrift}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              background: 'rgba(255, 255, 255, 0.1)',
              color: '#FFFFFF',
              borderColor: 'rgba(255, 255, 255, 0.25)'
            }}
          >
            <Zap size={13} color="var(--accent-amber)" />
            <span>{simulatingDrift ? 'Simulating...' : 'Test Drift Alert'}</span>
          </button>

          <button
            className="btn btn-outline"
            onClick={loadData}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              background: 'rgba(255, 255, 255, 0.1)',
              color: '#FFFFFF',
              borderColor: 'rgba(255, 255, 255, 0.25)'
            }}
          >
            <RefreshCw size={12} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Agent Health Status Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={17} color="var(--swatch-3-mineral)" />
          <h3 style={{ fontSize: 15, margin: 0, color: 'var(--text-primary)' }}>
            MoE Expert Swarm Telemetry & Alignment Scores
          </h3>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className={`pill-filter-btn ${selectedAgent === null ? 'active' : ''}`}
            onClick={() => setSelectedAgent(null)}
          >
            All 6 Experts
          </button>
        </div>
      </div>

      {/* Agents Grid with Glassmorphic Surfaces */}
      <div
        ref={gridRef}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 14
        }}
      >
        {health.map(agent => {
          const isSelected = selectedAgent === agent.agent_name;
          const avgConf = Math.round((agent.avg_confidence || 0) * 100);
          const disagreeRate = Math.round((agent.disagreement_rate || 0) * 100);

          return (
            <div
              key={agent.agent_name}
              className="glass-card"
              style={{
                padding: 18,
                cursor: 'pointer',
                borderColor: isSelected ? 'var(--swatch-3-mineral)' : 'rgba(68, 110, 115, 0.2)',
                background: isSelected ? 'rgba(232, 243, 245, 0.95)' : 'rgba(255, 255, 255, 0.9)'
              }}
              onClick={() => setSelectedAgent(isSelected ? null : agent.agent_name)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <div style={{
                  width: 42,
                  height: 42,
                  borderRadius: 'var(--radius-md)',
                  background: 'linear-gradient(135deg, #EEF4F4 0%, #E2ECEC 100%)',
                  border: '1px solid rgba(125, 174, 170, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(10, 27, 36, 0.05)'
                }}>
                  {renderAgentIcon(agent.agent_name)}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontWeight: 800, fontSize: 14, textTransform: 'capitalize', color: 'var(--text-primary)' }}>
                      {agent.agent_name}
                    </div>
                    <span className={`status-badge ${agent.status === 'active' ? 'approve' : agent.status === 'degraded' ? 'review' : 'deny'}`} style={{ fontSize: 9.5 }}>
                      {agent.status || 'ACTIVE'}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    MoE Quorum Weight: 1.0x
                  </span>
                </div>
              </div>

              {/* Metrics Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div style={{ background: '#F8FAFA', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: 9.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    AVG CONFIDENCE
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--swatch-2-deep)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                    {avgConf}%
                  </div>
                </div>

                <div style={{ background: '#F8FAFA', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: 9.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    EVALUATIONS
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', marginTop: 2 }}>
                    {agent.total_evaluations || 0}
                  </div>
                </div>

                <div style={{ background: '#F8FAFA', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: 9.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    DISAGREEMENT
                  </div>
                  <div style={{
                    fontSize: 18,
                    fontWeight: 800,
                    fontFamily: 'var(--font-mono)',
                    color: disagreeRate > 30 ? 'var(--status-review)' : 'var(--status-approve)',
                    marginTop: 2
                  }}>
                    {disagreeRate}%
                  </div>
                </div>

                <div style={{ background: '#F8FAFA', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: 9.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    ANOMALY ALERTS
                  </div>
                  <div style={{
                    fontSize: 18,
                    fontWeight: 800,
                    fontFamily: 'var(--font-mono)',
                    color: agent.recent_alerts > 0 ? 'var(--status-deny)' : 'var(--text-primary)',
                    marginTop: 2
                  }}>
                    {agent.recent_alerts || 0}
                  </div>
                </div>
              </div>

              {/* Mini animated gauge bar */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
                  <span>ALIGNMENT INTEGRITY</span>
                  <span>{avgConf}%</span>
                </div>
                <div style={{ height: 5, borderRadius: 3, background: '#DCE5E5', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    borderRadius: 3,
                    width: `${Math.max(avgConf, 8)}%`,
                    background: avgConf > 70 ? 'var(--status-approve)' : avgConf > 40 ? 'var(--status-review)' : 'var(--status-deny)',
                    transition: 'width 0.8s cubic-bezier(0.16, 1, 0.3, 1)'
                  }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Anomaly Alerts Section */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <ShieldAlert size={17} color="var(--accent-crimson)" />
        <h3 style={{ fontSize: 15, margin: 0, color: 'var(--text-primary)' }}>
          Anomaly Alerts & Chaos Defense Feed
        </h3>
      </div>

      <div ref={alertsRef} className="glass-card">
        {alerts.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {alerts.map((alert, idx) => (
              <div
                key={alert.id || idx}
                style={{
                  padding: '14px 16px',
                  borderRadius: 'var(--radius-md)',
                  background: alert.severity === 'critical' ? '#FEF2F2' : alert.severity === 'high' ? '#FFF8E6' : '#F9FBFA',
                  border: `1px solid ${alert.severity === 'critical' ? '#FECACA' : alert.severity === 'high' ? '#FFE29A' : 'var(--border-subtle)'}`,
                  boxShadow: 'var(--shadow-subtle)',
                  transition: 'all 0.2s ease'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className={`status-badge ${alert.severity === 'critical' ? 'deny' : alert.severity === 'high' ? 'review' : 'approve'}`}>
                      {alert.severity}
                    </span>
                    <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 700 }}>
                      {alert.alert_type}
                    </span>
                    {alert.agent_name && (
                      <span style={{ fontSize: 12, textTransform: 'capitalize', color: 'var(--swatch-2-deep)', fontWeight: 700 }}>
                        • {alert.agent_name}
                      </span>
                    )}
                  </div>

                  {alert.anomaly_score && (
                    <span style={{
                      fontSize: 12,
                      color: 'var(--status-deny)',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 800,
                      background: 'rgba(220, 38, 38, 0.1)',
                      padding: '2px 8px',
                      borderRadius: 4
                    }}>
                      Anomaly Score: {(alert.anomaly_score * 100).toFixed(0)}%
                    </span>
                  )}
                </div>

                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.5, margin: '8px 0 0 0' }}>
                  {alert.description}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            textAlign: 'center',
            color: 'var(--text-muted)',
            padding: 36,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10
          }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: '#E6F5F2',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-emerald)'
            }}>
              <CheckCircle2 size={22} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
              All Agents Operating Within Normal Parameters
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', maxWidth: 380, margin: 0 }}>
              Zero drift or consensus disagreements detected. Click "Test Drift Alert" above to verify the Watchdog response mechanism.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
