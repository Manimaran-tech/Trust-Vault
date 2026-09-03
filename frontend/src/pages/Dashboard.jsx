import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocket } from '../context/WebSocketContext';
import { api } from '../api';
import { ScrollReveal } from '../lib/useScrollReveal';

// Professional Layout Components
import StockRadarWindow from '../components/StockRadarWindow';
import BankOfficeSim from '../components/BankOfficeSim';
import AgentRosterBar from '../components/AgentRosterBar';
import OperationsWorkbench from '../components/OperationsWorkbench';
import AgentSpiritsTelemetryWorkbench from '../components/AgentSpiritsTelemetryWorkbench';
import InfrastructureTelemetryDeck from '../components/InfrastructureTelemetryDeck';
import LogHistoryTable from '../components/LogHistoryTable';
import ArchitecturePipelineLiveBar from '../components/ArchitecturePipelineLiveBar';
import MarketStateBanner from '../components/MarketStateBanner';

export default function Dashboard() {
  const { events, connected } = useWebSocket();
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [agentFilter, setAgentFilter] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Live capital and decision-loop state, straight from the backend.
  const [portfolio, setPortfolio] = useState(null);
  const [loop, setLoop] = useState(null);
  const [feed, setFeed] = useState(null);
  const [avgLatency, setAvgLatency] = useState(null);
  const [activeHoldCount, setActiveHoldCount] = useState(0);

  // Full-screen red flash alert state
  const [alertFlash, setAlertFlash] = useState(false);
  const flashTimeoutRef = useRef(null);

  // Poll the portfolio and loop status. Both are derived from the ledger and
  // the recorded decisions, so nothing shown here is estimated on the client.
  useEffect(() => {
    let cancelled = false;
    const fetchState = async () => {
      try {
        const o = await api.getOverview(30);
        if (cancelled || !o) return;
        setPortfolio(o.portfolio);
        setLoop(o.loop);
        setFeed(o.feed);
        setAvgLatency(o.avg_latency_ms ?? null);
        setActiveHoldCount(o.escalated_count ?? 0);
      } catch (err) {
        // The dashboard degrades to dashes rather than showing invented values.
        console.warn('Live state unavailable:', err.message);
      }
    };
    fetchState();
    const interval = setInterval(fetchState, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshTrigger]);

  const [pendingQueue, setPendingQueue] = useState([]);
  const activeAnomaly = pendingQueue[0] || null;

  // React to the loop's and ingress pipeline's events.
  useEffect(() => {
    if (!events.length) return;
    const latest = events[0];

    if (latest.type === 'market_decision') {
      const data = latest.data || {};
      setRefreshTrigger((prev) => prev + 1);

      // A decision the quorum could not settle is escalated, not guessed at.
      if (data.final_decision === 'pending_human_review') {
        setAlertFlash(true);
        if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
        flashTimeoutRef.current = setTimeout(() => setAlertFlash(false), 1200);

        const newAnomaly = {
          id: data.decision_id,
          decision_id: data.decision_id,
          isMarket: true,
          symbol: data.symbol,
          action: data.action,
          side: data.side,
          amount: data.notional || 0,
          merchant: [data.action, data.side, data.symbol]
            .filter(Boolean)
            .join(' ')
            .toUpperCase(),
          merchant_country: 'NSE India',
          reason:
            data.summary ||
            'The quorum could not settle this action; a human should decide.',
          explainability_summary: data.summary,
          confidence: data.confidence,
          decision: data.final_decision,
          created_at: new Date().toISOString(),
        };

        setPendingQueue((prev) => [newAnomaly, ...prev.filter((i) => i.id !== newAnomaly.id)]);
      }
    }

    if (latest.type === 'decision_made') {
      const data = latest.data || {};
      setRefreshTrigger((prev) => prev + 1);

      if (data.decision === 'pending_human_review' || data.requires_human) {
        setAlertFlash(true);
        if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
        flashTimeoutRef.current = setTimeout(() => setAlertFlash(false), 1200);

        const newAnomaly = {
          id: data.transaction_id,
          transaction_id: data.transaction_id,
          isMarket: false,
          amount: data.amount || 0,
          merchant: data.merchant || 'Suspicious Ingress Entity',
          merchant_country: data.merchant_country || 'Unknown',
          reason:
            data.explainability_summary ||
            data.description ||
            'Ambiguous multi-agent consensus flagged for human authorization.',
          explainability_summary: data.explainability_summary,
          confidence: data.confidence,
          decision: data.decision,
          created_at: new Date().toISOString(),
        };

        setPendingQueue((prev) => [newAnomaly, ...prev.filter((i) => i.id !== newAnomaly.id)]);
      }
    }

    if (latest.type === 'outcome_observed' || latest.type === 'loop_cycle' || latest.type === 'human_resolved') {
      setRefreshTrigger((prev) => prev + 1);
    }
  }, [events]);

  // The run/pause control drives the real decision loop, not an animation flag.
  const handleToggleLoop = useCallback(async (shouldRun) => {
    try {
      setLoop(shouldRun ? await api.resumeLoop() : await api.pauseLoop());
    } catch (err) {
      console.error('Could not change loop state', err);
    }
  }, []);

  const handleResolveAnomaly = useCallback(async (itemOrId, action) => {
    const item = typeof itemOrId === 'object' ? itemOrId : pendingQueue.find((i) => i.id === itemOrId);
    const id = typeof itemOrId === 'object' ? itemOrId.id : itemOrId;
    const isMarket = item ? item.isMarket : false;

    try {
      if (isMarket) {
        await api.overrideMarketDecision(
          id,
          action === 'approve' ? 'approve' : 'deny',
          'Resolved by supervisor from the operations dashboard'
        );
      } else {
        await api.resolveTransaction(
          id,
          action === 'approve' ? 'approve' : 'deny',
          'Resolved by supervisor from the operations dashboard'
        );
      }
    } catch (err) {
      console.error('Failed to resolve escalation', err);
    } finally {
      setPendingQueue((prev) => prev.filter((i) => i.id !== id));
      setRefreshTrigger((prev) => prev + 1);
    }
  }, [pendingQueue]);

  // Injected anomaly handler from spirit controls
  const handleTriggerAnomaly = useCallback((scenario, agent) => {
    setAlertFlash(true);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => setAlertFlash(false), 1200);

    const newAnomaly = {
      id: `anomaly-${Date.now()}`,
      decision_id: `anomaly-${Date.now()}`,
      isMarket: true,
      symbol: scenario.symbol || 'NSE:NIFTY',
      action: scenario.action || 'review',
      side: scenario.side || 'long',
      amount: scenario.notional || 100000,
      merchant: scenario.merchant || `${agent?.name?.toUpperCase() || 'SPIRIT'} DOMAIN STRESS`,
      merchant_country: scenario.merchant_country || 'NSE India',
      reason: scenario.reason || 'Targeted domain stress test injected from spirit control console.',
      explainability_summary: scenario.explainability_summary || scenario.reason,
      confidence: 0.55,
      decision: 'pending_human_review',
      created_at: new Date().toISOString(),
    };

    setPendingQueue((prev) => [newAnomaly, ...prev.filter((i) => i.id !== newAnomaly.id)]);
  }, []);

  const handleRunCycle = useCallback(async () => {
    await api.runCycle();
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px', width: '100%', position: 'relative', paddingBottom: '20px' }}>

      {/* ========== FULL-SCREEN RED FLASH ALERT OVERLAY ========== */}
      {alertFlash && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9999,
          pointerEvents: 'none',
          animation: 'alertFlashPulse 1.2s ease-out forwards',
          background: 'radial-gradient(ellipse at center, rgba(220, 38, 38, 0.35) 0%, rgba(220, 38, 38, 0.08) 70%, transparent 100%)',
          border: '4px solid rgba(239, 68, 68, 0.6)',
          boxShadow: 'inset 0 0 120px rgba(220, 38, 38, 0.3)',
        }} />
      )}

      {/* 1. TOP LIVE EQUITIES RADAR WINDOW (Rotates Every 3s Across Exactly 5 Portfolio Stocks) */}
      <ScrollReveal direction="up" delay={50}>
        <StockRadarWindow portfolio={portfolio} feed={feed} />
      </ScrollReveal>

      {/* 1a. WHY THE DESK IS OR IS NOT ACTING */}
      <MarketStateBanner feed={feed} />

      {/* 1b. LIVE DECISION-LOOP PIPELINE */}
      <ScrollReveal direction="up" delay={60}>
        <ArchitecturePipelineLiveBar />
      </ScrollReveal>

      {/* 2. PRIMARY ASYMMETRICAL OPERATIONAL STAGE (Scroll Reveal) */}
      <ScrollReveal direction="up" delay={100}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.78fr) minmax(320px, 1fr)',
          gap: '14px',
          alignItems: 'stretch'
        }}>
          {/* LEFT COLUMN: Surveillance Monitor + Quorum Telemetry Deck */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#FFFFFF',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
            overflow: 'hidden'
          }}>
            {/* A. Digital Twin Bank Simulation Stage */}
            <BankOfficeSim
              events={events}
              activeAnomaly={activeAnomaly}
              selectedAgentId={selectedAgentId}
              onSelectAgent={setSelectedAgentId}
              autoSimulating={Boolean(loop?.running && !loop?.paused)}
              setAutoSimulating={handleToggleLoop}
            />

            {/* B. Connected Parallel Quorum Telemetry Deck (With Agent Sprites) */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', backgroundColor: '#FDFEFE' }}>
              <AgentRosterBar
                selectedAgentId={selectedAgentId}
                onSelectAgent={setSelectedAgentId}
                events={events}
                activeAnomaly={activeAnomaly}
                loopRunning={Boolean(loop?.running && !loop?.paused)}
              />
            </div>
          </div>

          {/* RIGHT COLUMN: Unified SOC Operations Workbench */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <OperationsWorkbench
              pendingQueue={pendingQueue}
              activeAnomaly={activeAnomaly}
              onResolveAnomaly={handleResolveAnomaly}
            />
          </div>
        </div>
      </ScrollReveal>

      {/* 3. DEDICATED AGENT SPIRITS & TELEMETRY WORKBENCH (Scroll Reveal) */}
      <ScrollReveal direction="up" delay={80}>
        <AgentSpiritsTelemetryWorkbench
          selectedAgentId={selectedAgentId}
          onSelectAgent={setSelectedAgentId}
          onTriggerAnomaly={handleTriggerAnomaly}
          onFilterLedger={(agentKey) => setAgentFilter(agentKey)}
          onFocusOfficeSim={(agentId) => setSelectedAgentId(agentId)}
          onRunCycle={handleRunCycle}
        />
      </ScrollReveal>

      {/* 4. ENTERPRISE DATA INFRASTRUCTURE & OBSERVABILITY DECK (Scroll Reveal) */}
      <ScrollReveal direction="up" delay={80}>
        <InfrastructureTelemetryDeck />
      </ScrollReveal>

      {/* 5. FULL-WIDTH IMMUTABLE DECISION LEDGER (Scroll Reveal) */}
      <ScrollReveal direction="up" delay={80}>
        <div style={{ width: '100%' }}>
          <LogHistoryTable
            refreshTrigger={refreshTrigger}
            agentFilter={agentFilter}
            onClearAgentFilter={() => setAgentFilter(null)}
          />
        </div>
      </ScrollReveal>

      {/* Inject alert flash keyframes */}
      <style>{`
        @keyframes alertFlashPulse {
          0% { opacity: 1; }
          15% { opacity: 0.9; }
          30% { opacity: 1; }
          45% { opacity: 0.85; }
          60% { opacity: 0.95; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
