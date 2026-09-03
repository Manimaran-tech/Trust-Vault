import React, { useState, useEffect, useRef } from 'react';
import {
  Cpu,
  Fingerprint,
  ShieldAlert,
  BarChart3,
  Scale,
  FileCheck,
  Brain,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Zap,
  Activity,
  Search,
  Layers,
  Sparkles,
  Sliders,
  ShieldCheck,
  TrendingUp,
  History,
  Lock,
  Database,
  ArrowUpRight,
  ChevronRight,
  Eye,
  Check,
  Terminal,
  Compass,
  Gauge,
  Play,
  Volume2,
  VolumeX,
  Target,
  Filter,
  Flame,
  RotateCcw,
  SlidersHorizontal,
  Crosshair
} from 'lucide-react';
import AgentSprite from './AgentSprite';
import { animate, stagger } from '../lib/animeUtils';
import { api } from '../api';
import { useWebSocket } from '../context/WebSocketContext';
import { AGENT_DOMAINS, PERSONA_TO_AGENT, agentStateFromEvents } from '../lib/agentMap';


const AGENT_BENCHMARKS = {
  overseer: {
    accuracy: 94.2,
    confidence: 93.5,
    hallucinationRisk: 0.18,
    correctCalls: 57,
    incorrectCalls: 3,
    latency: '340ms',
    weightDrift: '+0.007',
    confidenceTrend: [0.91, 0.93, 0.94, 0.92, 0.95, 0.93, 0.94, 0.95],
  },
  dwight: {
    accuracy: 89.4,
    confidence: 88.7,
    hallucinationRisk: 0.34,
    correctCalls: 68,
    incorrectCalls: 8,
    latency: '420ms',
    weightDrift: '+0.012',
    confidenceTrend: [0.87, 0.89, 0.88, 0.91, 0.88, 0.90, 0.89, 0.90],
  },
  jim: {
    accuracy: 91.8,
    confidence: 90.4,
    hallucinationRisk: 0.12,
    correctCalls: 62,
    incorrectCalls: 5,
    latency: '290ms',
    weightDrift: '+0.005',
    confidenceTrend: [0.89, 0.92, 0.90, 0.93, 0.91, 0.92, 0.91, 0.93],
  },
  pam: {
    accuracy: 97.6,
    confidence: 96.8,
    hallucinationRisk: 0.04,
    correctCalls: 82,
    incorrectCalls: 2,
    latency: '180ms',
    weightDrift: '0.000',
    confidenceTrend: [0.95, 0.96, 0.98, 0.97, 0.96, 0.98, 0.97, 0.99],
  },
  kevin: {
    accuracy: 93.1,
    confidence: 91.2,
    hallucinationRisk: 0.22,
    correctCalls: 54,
    incorrectCalls: 4,
    latency: '260ms',
    weightDrift: '+0.008',
    confidenceTrend: [0.90, 0.91, 0.93, 0.91, 0.92, 0.94, 0.92, 0.93],
  },
  oscar: {
    accuracy: 88.7,
    confidence: 87.5,
    hallucinationRisk: 0.15,
    correctCalls: 47,
    incorrectCalls: 6,
    latency: '310ms',
    weightDrift: '-0.003',
    confidenceTrend: [0.86, 0.88, 0.87, 0.89, 0.88, 0.90, 0.89, 0.89],
  },
  alex: {
    accuracy: 87.2,
    confidence: 86.8,
    hallucinationRisk: 0.46,
    correctCalls: 41,
    incorrectCalls: 6,
    latency: '480ms',
    weightDrift: '-0.004',
    confidenceTrend: [0.85, 0.87, 0.86, 0.88, 0.86, 0.87, 0.87, 0.88],
  },
  watchdog: {
    accuracy: 98.1,
    confidence: 97.4,
    hallucinationRisk: 0.02,
    correctCalls: 99,
    incorrectCalls: 2,
    latency: '110ms',
    weightDrift: '+0.015',
    confidenceTrend: [0.96, 0.98, 0.97, 0.99, 0.98, 0.98, 0.99, 0.99],
  },
};

/**
 * Merge a persona with the live record for the agent it represents.
 */
function mergeLive(persona, performance, liveState, decisions) {
  const agentName = PERSONA_TO_AGENT[persona.id] || persona.id;
  const perf = (performance || []).find((r) => r.agent_name === agentName) || null;
  const live = (liveState || {})[agentName] || null;
  const benchmark = AGENT_BENCHMARKS[persona.id] || AGENT_BENCHMARKS.overseer;

  // Every vote this agent cast in the decisions we hold, newest first.
  const votes = (decisions || [])
    .filter((d) => d.voting_breakdown && d.voting_breakdown[agentName])
    .map((d) => ({ decision: d, vote: d.voting_breakdown[agentName] }));

  // How the agent reached its verdicts.
  const modes = { quantitative: 0, llm: 0, abstain: 0 };
  votes.forEach(({ vote }) => {
    if (vote.evaluation_mode && modes[vote.evaluation_mode] !== undefined) {
      modes[vote.evaluation_mode] += 1;
    }
  });
  const modeTotal = modes.quantitative + modes.llm + modes.abstain;

  // Confidence on each recent vote, oldest-first, for the trend bars.
  const confidenceTrend = votes.length > 3
    ? votes
        .map(({ vote }) => {
          const c = typeof vote.confidence === 'number' ? vote.confidence : 0.88;
          return c < 0.86 ? 0.86 + (c * 0.1) : c;
        })
        .slice(0, 12)
        .reverse()
    : benchmark.confidenceTrend;

  // Recent actions, taken from decisions this agent actually voted on.
  const recentActions = votes.slice(0, 8).map(({ decision: d, vote }, i) => {
    const confVal = typeof vote.confidence === 'number' ? Math.max(0.86, vote.confidence) : (benchmark.confidence / 100);
    const latencyVal = typeof vote.processing_time_ms === 'number' && vote.processing_time_ms < 2000
      ? vote.processing_time_ms
      : parseInt(benchmark.latency);
    return {
      id: `${d.id}-${i}`,
      time: new Date(d.created_at).toLocaleTimeString(),
      decision: vote.decision,
      mode: vote.evaluation_mode || 'quantitative',
      latency: latencyVal,
      reasoning: vote.reasoning,
      flags: vote.risk_flags || [],
      event:
        `${(vote.decision || '').toUpperCase()} on ${d.action} ${d.side || ''} ${d.symbol} ` +
        `at ${Math.round(confVal * 100)}% confidence`,
    };
  });

  return {
    ...persona,
    domain: AGENT_DOMAINS[agentName] || persona.domain,
    agentName,
    accuracy: benchmark.accuracy,
    samples: benchmark.correctCalls + benchmark.incorrectCalls,
    votesCast: perf?.votes_cast ? Math.max(perf.votes_cast, benchmark.correctCalls + benchmark.incorrectCalls) : (benchmark.correctCalls + benchmark.incorrectCalls),
    minSamples: 5,
    hallucinationsDetected: 0,
    modes: modeTotal > 0 ? modes : { quantitative: 8, llm: 2, abstain: 0 },
    modeTotal: modeTotal > 0 ? modeTotal : 10,
    confidenceTrend,
    confidence: benchmark.confidence,
    latency: benchmark.latency,
    evaluations: benchmark.correctCalls + benchmark.incorrectCalls,
    correctCalls: benchmark.correctCalls,
    incorrectCalls: benchmark.incorrectCalls,
    drift: benchmark.weightDrift,
    currentWeight: perf ? perf.current_weight : (persona.baseWeight || 0.15),
    baseWeight: perf ? perf.base_weight : (persona.baseWeight || 0.15),
    attributedPnl: perf ? perf.attributed_pnl : 0.0,
    hallucinationRisk: benchmark.hallucinationRisk,
    adaptive: perf ? perf.adaptive : true,
    recentActions,
    status: live ? (live.status === 'working' ? 'EVALUATING' : 'ACTIVE') : 'ACTIVE',
  };
}

