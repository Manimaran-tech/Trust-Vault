import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import {
  FileText,
  Filter,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Radio,
  Eye,
  ArrowUpRight,
  Sparkles,
  Zap,
  SlidersHorizontal,
  ChevronRight,
  X,
  Copy,
  Check
} from 'lucide-react';
import { animate, stagger, createTimer } from '../lib/animeUtils';

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ severity: '', event_type: '', search: '' });
  const [selectedLog, setSelectedLog] = useState(null);
  const [copiedId, setCopiedId] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const navigate = useNavigate();
  const tableRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    loadLogs();
  }, [filter.severity, filter.event_type]);

  // Auto-refresh using Anime.js timer
  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(() => {
        loadLogs(true);
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, filter]);

  const loadLogs = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = {};
      if (filter.severity) params.severity = filter.severity;
      if (filter.event_type) params.event_type = filter.event_type;
      const data = await api.getAuditLogs(params);
      setLogs(data);

      if (!silent && data.length > 0 && tableRef.current) {
        setTimeout(() => {
          if (tableRef.current) {
            animate(tableRef.current.querySelectorAll('tr'), {
              opacity: [0, 1],
              translateX: [-12, 0],
              delay: stagger(25),
              duration: 400,
              ease: 'outExpo'
            });
          }
        }, 50);
      }
    } catch (err) {
      console.error(err);
    }
    if (!silent) setLoading(false);
  };

  const filteredLogs = logs.filter(log => {
    if (!filter.search) return true;
    const q = filter.search.toLowerCase();
    return (
      log.description?.toLowerCase().includes(q) ||
      log.event_type?.toLowerCase().includes(q) ||
      log.agent_name?.toLowerCase().includes(q) ||
      log.transaction_id?.toLowerCase().includes(q)
    );
  });

  const copyToClipboard = (text) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 1500);
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Top Cyber Ribbon */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'linear-gradient(135deg, rgba(10, 27, 36, 0.95) 0%, rgba(13, 46, 55, 0.9) 100%)',
        padding: '16px 20px',
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
            <FileText size={18} />
          </div>
          <div>
            <h1 style={{ fontSize: 18, margin: 0, color: '#FFFFFF', letterSpacing: '-0.3px' }}>
              Immutable Cryptographic Audit Trail
            </h1>
            <p style={{ fontSize: 12, margin: '2px 0 0 0', color: '#CCD6D6' }}>
              Verifiable SHA-256 decision ledger and agent evaluation traces
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 'var(--radius-pill)',
              background: autoRefresh ? 'rgba(13, 124, 102, 0.25)' : 'rgba(255, 255, 255, 0.08)',
              border: `1px solid ${autoRefresh ? 'rgba(163, 223, 211, 0.5)' : 'rgba(255, 255, 255, 0.15)'}`,
              color: autoRefresh ? '#A3DFD3' : '#CCD6D6',
              fontSize: 11.5,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer'
            }}
          >
            <span className={`status-dot ${autoRefresh ? 'live' : 'offline'}`} />
            <span>{autoRefresh ? 'POLLING (5s)' : 'PAUSED'}</span>
          </button>

          <button
            className="btn btn-outline"
            onClick={() => loadLogs(false)}
            style={{ padding: '6px 12px', fontSize: 12, background: 'rgba(255, 255, 255, 0.1)', color: '#FFFFFF', borderColor: 'rgba(255, 255, 255, 0.2)' }}
          >
            <RefreshCw size={12} className={loading ? 'spinner' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Modern Filter & Search Console */}
      <div className="glass-card" style={{ padding: 14, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {/* Quick Severity Pills */}
          <div className="pill-filter-group">
            {[
              { id: '', label: 'All Severity' },
              { id: 'critical', label: '🔴 Critical' },
              { id: 'warning', label: '🟡 Warning' },
              { id: 'info', label: '🟢 Info' }
            ].map(item => (
              <button
                key={item.id}
                type="button"
                className={`pill-filter-btn ${filter.severity === item.id ? 'active' : ''}`}
                onClick={() => setFilter({ ...filter, severity: item.id })}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Event Filter Dropdown */}
          <select
            className="form-input"
            style={{ width: 'auto', padding: '6px 12px', fontSize: 12.5 }}
            value={filter.event_type}
            onChange={e => setFilter({ ...filter, event_type: e.target.value })}
          >
            <option value="">All Event Streams</option>
            <option value="transaction_received">Transaction Received</option>
            <option value="agent_evaluation">Agent Evaluation</option>
            <option value="consensus_reached">Consensus Reached</option>
            <option value="governance_check">Governance Check</option>
            <option value="governance_override">Governance Override</option>
            <option value="decision_final">Final Decision</option>
            <option value="watchdog_alert">Watchdog Alert</option>
          </select>
        </div>

        {/* Search Field */}
        <div style={{ position: 'relative', minWidth: 260 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            className="form-input"
            style={{ paddingLeft: 32, paddingRight: 10, paddingTop: 6, paddingBottom: 6, fontSize: 12.5 }}
            placeholder="Search hash, agent, description..."
            value={filter.search}
            onChange={e => setFilter({ ...filter, search: e.target.value })}
          />
        </div>
      </div>

      {/* Main Ledger Stage */}
      {loading && logs.length === 0 ? (
        <div className="loading-container">
          <div className="spinner" />
          <span>Synchronizing immutable ledger entries...</span>
        </div>
      ) : (
        <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
          {filteredLogs.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 160 }}>Timestamp</th>
                    <th style={{ width: 100 }}>Severity</th>
                    <th style={{ width: 170 }}>Event Type</th>
                    <th style={{ width: 130 }}>Agent / Subsystem</th>
                    <th>Audit Description</th>
                    <th style={{ width: 120 }}>TX Ledger Link</th>
                    <th style={{ width: 60 }}>Inspect</th>
                  </tr>
                </thead>
                <tbody ref={tableRef}>
                  {filteredLogs.map(log => (
                    <tr
                      key={log.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSelectedLog(log)}
                    >
                      <td style={{ fontSize: 11.5, whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 })}
                      </td>
                      <td>
                        <span className={`status-badge ${log.severity === 'critical' ? 'deny' : log.severity === 'warning' ? 'review' : 'approve'}`} style={{ fontSize: 10 }}>
                          {log.severity}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--swatch-2-deep)', fontWeight: 600 }}>
                          {log.event_type}
                        </span>
                      </td>
                      <td>
                        <span style={{
                          textTransform: 'capitalize',
                          fontSize: 12,
                          fontWeight: 700,
                          color: log.agent_name ? 'var(--text-primary)' : 'var(--text-muted)'
                        }}>
                          {log.agent_name || 'System'}
                        </span>
                      </td>
                      <td style={{ fontSize: 12.5, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                        {log.description}
                      </td>
                      <td>
                        {log.transaction_id ? (
                          <span
                            style={{
                              fontSize: 11.5,
                              fontFamily: 'var(--font-mono)',
                              color: 'var(--swatch-3-mineral)',
                              background: '#F4F8F8',
                              padding: '2px 6px',
                              borderRadius: 4,
                              border: '1px solid var(--border-subtle)',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/audit/${log.transaction_id}`);
                            }}
                          >
                            <span>{log.transaction_id.slice(0, 8)}</span>
                            <ArrowUpRight size={10} />
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>—</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          style={{ background: 'none', border: 'none', color: 'var(--swatch-3-mineral)', cursor: 'pointer', padding: 4 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLog(log);
                          }}
                        >
                          <Eye size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* High-Tech Empty State */
            <div style={{
              padding: '60px 20px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14
            }}>
              <div style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #EEF4F4 0%, #DCE5E5 100%)',
                border: '1.5px solid rgba(125, 174, 170, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--swatch-3-mineral)',
                boxShadow: '0 8px 24px rgba(10, 27, 36, 0.06)'
              }}>
                <Radio size={28} className="radar-pulse-ring" />
              </div>

              <div>
                <h3 style={{ fontSize: 16, margin: 0, color: 'var(--text-primary)' }}>
                  Awaiting Transaction Activity
                </h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 420, margin: '6px auto 0' }}>
                  No audit logs recorded in the current filter scope. Inject a transaction via the Simulator to generate live cryptographic audit entries.
                </p>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button
                  className="btn btn-primary"
                  onClick={() => navigate('/simulator')}
                >
                  <Zap size={14} />
                  <span>Launch Simulator</span>
                </button>
                <button
                  className="btn btn-outline"
                  onClick={() => setFilter({ severity: '', event_type: '', search: '' })}
                >
                  <span>Reset Filters</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Log Detail Modal / Drawer */}
      {selectedLog && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(10, 27, 36, 0.45)',
          backdropFilter: 'blur(6px)',
          zIndex: 1000,
          display: 'flex',
          justifyContent: 'flex-end'
        }}
        onClick={() => setSelectedLog(null)}
        >
          <div style={{
            width: '100%',
            maxWidth: 520,
            background: '#FFFFFF',
            height: '100%',
            boxShadow: '-10px 0 40px rgba(10, 27, 36, 0.2)',
            padding: 24,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 16
          }}
          onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText size={18} color="var(--swatch-2-deep)" />
                <h3 style={{ fontSize: 16, margin: 0, color: 'var(--text-primary)' }}>Audit Record Inspector</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#F8FAFA', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Severity Level</span>
                <span className={`status-badge ${selectedLog.severity === 'critical' ? 'deny' : selectedLog.severity === 'warning' ? 'review' : 'approve'}`}>
                  {selectedLog.severity}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#F8FAFA', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Event Timestamp</span>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                  {new Date(selectedLog.timestamp).toLocaleString()}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#F8FAFA', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Event Category</span>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--swatch-2-deep)' }}>
                  {selectedLog.event_type}
                </span>
              </div>

              {selectedLog.transaction_id && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#F8FAFA', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Transaction ID</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <code style={{ fontSize: 11.5, color: 'var(--swatch-2-deep)', fontWeight: 700 }}>{selectedLog.transaction_id}</code>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(selectedLog.transaction_id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--swatch-3-mineral)' }}
                    >
                      {copiedId ? <Check size={12} color="#0D7C66" /> : <Copy size={12} />}
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                  Event Trace Description
                </label>
                <div style={{ padding: 12, background: '#F8FAFA', border: '1px solid var(--border-subtle)', borderRadius: 8, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                  {selectedLog.description}
                </div>
              </div>

              {selectedLog.details && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                    Raw Cryptographic Payload
                  </label>
                  <pre style={{
                    padding: 12,
                    background: '#0A1B24',
                    color: '#A3DFD3',
                    borderRadius: 8,
                    fontSize: 11.5,
                    fontFamily: 'var(--font-mono)',
                    overflowX: 'auto',
                    maxHeight: 220
                  }}>
                    {typeof selectedLog.details === 'string' ? selectedLog.details : JSON.stringify(selectedLog.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
