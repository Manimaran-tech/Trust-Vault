import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Shield,
  Cpu,
  ShieldCheck,
  Activity,
  LayoutDashboard,
  PlayCircle,
  FileText,
  Radio,
  Layers,
  Sparkles,
  Wallet,
  Zap,
  Clock
} from 'lucide-react';
import { useWebSocket } from '../context/WebSocketContext';
import { api } from '../api';

export default function Navbar() {
  const { connected } = useWebSocket();
  const [utcTime, setUtcTime] = useState('');
  const [feed, setFeed] = useState(null);
  const [llmModel, setLlmModel] = useState('');
  const [llmBase, setLlmBase] = useState('');

  // Telemetry the navbar reports is read from the backend, not asserted. On a
  // failure the chips fall back to a dash rather than a reassuring constant.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const t = await api.getInfrastructureTelemetry();
        if (cancelled || !t) return;
        setFeed(t.market_feed || null);
        setLlmModel(t.llm?.model || '');
        setLlmBase(t.llm?.base_url || '');
      } catch {
        if (!cancelled) setFeed(null);
      }
    };
    load();
    const id = setInterval(load, 20000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const feedOk = Boolean(feed?.connected);
  const fresh = feed?.symbols_fresh?.length ?? 0;
  const total = feed?.symbols?.length ?? 0;
  const freshOk = total > 0 && fresh === total;

  // Live UTC timestamp ticker for financial governance accuracy
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const timeStr = now.toISOString().substring(11, 19) + ' UTC';
      setUtcTime(timeStr);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="enterprise-navbar">
      {/* 1. Left: Executive Brand Emblem with New Shield Logo */}
      <div className="nav-left-group">
        <NavLink to="/" className="nav-brand">
          <div className="brand-badge-icon" style={{
            width: '38px',
            height: '38px',
            background: 'transparent',
            border: 'none',
            boxShadow: 'none',
            overflow: 'visible',
            padding: 0
          }}>
            <img
              src="/trustvault_logo.png"
              alt="TrustVault Multi-Agent Logo"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                filter: 'drop-shadow(0 0 10px rgba(125, 174, 170, 0.45))'
              }}
            />
          </div>
          <div className="brand-text">
            <span className="brand-title">TrustVault</span>
            <span className="brand-subtitle">AUTONOMOUS MULTI-AGENT MARKET DESK</span>
          </div>
        </NavLink>
      </div>

      {/* 2. Center: Elegant Floating Navigation Pill Dock */}
      <nav className="nav-center-dock">
        <NavLink
          to="/"
          className={({ isActive }) => `nav-dock-item ${isActive ? 'active' : ''}`}
          end
        >
          <LayoutDashboard size={14} />
          <span>Dashboard</span>
        </NavLink>

        <NavLink
          to="/portfolio"
          className={({ isActive }) => `nav-dock-item ${isActive ? 'active' : ''}`}
        >
          <Wallet size={14} />
          <span>Capital</span>
        </NavLink>

        <NavLink
          to="/audit"
          className={({ isActive }) => `nav-dock-item ${isActive ? 'active' : ''}`}
        >
          <FileText size={14} />
          <span>Audit Ledger</span>
        </NavLink>

        <NavLink
          to="/watchdog"
          className={({ isActive }) => `nav-dock-item ${isActive ? 'active' : ''}`}
        >
          <Radio size={14} />
          <span>Watchdog AI</span>
        </NavLink>
      </nav>

      {/* 3. Right: Real-time System Telemetry & SOC Beacon */}
      <div className="nav-right-group">
        <div className="nav-telemetry-cluster">
          <div className="telemetry-chip" title={llmBase || 'LLM endpoint not reported'}>
            <Cpu size={12} color="var(--swatch-4-mint)" />
            <span>LLM: <strong>{llmModel || '—'}</strong></span>
          </div>

          <div
            className="telemetry-chip"
            title={
              feed
                ? `${feed.provider} · ${feed.ticks_received.toLocaleString()} ticks${
                    feed.last_error ? ` · last error: ${feed.last_error}` : ''
                  }`
                : 'Feed status unavailable'
            }
          >
            <Radio size={12} color={feedOk ? '#10B981' : '#EF4444'} />
            <span>
              FEED: <strong>{feed ? (feed.connected ? 'LIVE' : 'DOWN') : '—'}</strong>
            </span>
          </div>

          <div
            className="telemetry-chip"
            title="Instruments with an observation fresh enough to act on"
          >
            <Activity size={12} color={freshOk ? '#7DAEAA' : '#F59E0B'} />
            <span>
              FRESH: <strong>{feed ? `${fresh}/${total}` : '—'}</strong>
            </span>
          </div>
        </div>

        {/* Live SOC State Beacon */}
        <div className="nav-status-chip">
          <span className={`status-dot ${connected ? 'live' : 'offline'}`} />
          <span style={{ color: connected ? '#10B981' : '#EF4444' }}>
            {connected ? 'SOC ONLINE' : 'DISCONNECTED'}
          </span>
        </div>

        {/* UTC Clock */}
        <div className="nav-utc-clock">
          <Clock size={11} color="var(--swatch-4-mint)" />
          <span>{utcTime || 'LIVE UTC'}</span>
        </div>
      </div>
    </header>
  );
}