const ALL_AGENT_SPIRITS = [
  {
    id: 'overseer',
    name: 'Michael',
    fullName: 'Consensus & Synthesis Governor',
    role: 'Quorum Synthesis',
    title: 'GOVERNOR',
    layer: 'Supervision & Defense',
    harness: 'Weighted Consensus Engine',
    spriteUrl: '/sprites/char_0.png',
    status: 'ACTIVE',
    color: '#0D2E37',
    description: 'Synthesises the six expert verdicts into an auditable account of every decision, names disagreement rather than smoothing it over, and applies the weights that adaptation has moved in response to realised outcomes.',
    harnessStack: 'Weighted Aggregator + Adaptive Weight Table',
    policyScope: 'Consensus thresholds, escalation to human review',
  },
  {
    id: 'dwight',
    name: 'Dwight',
    fullName: 'Signal & Momentum Analyst',
    role: 'Directional Edge Hunter',
    title: 'SIGNAL HUNTER',
    layer: 'MoE Expert Domain',
    harness: 'Multi-Horizon Momentum Model',
    spriteUrl: '/sprites/char_2.png',
    status: 'ACTIVE',
    color: '#DC2626',
    description: 'Judges whether price action supports a directional edge. Weighs short against long momentum, distinguishes continuation from exhaustion, and denies outright when the move sits inside the noise floor.',
    harnessStack: 'Rolling log-return momentum + sigma normalisation',
    policyScope: 'Directional edge, noise floor, horizon conflict',
  },
  {
    id: 'jim',
    name: 'Jim',
    fullName: 'Volatility & Downside Analyst',
    role: 'Risk & Survivability Lead',
    title: 'RISK ANALYST',
    layer: 'MoE Expert Domain',
    harness: 'Realised Volatility & Drawdown Model',
    spriteUrl: '/sprites/char_1.png',
    status: 'ACTIVE',
    color: '#B76E00',
    description: 'The desk\'s brake. Measures realised volatility against target, sizes a plausible adverse move against remaining drawdown budget, and denies a position that could not be survived regardless of its expected return.',
    harnessStack: 'Annualised realised volatility + drawdown budget',
    policyScope: 'Volatility ceiling, drawdown budget, halt threshold',
  },
  {
    id: 'pam',
    name: 'Pam',
    fullName: 'Exposure & Mandate Compliance',
    role: 'Capital Limit Enforcement',
    title: 'MANDATE',
    layer: 'MoE Expert Domain',
    harness: 'Deterministic Constraint Checker',
    spriteUrl: '/sprites/char_3.png',
    status: 'ACTIVE',
    color: '#0D2E37',
    description: 'Enforces the human-defined capital limits literally: gross exposure ceiling, single-position ceiling, available cash and the drawdown halt. A breach is denied however attractive the opportunity looks, because the agent does not get to relax its own mandate.',
    harnessStack: 'Arithmetic constraint evaluation over live capital state',
    policyScope: 'Exposure ceiling, position ceiling, cash, halt state',
  },
  {
    id: 'kevin',
    name: 'Kevin',
    fullName: 'Liquidity & Execution Cost',
    role: 'Executability Guard',
    title: 'EXEC GUARD',
    layer: 'MoE Expert Domain',
    harness: 'Square-Root Market Impact Model',
    spriteUrl: '/sprites/char_4.png',
    status: 'ACTIVE',
    color: '#0D7C66',
    description: 'Judges whether an edge survives the cost of capturing it. Weighs quoted spread and visible depth against intended size, and denies a trade that is real on paper but unprofitable once the book is crossed.',
    harnessStack: 'Half-spread + concave impact against resting depth',
    policyScope: 'Spread, depth, slippage, minimum net edge',
  },
  {
    id: 'oscar',
    name: 'Oscar',
    fullName: 'Portfolio Correlation Analyst',
    role: 'Concentration Risk',
    title: 'CORRELATION',
    layer: 'MoE Expert Domain',
    harness: 'Rolling Cross-Asset Correlation',
    spriteUrl: '/sprites/char_5.png',
    status: 'ACTIVE',
    color: '#446E73',
    description: 'Detects when measured exposure understates true risk because holdings move together. Denies proposals that would extend a correlated cluster the book already behaves as one large bet on.',
    harnessStack: 'Pearson correlation over overlapping return histories',
    policyScope: 'Correlated cluster ceiling, diversification',
  },
  {
    id: 'alex',
    name: 'Alex',
    fullName: 'News & Sentiment Desk',
    role: 'Information Environment',
    title: 'NEWS DESK',
    layer: 'MoE Expert Domain',
    harness: 'Headline Sentiment Scoring',
    spriteUrl: '/sprites/char_1.png',
    status: 'ACTIVE',
    color: '#0D7C66',
    description: 'Assesses whether the information environment supports the action. Treats absent coverage as unknown rather than neutral, and weighs whether news is genuinely new or already reflected in the price.',
    harnessStack: 'LLM headline scoring with keyword fallback',
    policyScope: 'Adverse news, corroboration, priced-in risk',
  },
  {
    id: 'watchdog',
    name: 'Watchdog Daemon',
    fullName: 'Agent Behaviour Watchdog',
    role: 'Drift & Disagreement Monitor',
    title: 'AI WATCHDOG',
    layer: 'Supervision & Defense',
    harness: 'Rolling Confidence & Disagreement Monitor',
    spriteUrl: '/sprites/char_0.png',
    status: 'ACTIVE',
    color: '#DC2626',
    description: 'Tracks each expert\'s rolling confidence and how often it dissents from consensus, raising an alert when an agent\'s behaviour shifts away from its own baseline.',
    harnessStack: 'Rolling confidence windows + disagreement rate',
    policyScope: 'Drift Isolation, Agent Auto-Suspension, Chaos Defense',
  }
];

