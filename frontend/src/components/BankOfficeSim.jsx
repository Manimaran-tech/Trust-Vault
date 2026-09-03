import AgentSprite from './AgentSprite';
import React, { useState, useEffect, useRef } from 'react';
import {
  Volume2,
  VolumeX,
  Lock,
  Unlock,
  RefreshCw,
  Landmark,
  ShieldCheck,
  BarChart3,
  Search,
  Scale,
  FileCheck,
  Brain,
  UserCheck
} from 'lucide-react';
import './BankOfficeSim.css';

// 6 Specialized Market/Bank Experts + Chief Watchdog Overseer
export const OFFICE_EXPERTS = [
  {
    id: 'overseer',
    name: 'Michael',
    fullName: 'Consensus & Synthesis Governor',
    role: 'Quorum Synthesis & Governance',
    title: 'GOVERNOR',
    color: '#F59E0B',
    domain: '6/6 Multi-Agent Consensus Quorum',
    x: 792,
    y: 450,
    facing: 'down',
    spriteIndex: 0,
    spriteUrl: '/sprites/char_0.png',
    liveStatus: 'QUORUM_READY',
    funQuotes: [
      'I declare: Full Regulatory Compliance.',
      'Swarm consensus 6/6 verified.',
      'Consensus quorum committed to Vault.',
      'Autonomous governance active.'
    ]
  },
  {
    id: 'jim',
    name: 'Jim',
    fullName: 'Volatility & Downside Analyst',
    role: 'Volatility & Risk Lead',
    title: 'RISK ANALYST',
    color: '#EA580C',
    domain: 'Volatility Regime & VaR Matrix',
    x: 90,
    y: 325,
    facing: 'up',
    spriteIndex: 1,
    spriteUrl: '/sprites/char_1.png',
    liveStatus: 'EXPOSURE_NOMINAL',
    funQuotes: [
      'Volatility index: 0.12 (Low Regime)',
      'Downside risk nominal across equities.',
      'VaR 99% boundary verified.',
      'Portfolio risk index approved.'
    ]
  },
  {
    id: 'dwight',
    name: 'Dwight',
    fullName: 'Directional Alpha & Signal Hunter',
    role: 'Momentum & Edge Detective',
    title: 'SIGNAL HUNTER',
    color: '#DC2626',
    domain: 'Directional Edge & Momentum Signal',
    x: 205,
    y: 455,
    facing: 'right',
    spriteIndex: 2,
    spriteUrl: '/sprites/char_2.png',
    liveStatus: 'EDGE_SCANNING',
    funQuotes: [
      'Momentum edge: +51.5 bps detected.',
      'Scanning order book imbalances...',
      'Statistical alpha verified.',
      'Signal confirmed on portfolio equities.'
    ]
  },
  {
    id: 'pam',
    name: 'Pam',
    fullName: 'Capital Limits & Mandate Guard',
    role: 'Exposure & Limits Lead',
    title: 'MANDATE GUARD',
    color: '#8B5CF6',
    domain: '15% Gross Cap & Capital Mandate',
    x: 587,
    y: 150,
    facing: 'down',
    spriteIndex: 3,
    spriteUrl: '/sprites/char_3.png',
    liveStatus: 'MANDATE_VERIFIED',
    funQuotes: [
      'Position verified within 15% asset cap.',
      'Capital allocation compliant with mandate.',
      'Desk limits stamped and verified.',
      'Portfolio risk fully balanced.'
    ]
  },
  {
    id: 'kevin',
    name: 'Kevin',
    fullName: 'Liquidity & Execution Guard',
    role: 'Order Routing & Settlement',
    title: 'EXECUTION GUARD',
    color: '#10B981',
    domain: 'Order Depth & Fast-Path Settlement',
    x: 753,
    y: 150,
    facing: 'down',
    spriteIndex: 4,
    spriteUrl: '/sprites/char_4.png',
    liveStatus: 'EXECUTION_READY',
    funQuotes: [
      'Slippage estimated at < 2.5 bps.',
      'Fast-path settlement rail verified.',
      'Liquidity checks executed successfully.',
      'Stitch programmable ledger reconciled.'
    ]
  },
  {
    id: 'oscar',
    name: 'Oscar',
    fullName: 'Correlation & Concentration Scribe',
    role: 'Cross-Asset Beta & SHAP Reasoning',
    title: 'CORRELATION',
    color: '#6366F1',
    domain: 'Cross-Asset Correlation & Attestation',
    x: 275,
    y: 150,
    facing: 'down',
    spriteIndex: 5,
    spriteUrl: '/sprites/char_5.png',
    liveStatus: 'BETA_LOGGED',
    funQuotes: [
      'Portfolio beta: 0.88 (Target Balanced).',
      'Cryptographic proof signed to audit ledger.',
      'Full explainability rationale logged.',
      'Immutable consensus hash sealed.'
    ]
  },
  {
    id: 'alex',
    name: 'Alex',
    fullName: 'News Desk & Sentiment Specialist',
    role: 'FinBERT Sentiment & Headline Scorer',
    title: 'NEWS DESK',
    color: '#0284C7',
    domain: 'Live Financial News & Sentiment Index',
    x: 107,
    y: 150,
    facing: 'down',
    spriteIndex: 1,
    spriteUrl: '/sprites/char_1.png',
    liveStatus: 'NEWS_FEED_ACTIVE',
    funQuotes: [
      'Market sentiment score: +0.82 Bullish.',
      'FinBERT headline scoring complete.',
      'Macro environment nominal.',
      'Positive earnings sentiment confirmed.'
    ]
  }
];

