import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import {
  Fingerprint,
  ShieldAlert,
  BarChart3,
  Scale,
  FileCheck,
  Brain,
  Vote,
  Building2,
  FileText,
  ArrowLeft,
  Sparkles,
  Users
} from 'lucide-react';

const renderAgentIcon = (name) => {
  const size = 16;
  switch (name) {
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

export default function DecisionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [decision, setDecision] = useState(null);
  const [auditTrail, setAuditTrail] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDecision();
  }, [id]);

  const loadDecision = async () => {
    try {
      const data = await api.getDecisionDetail(id);
      setDecision(data);
      if (data.transaction_id) {
        const trail = await api.getAuditTrail(data.transaction_id);
        setAuditTrail(trail);
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  if (loading) return <div className="loading-container"><div className="spinner" /><span>Loading decision...</span></div>;
  if (!decision) return <div className="loading-container"><span>Decision not found</span></div>;

  const d = decision;

  return (
    <div className="fade-in">
      <div className="page-header">
        <button className="btn btn-outline" onClick={() => navigate(-1)} style={{ marginBottom: 12 }}>
          <ArrowLeft size={14} /> Back
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>Decision Detail</h1>
            <p>Transaction: {d.transaction_id?.slice(0, 8)}... • {d.processing_time_ms?.toFixed(0)}ms processing</p>
          </div>
          <span className={`status-badge ${d.final_decision}`} style={{ fontSize: 14, padding: '6px 18px' }}>
            {d.final_decision?.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Summary Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div className="glass-card">
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>CONFIDENCE</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--swatch-2-deep)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
            {(d.aggregated_confidence * 100).toFixed(0)}%
          </div>
        </div>
        <div className="glass-card">
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>AGENTS AGREED</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#0D7C66', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
            {(d.agent_verdicts || []).filter(v => v.decision === d.final_decision).length}/{(d.agent_verdicts || []).length}
          </div>
        </div>
        <div className="glass-card">
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>HUMAN APPROVAL</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: d.requires_human_approval ? '#B76E00' : '#0D7C66', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
            {d.requires_human_approval ? 'Required' : 'Not Required'}
          </div>
        </div>
        <div className="glass-card">
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>TRANSACTION AMOUNT</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
            ${d.transaction?.amount?.toLocaleString() || 'N/A'}
          </div>
        </div>
      </div>

      {/* Explainability */}
      {d.explainability_summary && (
        <div className="glass-card no-hover" style={{ marginBottom: 16, background: '#F8FAFA' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Sparkles size={14} color="var(--swatch-2-deep)" />
            <h3 style={{ fontSize: 13, margin: 0, textTransform: 'uppercase', color: 'var(--swatch-2-deep)', fontWeight: 800 }}>
              AI Explanation
            </h3>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
            {d.explainability_summary}
          </p>
        </div>
      )}

      {/* Agent Verdicts */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Users size={16} color="var(--swatch-2-deep)" />
        <h3 style={{ fontSize: 14, margin: 0, color: 'var(--text-primary)' }}>Agent Verdicts</h3>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 20 }}>
        {(d.agent_verdicts || []).map(v => (
          <div key={v.agent_name} className="glass-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 4, background: '#EEF4F4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {renderAgentIcon(v.agent_name)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ textTransform: 'capitalize', fontWeight: 800, fontSize: 12.5, color: 'var(--text-primary)' }}>{v.agent_name}</div>
                <span className={`status-badge ${v.decision}`} style={{ padding: '1px 6px', fontSize: 9.5 }}>
                  {v.decision} • {(v.confidence * 100).toFixed(0)}%
                </span>
              </div>
              {v.processing_time_ms && (
                <span style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{v.processing_time_ms.toFixed(0)}ms</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{v.reasoning}</div>
            {v.risk_flags?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                {v.risk_flags.map((f, i) => (
                  <span key={i} style={{ fontSize: 9.5, padding: '2px 5px', borderRadius: 3, background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>
                    {f}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Voting Breakdown */}
      {d.voting_breakdown && Object.keys(d.voting_breakdown).length > 0 && (
        <div className="glass-card no-hover" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <Vote size={15} color="var(--swatch-2-deep)" />
            <h3 style={{ fontSize: 14, margin: 0, color: 'var(--text-primary)' }}>Voting Breakdown</h3>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: '#F8FAFA' }}>
                <th style={{ padding: '6px 12px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>AGENT</th>
                <th style={{ padding: '6px 12px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>VOTE</th>
                <th style={{ padding: '6px 12px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>CONFIDENCE</th>
                <th style={{ padding: '6px 12px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>WEIGHT</th>
                <th style={{ padding: '6px 12px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>SCORE</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(d.voting_breakdown).map(([agent, data]) => (
                <tr key={agent} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '7px 12px', textTransform: 'capitalize', fontSize: 12, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                    {renderAgentIcon(agent)}
                    <span>{agent}</span>
                  </td>
                  <td style={{ padding: '7px 12px' }}><span className={`status-badge ${data.decision}`}>{data.decision}</span></td>
                  <td style={{ padding: '7px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{(data.confidence * 100).toFixed(0)}%</td>
                  <td style={{ padding: '7px 12px', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{data.weight}</td>
                  <td style={{ padding: '7px 12px', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{data.weighted_score?.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Governance Checks */}
      {d.governance_result?.checks && (
        <div className="glass-card no-hover" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <Building2 size={15} color="var(--swatch-2-deep)" />
            <h3 style={{ fontSize: 14, margin: 0, color: 'var(--text-primary)' }}>Governance Checks</h3>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: '#F8FAFA' }}>
                <th style={{ padding: '6px 12px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>CHECK</th>
                <th style={{ padding: '6px 12px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>RESULT</th>
                <th style={{ padding: '6px 12px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>DETAILS</th>
              </tr>
            </thead>
            <tbody>
              {d.governance_result.checks.map((check, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '7px 12px', textTransform: 'capitalize', fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>{check.check?.replace(/_/g, ' ')}</td>
                  <td style={{ padding: '7px 12px' }}>
                    <span className={`status-badge ${check.passed ? 'approve' : 'deny'}`}>
                      {check.passed ? 'PASS' : 'FAIL'}
                    </span>
                  </td>
                  <td style={{ padding: '7px 12px', fontSize: 12, color: 'var(--text-secondary)' }}>{check.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Audit Trail */}
      {auditTrail.length > 0 && (
        <div className="glass-card no-hover">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <FileText size={15} color="var(--swatch-2-deep)" />
            <h3 style={{ fontSize: 14, margin: 0, color: 'var(--text-primary)' }}>Audit Trail</h3>
          </div>
          <div style={{ maxHeight: 350, overflowY: 'auto' }}>
            {auditTrail.map((log) => (
              <div key={log.id} style={{
                display: 'flex', gap: 10, padding: '8px 0',
                borderBottom: '1px solid var(--border-subtle)'
              }}>
                <div style={{
                  width: 6, height: 6, borderRadius: '50%', marginTop: 6, flexShrink: 0,
                  background: log.severity === 'critical' ? 'var(--status-deny)'
                    : log.severity === 'warning' ? 'var(--status-review)' : 'var(--status-approve)'
                }} />
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{log.description}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                    {new Date(log.timestamp).toLocaleTimeString()} • {log.event_type}
                    {log.agent_name && ` • ${log.agent_name}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