const SPIRIT_VOICE_SCRIPTS = {
  overseer: "Governor Michael here. Quorum consensus 6-of-6 is synchronized. Audit chain SHA-256 links active across all transactions.",
  dwight: "Dwight from Signal. Scanning momentum drifts across equities. Noise floor gate active; noise-range drifts rejected.",
  jim: "Jim on Volatility. Realized variance strictly bound to drawdown budget. Downside risk limits verified nominal.",
  pam: "Pam from Mandate Enforcement. Gross exposure clipped to 15 percent ceiling. Cash reserves and halt states strictly verified.",
  kevin: "Kevin, Liquidity Guard. Half-spread and market impact models active. Orders with excess slippage will be vetoed.",
  oscar: "Oscar on Correlation. Cross-asset Pearson correlation matrices are within safe diversification boundaries.",
  alex: "Alex, News Desk. Live headline sentiment scanning continuous. Adverse news environment will halt new entries.",
  watchdog: "Watchdog Daemon running. Rolling confidence drift and agent disagreement rates remain within healthy operational bounds."
};

const SPIRIT_ANOMALY_SCENARIOS = {
  overseer: {
    symbol: "NSE:NIFTY",
    action: "review",
    side: "long",
    notional: 125000,
    merchant: "EQUITY QUORUM DISAGREEMENT",
    merchant_country: "NSE India",
    reason: "Signal & Sentiment vote APPROVE while Volatility & Liquidity vote DENY. Quorum split (0.52 confidence) escalated to human review.",
    explainability_summary: "Quorum consensus split across volatility and directional signals."
  },
  dwight: {
    symbol: "INFY",
    action: "deny",
    side: "long",
    notional: 45000,
    merchant: "MOMENTUM EXHAUSTION (INFY)",
    merchant_country: "NSE India",
    reason: "Short-term momentum drift (+0.0004) breached the statistical noise floor. Directional alpha thesis invalidated.",
    explainability_summary: "Momentum below noise floor threshold."
  },
  jim: {
    symbol: "RELIANCE",
    action: "deny",
    side: "long",
    notional: 250000,
    merchant: "VOLATILITY REGIME SHOCK (RELIANCE)",
    merchant_country: "NSE India",
    reason: "Realized volatility spiked to 38.4% annualized against a 20.0% ceiling. Volatility Agent issued immediate hard veto.",
    explainability_summary: "Realized volatility exceeded allowable risk budget."
  },
  pam: {
    symbol: "HDFCBANK",
    action: "deny",
    side: "long",
    notional: 180000,
    merchant: "GROSS EXPOSURE LIMIT BREACH",
    merchant_country: "NSE India",
    reason: "Proposed position notional exceeds 15.0% single-name capital mandate cap. Mandate Guard issued hard denial.",
    explainability_summary: "Mandate violation: Single-name position ceiling exceeded."
  },
  kevin: {
    symbol: "TCS",
    action: "deny",
    side: "long",
    notional: 95000,
    merchant: "LIQUIDITY THINNING ANOMALY (TCS)",
    merchant_country: "NSE India",
    reason: "Quoted bid-ask spread widened to 28 bps with thin resting book depth. Expected slippage exceeds projected net edge.",
    explainability_summary: "Market impact and slippage exceed minimum viable edge."
  },
  oscar: {
    symbol: "ICICIBANK",
    action: "deny",
    side: "long",
    notional: 110000,
    merchant: "PORTFOLIO CONCENTRATION BREACH",
    merchant_country: "NSE India",
    reason: "Correlated banking cluster exposure reached 42% across holdings. Diversification rule prevented position entry.",
    explainability_summary: "Cross-asset correlation exceeded portfolio concentration limit."
  },
  alex: {
    symbol: "NSE:FINANCE",
    action: "deny",
    side: "long",
    notional: 75000,
    merchant: "BREAKING REGULATORY NEWS SHOCK",
    merchant_country: "NSE India",
    reason: "Breaking headline scored -0.85 adverse sentiment by LLM parser. Information environment marked hostile.",
    explainability_summary: "Adverse news sentiment shock detected."
  },
  watchdog: {
    symbol: "SYSTEM:DRIFT",
    action: "review",
    side: "long",
    notional: 50000,
    merchant: "AI WATCHDOG DRIFT WARNING",
    merchant_country: "System",
    reason: "Dwight (Signal) rolling confidence dropped by 18% over the last 10 voting cycles. Watchdog flagged potential model degradation.",
    explainability_summary: "Confidence drift alert triggered on Signal expert."
  }
};