export default function BankOfficeSim({
  events = [],
  activeAnomaly = null,
  selectedAgentId = null,
  onSelectAgent = () => { },
  activeExpertId = 'dwight',
  setActiveExpertId = () => { },
  autoSimulating = false,
  setAutoSimulating = () => { }
}) {
  const canvasRef = useRef(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [bubbles, setBubbles] = useState({
    overseer: { text: 'Bank Watchdog: Quorum 6/6 Nominal', type: 'fun', time: Date.now() + 50000 },
    courier: { text: 'Armored cash transit: En route to vault', type: 'fun', time: Date.now() + 50000 }
  });
  const [courierPos, setCourierPos] = useState({ x: 160, y: 405, dir: 1, frame: 0 });
  const [packetPos, setPacketPos] = useState({ x: 135, y: 220, targetX: 235, targetY: 440, label: '₹2,480', progress: 0 });
  const spriteCache = useRef({});
  const audioCtxRef = useRef(null);

  // Red alert flash state
  const [alertFlashActive, setAlertFlashActive] = useState(false);
  const prevAnomalyRef = useRef(null);

  // Detect new anomaly arrival and trigger the red flash
  useEffect(() => {
    if (activeAnomaly && !prevAnomalyRef.current) {
      // New anomaly just arrived — trigger dramatic flash
      setAlertFlashActive(true);
      setTimeout(() => setAlertFlashActive(false), 1200);
    }
    prevAnomalyRef.current = activeAnomaly;
  }, [activeAnomaly]);

  // Preload pixel-agents character sheets and background
  useEffect(() => {
    const bgImg = new Image();
    bgImg.src = '/bank_bg.jpg';
    bgImg.onload = () => { spriteCache.current['bg'] = bgImg; };

    OFFICE_EXPERTS.forEach(exp => {
      if (exp.spriteUrl && !spriteCache.current[exp.spriteUrl]) {
        const img = new Image();
        img.src = exp.spriteUrl;
        img.onload = () => {
          spriteCache.current[exp.spriteUrl] = img;
        };
      }
    });
  }, []);

  // Retro sound synthesizer for bank alerts and clicks
  const playRetroBeep = (type = 'blip') => {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'blip') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(540, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1080, ctx.currentTime + 0.04);
        gain.gain.setValueAtTime(0.04, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.04);
        osc.start();
        osc.stop(ctx.currentTime + 0.04);
      } else if (type === 'vault') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(180, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(460, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      } else if (type === 'alert') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(280, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(620, ctx.currentTime + 0.18);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.22);
        osc.start();
        osc.stop(ctx.currentTime + 0.22);
      }
    } catch (e) { }
  };

  // Autonomous Market/Banking Transaction Pipeline & Cash Courier Pacing
  useEffect(() => {
    if (!autoSimulating) {
      // When paused or idle, ensure courier stands still and no random transactions simulate
      setBubbles({
        overseer: { text: 'Desk Paused — Ingestion Idle', type: 'fun', time: Date.now() + 50000 },
        courier: { text: 'Transit Halted: Desk in Idle Mode', type: 'fun', time: Date.now() + 50000 }
      });
      return undefined;
    }

    // Armored courier walking across the bank aisle
    const courierTimer = setInterval(() => {
      setCourierPos(prev => {
        const nextX = prev.x + prev.dir * 18;
        const nextDir = nextX > 520 ? -1 : nextX < 360 ? 1 : prev.dir;
        return { x: nextX, y: 250, dir: nextDir, frame: (prev.frame + 1) % 6 };
      });
    }, 360);

    const bankPipeline = [
      { id: 'dwight', quote: 'Market Signal: Edge Confirmed (+51.5 bps)', type: 'fun', x: 205, y: 455 },
      { id: 'pam', quote: 'Mandate Check: Within 15% Risk Cap', type: 'success', x: 587, y: 150 },
      { id: 'jim', quote: 'Volatility Guard: Downside Protected', type: 'fun', x: 90, y: 325 },
      { id: 'kevin', quote: 'Fast-Path Settlement: Slippage < 2 bps', type: 'success', x: 753, y: 150 },
      { id: 'oscar', quote: 'SHAP Correlation: Portfolio Balanced', type: 'fun', x: 275, y: 150 },
      { id: 'alex', quote: 'Sentiment Desk: Bullish Inflow (+0.82)', type: 'fun', x: 107, y: 150 },
      { id: 'overseer', quote: 'Quorum 6/6: APPROVED & COMMITTED TO VAULT', type: 'success', x: 792, y: 450 }
    ];

    let pipelineIndex = 0;
    const ticker = setInterval(() => {
      const primaryAgent = bankPipeline[pipelineIndex % bankPipeline.length];
      const secondaryAgent = bankPipeline[(pipelineIndex + 2) % bankPipeline.length];
      const thirdAgent = bankPipeline[(pipelineIndex + 4) % bankPipeline.length];

      setActiveExpertId(primaryAgent.id);

      if (primaryAgent.id === 'overseer' || secondaryAgent.id === 'overseer') {
        setVaultOpen(true);
        playRetroBeep('vault');
        setTimeout(() => setVaultOpen(false), 2200);
      }

      setPacketPos({
        x: 107,
        y: 150,
        targetX: primaryAgent.x,
        targetY: primaryAgent.y,
        label: `₹${(Math.random() * 8500 + 1500).toFixed(0)}`,
        progress: 0
      });

      setBubbles(prev => ({
        ...prev,
        [primaryAgent.id]: {
          text: primaryAgent.quote,
          type: primaryAgent.type,
          time: Date.now() + 4500
        },
        [secondaryAgent.id]: {
          text: secondaryAgent.quote,
          type: secondaryAgent.type,
          time: Date.now() + 4500
        },
        [thirdAgent.id]: {
          text: thirdAgent.quote,
          type: thirdAgent.type,
          time: Date.now() + 4500
        }
      }));

      playRetroBeep('blip');
      pipelineIndex++;
    }, 3200);

    return () => {
      clearInterval(courierTimer);
      clearInterval(ticker);
    };
  }, [autoSimulating, soundEnabled]);

  // React to Live WebSocket Events (Replay, Decisions, Executions)
  useEffect(() => {
    if (!events || events.length === 0) return;
    const latest = events[0];
    if (!latest) return;

    if (latest.type === 'market_decision' || latest.event_type === 'decision' || latest.type === 'trade_executed' || latest.type === 'loop_cycle') {
      const sym = latest.symbol || latest.data?.symbol || 'EQUITY';
      const action = (latest.action || latest.data?.action || 'TRADE').toUpperCase();
      const amt = latest.amount || latest.data?.notional || 25000;

      setActiveExpertId('overseer');
      setVaultOpen(true);
      playRetroBeep('vault');
      setTimeout(() => setVaultOpen(false), 3000);

      setPacketPos({
        x: 205,
        y: 455,
        targetX: 792,
        targetY: 450,
        label: `₹${Number(amt).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
        progress: 0
      });

      setBubbles(prev => ({
        ...prev,
        dwight: { text: `Signal: ${action} on ${sym} validated`, type: 'fun', time: Date.now() + 6000 },
        pam: { text: `Mandate: Risk Limits & Capital Clear`, type: 'success', time: Date.now() + 6000 },
        overseer: { text: `Quorum: ${action} ${sym} SETTLED TO VAULT`, type: 'success', time: Date.now() + 6000 }
      }));
    }
  }, [events]);

  // Handle Incoming Anomaly Alerts
  useEffect(() => {
    if (activeAnomaly) {
      setActiveExpertId('dwight');
      setBubbles(prev => ({
        ...prev,
        overseer: {
          text: `GOVERNANCE LOCK: ₹${Number(activeAnomaly.amount || 100000).toLocaleString('en-IN')} Escalated!`,
          type: 'alert',
          time: Date.now() + 60000
        },
        dwight: {
          text: `DARKNET ANOMALY: ${activeAnomaly.merchant || 'High-Risk IP'}`,
          type: 'alert',
          time: Date.now() + 60000
        },
        pam: {
          text: `COMPLIANCE HOLD: Sanction Check Required!`,
          type: 'alert',
          time: Date.now() + 60000
        },
        kevin: {
          text: `VELOCITY ALERT: Policy Breach Triggered!`,
          type: 'alert',
          time: Date.now() + 60000
        }
      }));
      playRetroBeep('alert');
    }
  }, [activeAnomaly, soundEnabled]);

  // Main Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    let animId;
    let tick = 0;

    const render = () => {
      tick++;
      const w = canvas.width;
      const h = canvas.height;

      // Background
      const bgImg = spriteCache.current['bg'];
      if (bgImg && bgImg.complete) {
        ctx.drawImage(bgImg, 0, 0, w, h);
      } else {
        ctx.fillStyle = '#0F172A';
        ctx.fillRect(0, 0, w, h);
      }

      // Security Anomaly Alarm Flash Overlay
      if (activeAnomaly) {
        const pulse = (Math.sin(tick * 0.1) + 1) / 2;
        ctx.fillStyle = `rgba(220, 38, 38, ${0.15 + pulse * 0.25})`;
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = `rgba(255, 0, 0, ${0.5 + pulse * 0.5})`;
        ctx.beginPath(); ctx.arc(150, 20, 10, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(730, 20, 10, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 12px monospace';
        ctx.fillText('EMERGENCY LOCKDOWN', w / 2 - 60, 30);
      }

      // Render Characters
      OFFICE_EXPERTS.forEach(agent => {
        const isSelected = selectedAgentId === agent.id;
        const isAnomaly = activeAnomaly && (agent.id === 'dwight' || agent.id === 'overseer');

        if (isSelected || isAnomaly) {
          ctx.strokeStyle = isAnomaly ? '#EF4444' : (agent.color || '#0D7C66');
          ctx.lineWidth = isSelected ? 3 : 2;
          ctx.beginPath();
          const pulseR = isSelected ? 24 + Math.sin(tick * 0.15) * 3 : 22;
          ctx.arc(agent.x + 12, agent.y + 14, pulseR, 0, Math.PI * 2);
          ctx.stroke();

          if (isSelected) {
            ctx.fillStyle = 'rgba(13, 124, 102, 0.15)';
            ctx.fill();

            // Floating Arrow Beacon above head
            ctx.fillStyle = '#0D7C66';
            ctx.beginPath();
            ctx.moveTo(agent.x + 12, agent.y - 20 + Math.sin(tick * 0.2) * 3);
            ctx.lineTo(agent.x + 8, agent.y - 28 + Math.sin(tick * 0.2) * 3);
            ctx.lineTo(agent.x + 16, agent.y - 28 + Math.sin(tick * 0.2) * 3);
            ctx.closePath();
            ctx.fill();
          }
        }

        const spriteImg = spriteCache.current[agent.spriteUrl];
        if (spriteImg && spriteImg.complete && spriteImg.naturalWidth > 0) {
          const frameWidth = 16;
          const frameHeight = 32;
          const animFrame = autoSimulating ? (Math.floor(tick / 12) + agent.spriteIndex) % 7 : 0;
          let row = agent.facing === 'up' ? 1 : agent.facing === 'right' ? 2 : 0;

          ctx.save();
          ctx.drawImage(
            spriteImg,
            animFrame * frameWidth,
            row * frameHeight,
            frameWidth,
            frameHeight,
            agent.x,
            agent.y - 12,
            24,
            48
          );
          ctx.restore();
        } else {
          ctx.fillStyle = agent.color;
          ctx.fillRect(agent.x + 2, agent.y + 2, 16, 20);
          ctx.fillStyle = '#FFE0BD'; ctx.fillRect(agent.x + 4, agent.y - 8, 12, 12);
        }

        // Floating Agent Status Badge
        ctx.fillStyle = isAnomaly ? '#FEF2F2' : (isSelected ? '#0D2E37' : '#FFFFFF');
        ctx.fillRect(agent.x - 14, agent.y + 36, 56, 14);
        ctx.strokeStyle = isAnomaly ? '#DC2626' : (isSelected ? '#7DAEAA' : '#446E73'); ctx.lineWidth = isSelected ? 1.5 : 1;
        ctx.strokeRect(agent.x - 14, agent.y + 36, 56, 14);
        ctx.fillStyle = isSelected ? '#A3DFD3' : '#0A1B24';
        ctx.font = 'bold 7.5px monospace';
        ctx.fillText(agent.name.toUpperCase(), agent.x - 10, agent.y + 46);
      });

      // Courier (Stands idle at post when paused)
      const courierImg = spriteCache.current[OFFICE_EXPERTS[1].spriteUrl];
      if (courierImg && courierImg.complete && courierImg.naturalWidth > 0) {
        const frameWidth = 16;
        const frameHeight = 32;
        const row = 2;
        const courierFrame = autoSimulating ? courierPos.frame : 0;
        ctx.save();
        if (courierPos.dir < 0) {
          ctx.translate(courierPos.x + 24, courierPos.y - 12);
          ctx.scale(-1, 1);
          ctx.drawImage(courierImg, courierFrame * frameWidth, row * frameHeight, frameWidth, frameHeight, 0, 0, 24, 48);
        } else {
          ctx.drawImage(courierImg, courierFrame * frameWidth, row * frameHeight, frameWidth, frameHeight, courierPos.x, courierPos.y - 12, 24, 48);
        }
        ctx.restore();
      }

      // Flying Transaction Packet
      if (autoSimulating && packetPos.progress < 1) {
        packetPos.progress += 0.04;
        const curX = packetPos.x + (packetPos.targetX - packetPos.x) * packetPos.progress;
        const curY = packetPos.y + (packetPos.targetY - packetPos.y) * packetPos.progress;

        ctx.fillStyle = '#10B981';
        ctx.strokeStyle = '#064E3B';
        ctx.lineWidth = 1.5;
        ctx.fillRect(curX - 16, curY - 10, 34, 16);
        ctx.strokeRect(curX - 16, curY - 10, 34, 16);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 8px monospace';
        ctx.fillText(packetPos.label, curX - 12, curY + 2);
      }

      // Paused / Idle Mode Canvas Banner
      if (!autoSimulating && !activeAnomaly) {
        ctx.fillStyle = 'rgba(11, 15, 23, 0.75)';
        ctx.fillRect(w / 2 - 80, 8, 160, 20);
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(w / 2 - 80, 8, 160, 20);
        ctx.fillStyle = '#94A3B8';
        ctx.font = 'bold 8.5px monospace';
        ctx.fillText('⏸ DESK PAUSED (IDLE)', w / 2 - 60, 21);
      }

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [selectedAgentId, activeAnomaly, courierPos, packetPos, vaultOpen, autoSimulating]);

  const currentAgent = OFFICE_EXPERTS.find(a => a.id === (selectedAgentId || activeExpertId)) || OFFICE_EXPERTS[0];

  return (
    <div className={`office-hq-container ${alertFlashActive ? 'alert-active' : ''}`}>
      {/* 1. TOP SYSTEM BAR */}
      <div className="office-hq-topbar">
        <div className="topbar-left">
          {/* Agent Avatar Badge */}
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 4,
              border: '1px solid rgba(56, 189, 248, 0.4)',
              background: '#0B0F17',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden'
            }}
          >
            <AgentSprite src={currentAgent.spriteUrl} size={26} animated />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Landmark size={13} color="var(--accent-cyan)" />
            <span style={{ color: '#FFFFFF', fontWeight: 800, letterSpacing: '-0.2px' }}>TRUSTVAULT BANK HQ</span>
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>v0.4.4</span>

          {/* Auto Pipeline Pill */}
          <div
            className={`topbar-badge ${autoSimulating ? 'active' : ''}`}
            onClick={() => setAutoSimulating(!autoSimulating)}
          >
            {autoSimulating ? 'AUTO PIPELINE ON' : 'IDLE MODE'}
          </div>

          {/* Sound Synthesizer Pill */}
          <div
            className={`topbar-badge ${soundEnabled ? 'active' : ''}`}
            onClick={() => setSoundEnabled(!soundEnabled)}
          >
            {soundEnabled ? <Volume2 size={11} /> : <VolumeX size={11} />}
            <span>{soundEnabled ? 'BANK FX ON' : 'FX MUTED'}</span>
          </div>
        </div>

        <div className="topbar-right">
          {/* Vault Security Status Pill */}
          <div className={`topbar-badge ${vaultOpen ? 'active' : ''}`} style={{ color: vaultOpen ? '#34D399' : '#FCD34D' }}>
            {vaultOpen ? <Unlock size={11} /> : <Lock size={11} />}
            <span>{vaultOpen ? 'VAULT UNLOCKED (SETTLED)' : 'VAULT SECURED'}</span>
          </div>
        </div>
      </div>

      {/* 2. CANVAS SIMULATION VIEWPORT */}
      <div className="office-hq-canvas-wrapper">
        <canvas
          ref={canvasRef}
          width={880}
          height={550}
          className="office-hq-canvas"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const scaleX = 880 / rect.width;
            const scaleY = 550 / rect.height;
            const clickX = (e.clientX - rect.left) * scaleX;
            const clickY = (e.clientY - rect.top) * scaleY;

            const clicked = OFFICE_EXPERTS.find(
              a => Math.abs(a.x - clickX) < 40 && Math.abs(a.y - clickY) < 40
            );
            if (clicked) {
              onSelectAgent(clicked.id);
            }
          }}
        />

        {/* DOM Red Alert Flash Overlay */}
        {alertFlashActive && (
          <div className="bank-alert-overlay" />
        )}

        {/* DOM Speech Bubbles Overlay */}
        <div className="speech-bubble-overlay">
          {bubbles.overseer && (
            <div
              className={`pixel-speech-bubble ${bubbles.overseer.type === 'alert' ? 'alert' : bubbles.overseer.type === 'success' ? 'success' : ''}`}
              style={{ left: '125px', top: '75px' }}
            >
              {bubbles.overseer.text}
            </div>
          )}

          {bubbles.courier && (
            <div
              className="pixel-speech-bubble"
              style={{ left: `${courierPos.x + 20}px`, top: `${courierPos.y - 18}px` }}
            >
              {bubbles.courier.text}
            </div>
          )}

          {activeExpertId && bubbles[activeExpertId] && activeExpertId !== 'overseer' && (
            <div
              className={`pixel-speech-bubble ${bubbles[activeExpertId].type === 'alert' ? 'alert' : bubbles[activeExpertId].type === 'success' ? 'success' : ''}`}
              style={{
                left: `${(OFFICE_EXPERTS.find(e => e.id === activeExpertId)?.x || 245) + 12}px`,
                top: `${(OFFICE_EXPERTS.find(e => e.id === activeExpertId)?.y || 335) - 20}px`
              }}
            >
              {bubbles[activeExpertId].text}
            </div>
          )}
        </div>

        {/* Floating Agent Inspector Dossier (Bottom Left Overlay) */}
        <div className="agent-dossier-card">
          <div className="agent-dossier-avatar" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <AgentSprite src={currentAgent.spriteUrl} size={38} animated />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-primary)' }}>
                {currentAgent.name.toUpperCase()} ({currentAgent.title})
              </span>
              <span style={{ fontSize: 8.5, background: 'rgba(13, 124, 102, 0.12)', border: '1px solid rgba(13, 124, 102, 0.3)', padding: '1px 5px', borderRadius: 3, color: '#0D7C66', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                {currentAgent.liveStatus}
              </span>
            </div>
            <div style={{ fontSize: 9.5, color: 'var(--text-muted)', marginTop: 1 }}>
              {currentAgent.fullName} • {currentAgent.domain}
            </div>
          </div>
        </div>

        {/* Quick Controls */}
        <div className="canvas-quick-controls">
          <button
            className="canvas-btn"
            onClick={() => onSelectAgent(null)}
            title="Reset focus"
          >
            <RefreshCw size={11} /> Reset Focus
          </button>
        </div>
      </div>
    </div>
  );
}