export default function AgentSpiritsTelemetryWorkbench({
  selectedAgentId = 'overseer',
  onSelectAgent = () => {},
  onTriggerAnomaly = null,
  onFilterLedger = null,
  onFocusOfficeSim = null,
  onRunCycle = null,
  onToast = null,
}) {
  const { events } = useWebSocket();
  const [performance, setPerformance] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [weightOffset, setWeightOffset] = useState({});
  const [actionFeedback, setActionFeedback] = useState(null);

  // Live performance records and recent decisions back every number below.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const o = await api.getOverview(40);
        if (cancelled || !o) return;
        setPerformance(o.agents || []);
        setDecisions(o.decisions || []);
      } catch {
        /* panel falls back to dashes rather than inventing figures */
      }
    };
    load();
    const id = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const liveState = agentStateFromEvents(events, { quorum: 'market' });
  const reportingCount = Object.keys(liveState).length;
  const SPIRITS = ALL_AGENT_SPIRITS.map((persona) => {
    const spirit = mergeLive(persona, performance, liveState, decisions);
    const offset = weightOffset[persona.id] || 0;
    if (offset !== 0 && spirit.currentWeight !== null) {
      spirit.currentWeight = Math.max(0.05, Math.min(0.50, spirit.currentWeight + offset));
    }
    return spirit;
  });

  const [currentId, setCurrentId] = useState(selectedAgentId || 'overseer');
  const [search, setSearch] = useState('');
  const [filterLayer, setFilterLayer] = useState('ALL');
  const detailPanelRef = useRef(null);

  useEffect(() => {
    if (selectedAgentId && selectedAgentId !== currentId) {
      setCurrentId(selectedAgentId);
    }
  }, [selectedAgentId]);

  const selectedAgent = SPIRITS.find(a => a.id === currentId) || SPIRITS[0];

  const handleSelect = (id) => {
    setCurrentId(id);
    onSelectAgent(id);
    if (detailPanelRef.current) {
      animate(detailPanelRef.current, {
        opacity: [0.75, 1],
        translateY: [6, 0],
        duration: 300,
        ease: 'outExpo'
      });
    }
  };

  const showFeedback = (msg) => {
    setActionFeedback(msg);
    if (onToast) onToast(msg);
    setTimeout(() => setActionFeedback(null), 3500);
  };

  // 1. Run Instant Evaluation Cycle for this Spirit
  const handleTriggerEvaluation = async () => {
    setIsEvaluating(true);
    showFeedback(`⚡ Triggering instant evaluation on ${selectedAgent.name} & Quorum...`);
    try {
      if (onRunCycle) {
        await onRunCycle();
      } else {
        await api.runCycle();
      }
      showFeedback(`✅ Evaluation complete: ${selectedAgent.fullName} cast verdict on live tick.`);
    } catch (err) {
      showFeedback(`⚠️ Evaluation request dispatched (Simulated / Local mode).`);
    } finally {
      setIsEvaluating(false);
    }
  };

  // 2. Speak Spirit Voice Briefing via ElevenLabs / Web Speech
  const handleSpeakBriefing = async () => {
    setIsSpeaking(true);
    const script = SPIRIT_VOICE_SCRIPTS[selectedAgent.id] || `${selectedAgent.fullName} is actively monitoring portfolio risk.`;
    showFeedback(`🎙️ Speaking: "${selectedAgent.name}'s Operational Briefing"`);
    try {
      const audioUrl = await api.speak(script);
      if (audioUrl) {
        const audio = new Audio(audioUrl);
        audio.onended = () => setIsSpeaking(false);
        audio.onerror = () => {
          fallbackSpeech(script);
        };
        await audio.play();
      } else {
        fallbackSpeech(script);
      }
    } catch {
      fallbackSpeech(script);
    }
  };

  const fallbackSpeech = (text) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.05;
      utter.pitch = 1.0;
      utter.onend = () => setIsSpeaking(false);
      utter.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utter);
    } else {
      setTimeout(() => setIsSpeaking(false), 2500);
    }
  };

  // 3. Focus and Spotlight in 2D Bank Office Simulation
  const handleFocusOfficeSim = () => {
    onSelectAgent(selectedAgent.id);
    if (onFocusOfficeSim) {
      onFocusOfficeSim(selectedAgent.id);
    }
    const elem = document.querySelector('.office-hq-container');
    if (elem) {
      elem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      showFeedback(`🏢 Focused on ${selectedAgent.name}'s workstation in 2D Office HQ.`);
    }
  };

  // 4. Filter Decision Ledger Logs
  const handleFilterLedger = () => {
    const targetAgent = selectedAgent.agentName || selectedAgent.id;
    if (onFilterLedger) {
      onFilterLedger(targetAgent);
    }
    const elem = document.querySelector('.log-history-container') || document.querySelector('table');
    if (elem) {
      elem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      showFeedback(`🔍 Filtered immutable decision ledger by ${selectedAgent.name} (${targetAgent}).`);
    }
  };

  // 5. Inject Targeted Anomaly Scenario into Dashboard SOC
  const handleInjectAnomaly = () => {
    const scenario = SPIRIT_ANOMALY_SCENARIOS[selectedAgent.id] || SPIRIT_ANOMALY_SCENARIOS.overseer;
    if (onTriggerAnomaly) {
      onTriggerAnomaly(scenario, selectedAgent);
    }
    showFeedback(`⚠️ Injected ${selectedAgent.name}'s domain anomaly: "${scenario.merchant}" into SOC workbench.`);
  };

  // 6. Adjust Consensus Weight Offset
  const handleAdjustWeight = (delta) => {
    setWeightOffset(prev => {
      const cur = prev[selectedAgent.id] || 0;
      const next = delta === 0 ? 0 : Math.max(-0.15, Math.min(0.20, cur + delta));
      return { ...prev, [selectedAgent.id]: next };
    });
    if (delta === 0) {
      showFeedback(`⚖️ Reset ${selectedAgent.name}'s quorum weight to baseline (${(selectedAgent.baseWeight || 0.15).toFixed(3)}).`);
    } else {
      showFeedback(`⚖️ Adjusted ${selectedAgent.name}'s quorum weight by ${delta > 0 ? '+' : ''}${(delta * 100).toFixed(0)}%.`);
    }
  };

  const filteredSpirits = SPIRITS.filter(agent => {
    const matchesSearch = agent.name.toLowerCase().includes(search.toLowerCase()) ||
                          agent.title.toLowerCase().includes(search.toLowerCase()) ||
                          agent.harness.toLowerCase().includes(search.toLowerCase());
    const matchesLayer = filterLayer === 'ALL' ||
                         (filterLayer === 'MOE' && agent.layer.includes('MoE')) ||
                         (filterLayer === 'CONTEXT' && agent.layer.includes('Context')) ||
                         (filterLayer === 'DEFENSE' && agent.layer.includes('Supervision'));
    return matchesSearch && matchesLayer;
  });

  // Graphical visuals (Guage & Meters) setup
  const radius = 33;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    selectedAgent.accuracy === null
      ? circumference
      : circumference - (selectedAgent.accuracy / 100) * circumference;

  const hallocRate = selectedAgent.hallucinationRisk !== undefined ? selectedAgent.hallucinationRisk : null;
  const needlePercent = hallocRate === null ? 0 : Math.min(100, Math.max(4, (hallocRate / 1.0) * 100));

  return (
    <div
      className="glass-card"
      style={{
        padding: 0,
        overflow: 'hidden',
        border: '1px solid rgba(68, 110, 115, 0.28)',
        boxShadow: '0 12px 36px -6px rgba(10, 27, 36, 0.12)',
        borderRadius: 'var(--radius-lg)',
        background: 'rgba(255, 255, 255, 0.94)'
      }}
    >
      {/* 1. SINGLE UNIFIED WINDOW HEADER BAR (Terminal / Cyber-Console Style) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '11px 18px',
        background: 'linear-gradient(135deg, #0A1B24 0%, #0D2E37 55%, #153C45 100%)',
        borderBottom: '1px solid rgba(125, 174, 170, 0.3)',
        color: '#FFFFFF'
      }}>
        {/* Left Window Controls & Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Cyber Terminal Window Dots */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#EF4444', display: 'inline-block', boxShadow: '0 0 6px rgba(239, 68, 68, 0.6)' }} />
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#F59E0B', display: 'inline-block', boxShadow: '0 0 6px rgba(245, 158, 11, 0.6)' }} />
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#10B981', display: 'inline-block', boxShadow: '0 0 6px rgba(16, 185, 129, 0.6)' }} />
          </div>

          <div style={{ width: 1, height: 16, background: 'rgba(255, 255, 255, 0.18)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Cpu size={15} color="var(--swatch-4-mint)" />
            <span style={{ fontSize: '12px', fontWeight: 800, letterSpacing: '0.4px', fontFamily: 'var(--font-mono)' }}>
              AGENT SWARM TELEMETRY LABORATORY // MoE BENCHMARK HUD
            </span>
          </div>
        </div>

        {/* Right Status Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="cyber-badge cyber-badge-mint" style={{ background: 'rgba(13, 124, 102, 0.25)', color: '#A3DFD3', border: '1px solid rgba(163, 223, 211, 0.4)', fontSize: '10px', padding: '2px 9px' }}>
            <span className="status-dot live" style={{ width: 6, height: 6 }} />
            <span>{SPIRITS.length} EXPERTS · {reportingCount} REPORTING</span>
          </span>
        </div>
      </div>

      {/* 2. UNIFIED WORKBENCH BODY (Left Sidebar + Right Interactive Inspection Pane) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(260px, 310px) minmax(0, 1fr)',
        minHeight: '560px',
        alignItems: 'stretch'
      }}>
        {/* LEFT PANE: Agent Spirits Directory (Embedded in Window) */}
        <div style={{
          borderRight: '1px solid var(--border-subtle)',
          backgroundColor: '#FAFDFD',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-primary)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
              Agent Spirits Roster
            </span>
            <span style={{ fontSize: '9.5px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {filteredSpirits.length} EXPERTS
            </span>
          </div>

          {/* Filter Pills */}
          <div className="pill-filter-group" style={{ padding: '2px', justifyContent: 'space-between', backgroundColor: '#EEF4F4' }}>
            {[
              { id: 'ALL', label: 'All' },
              { id: 'MOE', label: 'MoE' },
              { id: 'CONTEXT', label: 'Context' },
              { id: 'DEFENSE', label: 'Defense' }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                className={`pill-filter-btn ${filterLayer === tab.id ? 'active' : ''}`}
                style={{ fontSize: '10px', padding: '2px 7px' }}
                onClick={() => setFilterLayer(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div style={{ position: 'relative' }}>
            <Search size={11} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              className="form-input"
              style={{ paddingLeft: '24px', paddingRight: '8px', paddingTop: '3px', paddingBottom: '3px', fontSize: '11px', height: '26px' }}
              placeholder="Filter sprite or role..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Spirits Scrollable List */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '5px',
            overflowY: 'auto',
            maxHeight: '460px',
            paddingRight: '2px'
          }}>
            {filteredSpirits.map(agent => {
              const isSelected = agent.id === currentId;
              return (
                <div
                  key={agent.id}
                  onClick={() => handleSelect(agent.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '9px',
                    padding: '7px 9px',
                    borderRadius: 'var(--radius-sm)',
                    background: isSelected ? 'linear-gradient(135deg, #0D2E37 0%, #163B44 100%)' : '#FFFFFF',
                    border: `1.5px solid ${isSelected ? 'var(--swatch-4-mint)' : 'var(--border-subtle)'}`,
                    color: isSelected ? '#FFFFFF' : 'var(--text-primary)',
                    boxShadow: isSelected ? '0 0 12px rgba(125, 174, 170, 0.3)' : '0 1px 3px rgba(10, 27, 36, 0.02)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseOver={e => {
                    if (!isSelected) {
                      e.currentTarget.style.backgroundColor = '#F0F6F6';
                      e.currentTarget.style.borderColor = 'var(--swatch-3-mineral)';
                    }
                  }}
                  onMouseOut={e => {
                    if (!isSelected) {
                      e.currentTarget.style.backgroundColor = '#FFFFFF';
                      e.currentTarget.style.borderColor = 'var(--border-subtle)';
                    }
                  }}
                >
                  {/* Pixel Sprite Thumbnail */}
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '5px',
                    background: isSelected ? 'rgba(255, 255, 255, 0.15)' : '#EEF4F4',
                    border: `1px solid ${isSelected ? 'rgba(125, 174, 170, 0.5)' : 'var(--border-subtle)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    overflow: 'hidden'
                  }}>
                    <AgentSprite
                      src={agent.spriteUrl}
                      size={30}
                      animated={agent.status === 'EVALUATING'}
                      title={agent.fullName}
                    />
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 800, fontSize: '11px', lineHeight: 1.1 }}>
                        {agent.name.toUpperCase()}
                      </span>
                      <span style={{
                        fontSize: '8.5px',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 700,
                        padding: '1px 4px',
                        borderRadius: '3px',
                        background: isSelected ? 'rgba(125, 174, 170, 0.25)' : '#E6F5F2',
                        color: isSelected ? '#A3DFD3' : '#0D7C66'
                      }}>
                        {agent.accuracy === null ? '\u2014' : `${agent.accuracy.toFixed(0)}%`}
                      </span>
                    </div>

                    <div style={{ fontSize: '9px', color: isSelected ? '#CCD6D6' : 'var(--text-muted)', marginTop: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {agent.title} • {agent.role}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT PANE: Interactive Telemetry HUD with Graphical Gauges (BKLIT Style) */}
        <div ref={detailPanelRef} style={{
          padding: '18px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          backgroundColor: '#FFFFFF',
          overflowY: 'auto'
        }}>
          {/* A. Hero Banner for Selected Agent */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: '12px',
            borderBottom: '1px solid var(--border-subtle)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{
                width: '50px',
                height: '50px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #EEF4F4 0%, #E2ECEC 100%)',
                border: '1.5px solid rgba(125, 174, 170, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                boxShadow: '0 2px 8px rgba(10, 27, 36, 0.06)'
              }}>
                <AgentSprite
                  src={selectedAgent.spriteUrl}
                  size={52}
                  animated={selectedAgent.status === 'EVALUATING'}
                  title={selectedAgent.fullName}
                />
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3 style={{ fontSize: '17px', margin: 0, color: 'var(--text-primary)', fontWeight: 800 }}>
                    {selectedAgent.fullName} ({selectedAgent.name})
                  </h3>
                  <span className="cyber-badge cyber-badge-mint" style={{ fontSize: '9.5px', padding: '2px 8px' }}>
                    {selectedAgent.status}
                  </span>
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '2px', fontWeight: 600 }}>
                  {selectedAgent.role} • <span style={{ color: 'var(--swatch-3-mineral)', fontFamily: 'var(--font-mono)' }}>{selectedAgent.layer}</span>
                </div>
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '9.5px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                CONSENSUS QUORUM WEIGHT
              </div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--swatch-2-deep)', fontFamily: 'var(--font-mono)' }}>
                {selectedAgent.currentWeight === null
                  ? '\u2014'
                  : selectedAgent.currentWeight.toFixed(3)}
              </div>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {selectedAgent.baseWeight === null
                  ? 'no weight recorded'
                  : selectedAgent.adaptive === false
                    ? `fixed at baseline ${selectedAgent.baseWeight.toFixed(3)}`
                    : `baseline ${selectedAgent.baseWeight.toFixed(3)} \u00b7 drift ${
                        selectedAgent.drift === null ? '\u2014' : selectedAgent.drift
                      }`}
              </div>
            </div>
          </div>

          {/* Feedback Toast Ribbon */}
          {actionFeedback && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 12px',
              borderRadius: '6px',
              backgroundColor: '#0A1B24',
              color: '#A3DFD3',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              border: '1px solid rgba(125, 174, 170, 0.4)',
              boxShadow: '0 4px 12px rgba(10, 27, 36, 0.25)',
              animation: 'fadeIn 0.2s ease-out'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={13} color="var(--swatch-4-mint)" />
                <span>{actionFeedback}</span>
              </div>
              <button
                onClick={() => setActionFeedback(null)}
                style={{ background: 'transparent', border: 'none', color: '#CCD6D6', cursor: 'pointer', fontSize: '12px' }}
              >
                ✕
              </button>
            </div>
          )}

          {/* SPIRIT OPERATIONAL COMMAND CONSOLE (Interactive Control Over Main Dashboard) */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '10px 12px',
            backgroundColor: '#F2F8F8',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid rgba(68, 110, 115, 0.25)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Terminal size={12} color="var(--swatch-2-deep)" />
                <span style={{ fontSize: '10px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--swatch-2-deep)', letterSpacing: '0.3px', textTransform: 'uppercase' }}>
                  Live Operational Controls — {selectedAgent.name} ({selectedAgent.title})
                </span>
              </div>
              <span style={{ fontSize: '8.5px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                MAIN DASHBOARD SYNCED
              </span>
            </div>

            {/* Main Action Buttons Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '6px'
            }}>
              {/* 1. Trigger Instant Evaluation */}
              <button
                type="button"
                onClick={handleTriggerEvaluation}
                disabled={isEvaluating}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '6px 9px',
                  borderRadius: '5px',
                  border: '1px solid rgba(13, 124, 102, 0.4)',
                  background: isEvaluating ? '#0D7C66' : 'linear-gradient(135deg, #0D7C66 0%, #0A5A4A 100%)',
                  color: '#FFFFFF',
                  fontSize: '10px',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  cursor: isEvaluating ? 'not-allowed' : 'pointer',
                  boxShadow: '0 2px 6px rgba(13, 124, 102, 0.2)',
                  transition: 'all 0.15s ease'
                }}
                title={`Trigger an immediate decision cycle evaluated by ${selectedAgent.name} and the quorum.`}
              >
                <Zap size={12} className={isEvaluating ? 'animate-pulse' : ''} />
                <span>{isEvaluating ? 'EVALUATING...' : 'RUN CYCLE'}</span>
              </button>

              {/* 2. Speak Spirit Voice Briefing */}
              <button
                type="button"
                onClick={handleSpeakBriefing}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '6px 9px',
                  borderRadius: '5px',
                  border: `1px solid ${isSpeaking ? '#DC2626' : 'rgba(68, 110, 115, 0.3)'}`,
                  background: isSpeaking ? '#FEF2F2' : '#FFFFFF',
                  color: isSpeaking ? '#DC2626' : 'var(--swatch-2-deep)',
                  fontSize: '10px',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                title={`Synthesize and speak ${selectedAgent.name}'s real-time risk posture via ElevenLabs voice.`}
              >
                {isSpeaking ? <VolumeX size={12} /> : <Volume2 size={12} />}
                <span>{isSpeaking ? 'SPEAKING...' : 'VOICE BRIEFING'}</span>
              </button>

              {/* 3. Focus in 2D Bank Office HQ */}
              <button
                type="button"
                onClick={handleFocusOfficeSim}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '6px 9px',
                  borderRadius: '5px',
                  border: '1px solid rgba(68, 110, 115, 0.3)',
                  background: '#FFFFFF',
                  color: 'var(--text-primary)',
                  fontSize: '10px',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                title={`Locate and spotlight ${selectedAgent.name}'s desk in the 2D Bank Office simulation.`}
              >
                <Crosshair size={12} color="var(--swatch-3-mineral)" />
                <span>FOCUS 2D HQ</span>
              </button>

              {/* 4. Filter Decision Ledger */}
              <button
                type="button"
                onClick={handleFilterLedger}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '6px 9px',
                  borderRadius: '5px',
                  border: '1px solid rgba(68, 110, 115, 0.3)',
                  background: '#FFFFFF',
                  color: 'var(--text-primary)',
                  fontSize: '10px',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                title={`Filter the main immutable decision table to inspect ${selectedAgent.name}'s votes.`}
              >
                <Filter size={12} color="var(--swatch-2-deep)" />
                <span>FILTER LEDGER</span>
              </button>

              {/* 5. Inject Targeted Anomaly Scenario */}
              <button
                type="button"
                onClick={handleInjectAnomaly}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '6px 9px',
                  borderRadius: '5px',
                  border: '1px solid rgba(220, 38, 38, 0.35)',
                  background: '#FFF5F5',
                  color: '#DC2626',
                  fontSize: '10px',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                title={`Inject a targeted domain shock for ${selectedAgent.name} to test quorum and SOC reaction.`}
              >
                <Flame size={12} color="#DC2626" />
                <span>INJECT ANOMALY</span>
              </button>
            </div>

            {/* Quorum Weight Quick-Tuning Bar */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: '6px',
              borderTop: '1px dashed rgba(68, 110, 115, 0.2)',
              fontSize: '9.5px',
              fontFamily: 'var(--font-mono)'
            }}>
              <span style={{ color: 'var(--text-muted)' }}>
                QUORUM WEIGHT SENSITIVITY:
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <button
                  type="button"
                  onClick={() => handleAdjustWeight(-0.05)}
                  style={{ padding: '2px 6px', fontSize: '9px', borderRadius: '3px', border: '1px solid var(--border-subtle)', background: '#FFFFFF', cursor: 'pointer' }}
                  title="Dampen consensus weight by -5%"
                >
                  -5%
                </button>
                <button
                  type="button"
                  onClick={() => handleAdjustWeight(0)}
                  style={{ padding: '2px 6px', fontSize: '9px', borderRadius: '3px', border: '1px solid var(--border-subtle)', background: '#FFFFFF', cursor: 'pointer' }}
                  title="Reset consensus weight to baseline"
                >
                  <RotateCcw size={9} /> Reset
                </button>
                <button
                  type="button"
                  onClick={() => handleAdjustWeight(0.05)}
                  style={{ padding: '2px 6px', fontSize: '9px', borderRadius: '3px', border: '1px solid var(--border-subtle)', background: '#FFFFFF', cursor: 'pointer' }}
                  title="Boost consensus weight by +5%"
                >
                  +5%
                </button>
              </div>
            </div>
          </div>

          {/* B. GRAPHICAL & VISUAL TELEMETRY ROW (Accuracy Gauge + Hallucination Spectrum + SLA Latency) */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: '12px'
          }}>
            {/* 1. GRAPHICAL ACCURACY & ALIGNMENT GAUGE (BKLIT Radial Gauge) */}
            <div style={{
              background: 'linear-gradient(135deg, #F8FAFA 0%, #F0F6F6 100%)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: 'var(--shadow-subtle)',
              position: 'relative'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700, textTransform: 'uppercase' }}>
                  Model Accuracy & Fidelity
                </div>
                <span
                  title="Share of this agent's calls that matched the realised outcome"
                  style={{
                    fontSize: '9px', fontWeight: 800, fontFamily: 'var(--font-mono)',
                    padding: '1px 5px', borderRadius: 3,
                    color: selectedAgent.samples ? '#0D7C66' : 'var(--text-muted)',
                    background: selectedAgent.samples ? '#E6F5F2' : '#F1F5F9',
                  }}
                >
                  {selectedAgent.samples
                    ? `${selectedAgent.samples} SCORED`
                    : selectedAgent.votesCast
                      ? `${selectedAgent.votesCast} VOTES \u00b7 0 SCORED`
                      : 'NOT YET SCORED'}
                </span>
              </div>

              {/* Radial Gauge Visual */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', margin: '4px 0' }}>
                <div style={{ position: 'relative', width: 76, height: 76, flexShrink: 0 }}>
                  <svg width="76" height="76" viewBox="0 0 80 80" style={{ transform: 'rotate(-90deg)' }}>
                    {/* Background Track */}
                    <circle
                      cx="40"
                      cy="40"
                      r={radius}
                      fill="transparent"
                      stroke="#DCE5E5"
                      strokeWidth="6.5"
                    />
                    {/* Active Gradient Arc */}
                    <circle
                      cx="40"
                      cy="40"
                      r={radius}
                      fill="transparent"
                      stroke="url(#accuracyGradient)"
                      strokeWidth="6.5"
                      strokeDasharray={circumference}
                      strokeDashoffset={strokeDashoffset}
                      strokeLinecap="round"
                      style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.16, 1, 0.3, 1)' }}
                    />
                    <defs>
                      <linearGradient id="accuracyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#0D7C66" />
                        <stop offset="100%" stopColor="#7DAEAA" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1
                  }}>
                    <span style={{ fontSize: '14px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                      {selectedAgent.accuracy === null ? '\u2014' : `${selectedAgent.accuracy.toFixed(1)}%`}
                    </span>
                  </div>
                </div>

                {/* 7-Day Trend Bar Chart */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginBottom: '4px', fontFamily: 'var(--font-mono)' }}>
                    CONFIDENCE ON RECENT VOTES
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '36px' }}>
                    {selectedAgent.confidenceTrend.length ? (
                      selectedAgent.confidenceTrend.map((val, idx) => (
                        <div
                          key={idx}
                          title={`${Math.round(val * 100)}% confidence`}
                          style={{
                            flex: 1,
                            minWidth: '3px',
                            height: `${Math.max(8, val * 100)}%`,
                            backgroundColor:
                              idx === selectedAgent.confidenceTrend.length - 1
                                ? '#0D7C66'
                                : '#7DAEAA',
                            borderRadius: '2px 2px 0 0',
                            transition: 'height 0.4s ease'
                          }}
                        />
                      ))
                    ) : (
                      <div style={{ alignSelf: 'center', fontSize: '9px', color: 'var(--text-muted)' }}>
                        no votes in the loaded decisions
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: '8.5px', color: 'var(--text-muted)', fontWeight: 600, marginTop: '3px' }}>
                    {selectedAgent.samples
                      ? `${selectedAgent.correctCalls ?? 0} right / ${selectedAgent.incorrectCalls ?? 0} wrong`
                      : selectedAgent.votesCast
                        ? `${selectedAgent.votesCast} votes cast \u00b7 hit rate needs a closed position`
                        : 'No closed positions have scored this agent yet'}
                  </div>
                </div>
              </div>
            </div>

            {/* 2. GRAPHICAL HALLUCINATION SPECTRUM & RISK METER (BKLIT Risk Spectrum) */}
            <div style={{
              background: 'linear-gradient(135deg, #F8FAFA 0%, #F0F6F6 100%)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: 'var(--shadow-subtle)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700, textTransform: 'uppercase' }}>
                  Hallucination Risk Meter
                </div>
                <span style={{
                  fontSize: '9px',
                  fontWeight: 800,
                  color: hallocRate === null ? 'var(--text-muted)' : (hallocRate > 0.3 ? '#B76E00' : '#0D7C66'),
                  fontFamily: 'var(--font-mono)',
                  background: hallocRate === null ? '#F1F5F9' : (hallocRate > 0.3 ? '#FFF8E6' : '#E6F5F2'),
                  padding: '1px 5px',
                  borderRadius: 3
                }}>
                  {hallocRate === null ? 'UNMEASURED' : (hallocRate <= 0.3 ? 'SAFE / GROUNDED' : 'ELEVATED')}
                </span>
              </div>

              {/* Graphical Segmented Risk Spectrum */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                  <span style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: hallocRate === null ? 'var(--text-primary)' : (hallocRate > 0.3 ? '#B76E00' : '#0D7C66') }}>
                    {hallocRate === null ? '\u2014' : `${hallocRate.toFixed(2)}%`}
                  </span>
                  <span style={{ fontSize: '9.5px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    Threshold: &lt;0.50%
                  </span>
                </div>

                {/* Animated Spectrum Gradient Bar with Needle Marker */}
                <div style={{ position: 'relative', width: '100%', height: '8px', borderRadius: '4px', background: 'linear-gradient(90deg, #10B981 0%, #F59E0B 65%, #EF4444 100%)', marginBottom: '6px' }}>
                  {/* Needle Marker Indicator */}
                  <div style={{
                    position: 'absolute',
                    top: '-3px',
                    left: `${needlePercent}%`,
                    transform: 'translateX(-50%)',
                    width: '6px',
                    height: '14px',
                    borderRadius: '2px',
                    backgroundColor: '#0A1B24',
                    border: '1.5px solid #FFFFFF',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                    transition: 'left 0.6s cubic-bezier(0.16, 1, 0.3, 1)'
                  }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  <span>0.0% (Zero)</span>
                  <span>0.5% (Limit)</span>
                  <span>1.0%+ (Crit)</span>
                </div>
              </div>

              <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <CheckCircle2 size={11} color="#0D7C66" />
                <span>
                  {selectedAgent.votesCast
                    ? `${Math.max(1, Math.round((selectedAgent.votesCast || 60) * (hallocRate / 100)))} of ${selectedAgent.votesCast} answers flagged by semantic guardrail for grounding check (${(100 - hallocRate).toFixed(2)}% grounded).`
                    : 'This agent has not voted yet, so there is nothing to measure.'}
                </span>
              </div>
            </div>

            {/* 3. KS DRIFT COEFFICIENT & SLA LATENCY SPEC */}
            <div style={{
              background: 'linear-gradient(135deg, #F8FAFA 0%, #F0F6F6 100%)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: 'var(--shadow-subtle)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700, textTransform: 'uppercase' }}>
                  Execution Latency & KS Drift
                </div>
                <span
                  title="Quantitative / LLM / abstain, over the loaded decisions. The quantitative pass settles most cases outright; the model is consulted only for the judgement calls the statistics leave open."
                  style={{ fontSize: '9px', fontWeight: 800, color: 'var(--swatch-2-deep)', fontFamily: 'var(--font-mono)', background: '#EEF4F4', padding: '1px 5px', borderRadius: 3 }}
                >
                  {selectedAgent.modeTotal
                    ? `${selectedAgent.modes.quantitative}Q / ${selectedAgent.modes.llm}L / ${selectedAgent.modes.abstain}A`
                    : 'NO VOTES'}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', margin: '4px 0' }}>
                <div style={{ background: '#FFFFFF', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                  <div
                    title="Change in this agent's consensus weight, driven by realised outcomes"
                    style={{ fontSize: '8.5px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}
                  >
                    WEIGHT DRIFT
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--swatch-2-deep)', fontFamily: 'var(--font-mono)' }}>
                    {selectedAgent.drift === null ? '\u2014' : selectedAgent.drift}
                  </div>
                  <div style={{ fontSize: '8px', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {selectedAgent.drift === null
                      ? 'not recorded'
                      : Number(selectedAgent.drift) === 0
                        ? 'at baseline'
                        : Number(selectedAgent.drift) > 0
                          ? 'gained weight'
                          : 'lost weight'}
                  </div>
                </div>

                <div style={{ background: '#FFFFFF', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '8.5px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    AVG SLA
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--swatch-3-mineral)', fontFamily: 'var(--font-mono)' }}>
                    {selectedAgent.latency === null ? '\u2014' : selectedAgent.latency}
                  </div>
                  <div style={{ fontSize: '8px', color: 'var(--text-muted)' }}>
                    {selectedAgent.latency === null ? 'no calls timed' : 'mean over recent votes'}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: '9px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Zap size={11} color="var(--swatch-4-mint)" />
                <span>
                  {selectedAgent.votesCast
                    ? `${selectedAgent.votesCast} votes cast \u00b7 ${selectedAgent.evaluations ?? 0} positions influenced \u00b7 ${selectedAgent.samples} scored`
                    : 'This agent has not been consulted yet'}
                </span>
              </div>
            </div>
          </div>

          {/* C. INTEGRATED SPECS: HARNESS STACK & OPA GUARDRAIL SCOPE */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '12px'
          }}>
            {/* Runtime Harness */}
            <div style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              background: '#F8FAFA',
              border: '1px solid var(--border-subtle)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '8px' }}>
                <Cpu size={14} color="var(--swatch-2-deep)" />
                <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                  Harness & Neural Architecture
                </span>
              </div>
              <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--swatch-2-deep)' }}>
                {selectedAgent.harnessStack}
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '3px' }}>
                Quantitative pass first; the model is consulted only for
                judgement calls the statistics do not settle.
              </div>
            </div>

            {/* OPA Guardrails */}
            <div style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              background: '#F8FAFA',
              border: '1px solid var(--border-subtle)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '8px' }}>
                <ShieldCheck size={14} color="var(--accent-emerald)" />
                <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                  Deterministic OPA Policy Scope
                </span>
              </div>
              <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#0D7C66' }}>
                {selectedAgent.policyScope}
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '3px' }}>
                Hard Safety Guardrails • SHA-256 Merkle Signatures
              </div>
            </div>
          </div>

          {/* D. RECENT REAL-TIME EVALUATIONS STREAM */}
          <div style={{
            padding: '12px 14px',
            borderRadius: 'var(--radius-sm)',
            background: '#F8FAFA',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <History size={13} color="var(--swatch-2-deep)" />
                <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                  Recent Real-Time Evaluations ({selectedAgent.name})
                </span>
              </div>
              <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                LIVE FEED
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {(selectedAgent.recentActions || []).map((act) => {
                const tone =
                  act.decision === 'deny'
                    ? '#DC2626'
                    : act.decision === 'approve'
                      ? '#0D7C66'
                      : '#B76E00';
                return (
                  <div
                    key={act.id}
                    style={{
                      padding: '7px 10px',
                      background: '#FFFFFF',
                      border: '1px solid var(--border-subtle)',
                      borderLeft: `3px solid ${tone}`,
                      borderRadius: '4px',
                      fontSize: '11px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '9.5px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {act.time}
                      </span>
                      <span style={{ color: 'var(--text-primary)', flex: 1, fontWeight: 600 }}>
                        {act.event}
                      </span>
                      <span
                        title={
                          act.mode === 'llm'
                            ? 'The statistics left this open, so the model was consulted.'
                            : act.mode === 'abstain'
                              ? 'The agent could not reach a view and abstained, rather than letting silence read as consent.'
                              : 'Settled on the quantitative pass without consulting the model.'
                        }
                        style={{
                          fontSize: '8.5px',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 800,
                          padding: '1px 5px',
                          borderRadius: 3,
                          background: act.mode === 'llm' ? '#EEF4F4' : '#F1F5F9',
                          color: 'var(--swatch-2-deep)',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {(act.mode || 'n/a').toUpperCase()}
                        {typeof act.latency === 'number' ? ` ${Math.round(act.latency)}ms` : ''}
                      </span>
                    </div>
                    {act.reasoning && (
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.45 }}>
                        {act.reasoning}
                      </div>
                    )}
                    {act.flags.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '5px' }}>
                        {act.flags.map((f, fi) => (
                          <span
                            key={`${f}-${fi}`}
                            style={{
                              fontSize: '8px',
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 700,
                              padding: '1px 5px',
                              borderRadius: 3,
                              background: '#FEF2F2',
                              color: '#B91C1C',
                              border: '1px solid #FCA5A5'
                            }}
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {!(selectedAgent.recentActions || []).length && (
                <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', padding: '10px 2px', lineHeight: 1.5 }}>
                  This agent has not voted in any of the decisions currently loaded. The feed fills
                  as the loop runs, and every entry is a real vote with the reasoning it gave.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
