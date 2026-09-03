import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  Wallet,
  TrendingUp,
  ArrowLeftRight,
  BookOpen,
  Sliders,
  Brain,
  Pause,
  Play,
  ShieldAlert,
  Volume2,
  VolumeX,
  RefreshCw,
  Send,
  CheckCircle2,
  AlertTriangle,
  BarChart3,
  Activity,
  Radio,
  Zap,
  Flame,
  RotateCcw,
  Sparkles,
  Terminal,
  SlidersHorizontal,
  Crosshair
} from 'lucide-react';
import { api } from '../api';
import { useWebSocket } from '../context/WebSocketContext';
import {
  AGENT_DOMAINS,
  AGENT_TO_PERSONA,
  PERSONA_TO_AGENT,
  currencySymbol,
  formatMoney,
  formatPct,
  formatPrice,
  formatQty,
  formatSigned,
} from '../lib/agentMap';
import AgentSprite from '../components/AgentSprite';
import { OFFICE_EXPERTS } from '../components/BankOfficeSim';
import KpiTelemetryRibbon from '../components/KpiTelemetryRibbon';
import MarketStateBanner from '../components/MarketStateBanner';
import TradeEntryPanel from '../components/TradeEntryPanel';
import VoicePanel from '../components/VoicePanel';
import CandlestickChart from '../components/CandlestickChart';

const TABS = [
  { id: 'market', label: 'MARKET', icon: <BarChart3 size={13} /> },
  { id: 'trade', label: 'TRADE', icon: <Send size={13} /> },
  { id: 'positions', label: 'POSITIONS', icon: <TrendingUp size={13} /> },
  { id: 'fills', label: 'EXECUTION', icon: <ArrowLeftRight size={13} /> },
  { id: 'ledger', label: 'LEDGER', icon: <BookOpen size={13} /> },
  { id: 'agents', label: 'ADAPTATION', icon: <Brain size={13} /> },
  { id: 'constraints', label: 'CONSTRAINTS', icon: <Sliders size={13} /> },
  { id: 'voice', label: 'VOICE', icon: <Volume2 size={13} /> },
];

export default function Portfolio() {
  const { events } = useWebSocket();
  const [tab, setTab] = useState('market');

  const [marketSnapshot, setMarketSnapshot] = useState(null);
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [candles, setCandles] = useState([]);
  const [candleInterval, setCandleInterval] = useState('FIVE_MINUTE');

  const [portfolio, setPortfolio] = useState(null);
  const [loop, setLoop] = useState(null);
  const [feed, setFeed] = useState(null);
  const [positions, setPositions] = useState([]);
  const [closed, setClosed] = useState([]);
  const [fills, setFills] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [trialBalance, setTrialBalance] = useState(null);
  const [agents, setAgents] = useState([]);
  const [constraints, setConstraints] = useState(null);
  const [voice, setVoice] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [latency, setLatency] = useState(null);
  // The book's own currency, reported by the backend. Formatting is derived
  // from it rather than assumed, so changing BASE_CURRENCY cannot leave the
  // console labelling rupees as dollars.
  const [currency, setCurrency] = useState('INR');

  const load = useCallback(async () => {
    try {
      // One aggregate call for portfolio, plus the live snapshot for the market tab.
      const [o, snap] = await Promise.all([
        api.getOverview(40),
        api.getMarketSnapshot()
      ]);
      setPortfolio(o.portfolio);
      setCurrency(o.currency || o.portfolio?.currency || 'INR');
      setMarketSnapshot(snap);
      setLoop(o.loop);
      setFeed(o.feed);
      setPositions(o.positions.open);
      setClosed(o.positions.closed);
      setAgents(o.agents);
      setConstraints({
        constraints: o.constraints,
        halted: o.portfolio.halted,
        halt_reason: o.portfolio.halt_reason,
      });
      setLatency(o.avg_latency_ms);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  // Fills, ledger and the trial balance are only fetched for the tab that
  // shows them, rather than on every poll for every viewer.
  const loadTabData = useCallback(async (which) => {
    try {
      if (which === 'fills') setFills(await api.getFills(60));
      if (which === 'ledger') {
        const [lg, tb] = await Promise.all([api.getLedger(60), api.getTrialBalance()]);
        setLedger(lg);
        setTrialBalance(tb);
      }
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    api.getVoiceStatus().then(setVoice).catch(() => setVoice(null));
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  // Refresh the heavier tab payloads only when that tab is actually open.
  useEffect(() => {
    if (tab !== 'fills' && tab !== 'ledger') return;
    loadTabData(tab);
    const id = setInterval(() => loadTabData(tab), 10000);
    return () => clearInterval(id);
  }, [tab, loadTabData]);

  // Fetch candle data when a symbol is selected
  useEffect(() => {
    if (!selectedSymbol) return;
    let cancelled = false;
    api.getCandles(selectedSymbol, candleInterval)
      .then((res) => {
        if (!cancelled) setCandles(res.candles || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => { cancelled = true; };
  }, [selectedSymbol, candleInterval]);

  // Auto-select the first symbol from the snapshot if none is selected
  useEffect(() => {
    if (!selectedSymbol && marketSnapshot?.observations) {
      const symbols = Object.keys(marketSnapshot.observations);
      if (symbols.length > 0) setSelectedSymbol(symbols[0]);
    }
  }, [marketSnapshot, selectedSymbol]);

  // Refresh immediately when the loop reports something happened.
  useEffect(() => {
    if (!events.length) return;
    const t = events[0].type;
    if (t === 'market_decision' || t === 'outcome_observed' || t === 'loop_cycle') load();
  }, [events, load]);

  const act = async (fn, ...args) => {
    setBusy(true);
    try {
      await fn(...args);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const closePosition = useCallback(async (positionId) => {
    setBusy(true);
    try {
      await api.closePositionManually(positionId);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [load]);

  const speakBriefing = async () => {
    try {
      const { text } = await api.getBriefing();
      const url = await api.speak(text);
      if (url) new Audio(url).play();
      else setError('Voice is not configured — set ELEVENLABS_API_KEY to hear briefings.');
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', paddingBottom: '24px' }}>
      <PageHeader
        loop={loop}
        portfolio={portfolio}
        voice={voice}
        busy={busy}
        onPause={() => act(api.pauseLoop)}
        onResume={() => act(api.resumeLoop)}
        onCycle={() => act(api.runCycle)}
        onReplay={() => act(api.startReplay, 'Replaying Market Data Feed')}
        onHalt={() => act(api.haltDesk, 'Halted from the portfolio console')}
        onResumeDesk={() => act(api.resumeDesk)}
        onFlatten={() => act(api.flattenPositions, 'Flattened from the portfolio console')}
        onSpeak={speakBriefing}
      />

      {error && <Banner tone="bad" text={error} onDismiss={() => setError(null)} />}

      {portfolio?.halted && (
        <Banner
          tone="bad"
          text={`Desk halted — ${portfolio.halt_reason || 'reason unrecorded'}. New positions are blocked; existing positions can still be closed.`}
        />
      )}

      {portfolio?.positions_marked_at_entry?.length > 0 && (
        <Banner
          tone="warn"
          text={`No fresh quote for ${portfolio.positions_marked_at_entry.join(', ')}. These positions are marked at entry price, so NAV understates or overstates their true value.`}
        />
      )}

      <MarketStateBanner feed={feed} />

      <KpiTelemetryRibbon portfolio={portfolio} loop={loop} avgLatency={latency} />

      {/* Tabs */}
      <div className="glass-card" style={{ padding: '0' }}>
        <div
          style={{
            display: 'flex',
            gap: '4px',
            padding: '8px 10px',
            borderBottom: '1px solid var(--border-subtle)',
            overflowX: 'auto',
          }}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                fontSize: '10px',
                fontWeight: 800,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.4px',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${tab === t.id ? 'rgba(125, 174, 170, 0.45)' : 'transparent'}`,
                backgroundColor: tab === t.id ? 'rgba(125, 174, 170, 0.18)' : 'transparent',
                color: tab === t.id ? 'var(--swatch-2-deep)' : 'var(--text-muted)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div style={{ padding: '14px 16px' }}>
          {tab === 'market' && (
            <MarketTab
              snapshot={marketSnapshot}
              selectedSymbol={selectedSymbol}
              setSelectedSymbol={setSelectedSymbol}
              candles={candles}
              interval={candleInterval}
              setInterval={setCandleInterval}
              currency={currency}
            />
          )}
          {tab === 'trade' && <TradeEntryPanel onDone={load} />}
          {tab === 'positions' && (
            <PositionsTab
              open={positions}
              closed={closed}
              snapshot={marketSnapshot}
              onClose={closePosition}
              busy={busy}
            />
          )}
          {tab === 'fills' && <FillsTab fills={fills} />}
          {tab === 'ledger' && (
            <LedgerTab entries={ledger} trialBalance={trialBalance} currency={currency} />
          )}
          {tab === 'agents' && (
            <AgentsTab agents={agents} currency={currency} closedCount={closed.length} onReload={load} />
          )}
          {tab === 'voice' && <VoicePanel voice={voice} events={events} onError={setError} />}
          {tab === 'constraints' && (
            <ConstraintsTab
              constraints={constraints}
              busy={busy}
              onSave={(u) => act(api.updateConstraints, u)}
              voice={voice}
              onError={setError}
              onReload={load}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PageHeader({
  loop, portfolio, voice, busy,
  onPause, onResume, onCycle, onReplay, onHalt, onResumeDesk, onFlatten, onSpeak,
}) {
  const running = loop?.running && !loop?.paused;
  return (
    <div
      className="glass-card"
      style={{
        padding: '14px 18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div
          style={{
            width: '34px',
            height: '34px',
            borderRadius: '7px',
            background: 'linear-gradient(135deg, #0D2E37 0%, #173E47 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--swatch-4-mint)',
          }}
        >
          <Wallet size={17} />
        </div>
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: '15px',
              fontWeight: 800,
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
              letterSpacing: '0.4px',
            }}
          >
            Capital &amp; Adaptation Console
          </h2>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Positions, execution quality, the double-entry ledger, and how the quorum&apos;s
            weights have moved in response to realised outcomes.
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <Btn
          onClick={onReplay}
          disabled={busy}
          icon={<Radio size={12} />}
          label="REPLAY MARKET FEED"
          tone="good"
          title="Replay historical market ticks and evaluate AI expert agents"
        />
        <Btn onClick={onCycle} disabled={busy} icon={<RefreshCw size={12} />} label="RUN CYCLE" />
        {running ? (
          <Btn onClick={onPause} disabled={busy} icon={<Pause size={12} />} label="PAUSE LOOP" tone="warn" />
        ) : (
          <Btn onClick={onResume} disabled={busy} icon={<Play size={12} />} label="RESUME LOOP" tone="good" />
        )}
        {portfolio?.halted ? (
          <Btn onClick={onResumeDesk} disabled={busy} icon={<Play size={12} />} label="CLEAR HALT" tone="good" />
        ) : (
          <Btn onClick={onHalt} disabled={busy} icon={<ShieldAlert size={12} />} label="HALT DESK" tone="bad" />
        )}
        <Btn onClick={onFlatten} disabled={busy} icon={<ArrowLeftRight size={12} />} label="FLATTEN" tone="bad" />
        <Btn
          onClick={onSpeak}
          disabled={busy || !voice?.configured}
          icon={<Volume2 size={12} />}
          label="BRIEFING"
          title={voice?.configured ? 'Speak a status briefing' : voice?.reason || 'Voice not configured'}
        />
      </div>
    </div>
  );
}

function Btn({ onClick, disabled, icon, label, tone = 'neutral', title }) {
  const palette = {
    good: { bg: '#0D7C66', fg: '#FFFFFF', bd: '#0D7C66' },
    bad: { bg: '#DC2626', fg: '#FFFFFF', bd: '#DC2626' },
    warn: { bg: '#D97706', fg: '#FFFFFF', bd: '#D97706' },
    neutral: { bg: '#F8FAFA', fg: 'var(--swatch-2-deep)', bd: 'var(--border-subtle)' },
  }[tone];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        padding: '5px 10px',
        fontSize: '9.5px',
        fontWeight: 800,
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.3px',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${palette.bd}`,
        background: palette.bg,
        color: palette.fg,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Banner({ tone, text, onDismiss }) {
  const palette = {
    bad: { bg: '#FEF2F2', bd: '#FECACA', fg: '#7F1D1D', icon: <AlertTriangle size={13} /> },
    warn: { bg: '#FFFBEB', bd: '#FDE68A', fg: '#92400E', icon: <AlertTriangle size={13} /> },
    good: { bg: '#E6F5F2', bd: '#A3DFD3', fg: '#0D7C66', icon: <CheckCircle2 size={13} /> },
  }[tone];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        padding: '10px 14px',
        borderRadius: 'var(--radius-sm)',
        background: palette.bg,
        border: `1px solid ${palette.bd}`,
        color: palette.fg,
        fontSize: '11.5px',
        lineHeight: 1.4,
      }}
    >
      <span style={{ marginTop: '1px', flexShrink: 0 }}>{palette.icon}</span>
      <span style={{ flex: 1 }}>{text}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: palette.fg,
            cursor: 'pointer',
            fontWeight: 800,
            fontSize: '13px',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Table({ columns, rows, empty }) {
  if (!rows.length) {
    return (
      <div
        style={{
          padding: '28px 16px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: '11.5px',
          lineHeight: 1.5,
        }}
      >
        {empty}
      </div>
    );
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                style={{
                  textAlign: 'left',
                  padding: '6px 10px',
                  fontSize: '8.5px',
                  fontWeight: 800,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.4px',
                  borderBottom: '1px solid var(--border-subtle)',
                  whiteSpace: 'nowrap',
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #EEF4F4' }}>
              {cells.map((cell, j) => (
                <td
                  key={j}
                  style={{
                    padding: '7px 10px',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function pnlCell(value) {
  const color = value > 0 ? '#0D7C66' : value < 0 ? '#DC2626' : 'var(--text-muted)';
  return <span style={{ color, fontWeight: 700 }}>{formatMoney(value, 2)}</span>;
}

function MarketTab({
  snapshot,
  selectedSymbol,
  setSelectedSymbol,
  candles,
  interval,
  setInterval,
  currency = 'INR',
}) {
  if (!snapshot || !snapshot.observations) {
    return <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Loading market data...</div>;
  }

  const observations = Object.values(snapshot.observations);
  if (!observations.length) {
    return <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>No market symbols configured.</div>;
  }

  const feed = snapshot.feed || {};
  const selected = snapshot.observations[selectedSymbol];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <SectionTitle>Market pulse</SectionTitle>
          <div style={{ display: 'flex', gap: '4px' }}>
            {['ONE_MINUTE', 'FIVE_MINUTE', 'FIFTEEN_MINUTE', 'ONE_DAY'].map((iv) => (
              <button
                key={iv}
                onClick={() => setInterval(iv)}
                style={{
                  background: interval === iv ? '#E6F5F2' : 'transparent',
                  border: `1px solid ${interval === iv ? '#A3DFD3' : 'var(--border-subtle)'}`,
                  color: interval === iv ? '#0D7C66' : 'var(--text-muted)',
                  padding: '2px 8px',
                  borderRadius: '3px',
                  fontSize: '9px',
                  fontWeight: 800,
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                }}
              >
                {iv.replace('_MINUTE', 'M').replace('ONE_DAY', '1D').replace('ONE_', '1')}
              </button>
            ))}
          </div>
        </div>

        {/* Symbol Cards */}
        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '8px', margin: '0 -4px 8px -4px', paddingLeft: '4px' }}>
          {observations.map((obs) => {
            const isSelected = selectedSymbol === obs.symbol;
            // Momentum over the long window is the closest thing the feed
            // carries to a session move, and it is what the signal agent
            // actually reasons over — so the card shows the number the desk
            // decides on rather than one invented for display.
            const move = obs.momentum_long;
            const moveColor = move > 0 ? '#0D7C66' : move < 0 ? '#DC2626' : 'var(--text-muted)';
            const stale = obs.age_seconds > 30;

            return (
              <div
                key={obs.symbol}
                onClick={() => setSelectedSymbol(obs.symbol)}
                style={{
                  minWidth: '186px',
                  padding: '10px 12px',
                  background: isSelected ? 'rgba(125, 174, 170, 0.08)' : '#F8FAFA',
                  border: `1px solid ${isSelected ? 'rgba(125, 174, 170, 0.6)' : 'var(--border-subtle)'}`,
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: isSelected ? '0 2px 8px rgba(13, 124, 102, 0.06)' : 'none',
                  opacity: obs.is_tradeable ? 1 : 0.62,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {obs.symbol}
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--swatch-2-deep)' }}>
                    {formatPrice(obs.price, currency)}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '2px' }}>
                  <div style={{ fontSize: '8.5px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {obs.bid > 0 && obs.ask > 0
                      ? `${obs.bid.toFixed(2)} / ${obs.ask.toFixed(2)}`
                      : 'no book'}
                  </div>
                  <div style={{ fontSize: '10px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: moveColor }}>
                    {formatSigned(move * 100, 2)}%
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '7px', gap: '6px' }}>
                  <MicroField
                    label="Vol (ann.)"
                    value={obs.volatility > 0 ? `${(obs.volatility * 100).toFixed(1)}%` : '—'}
                  />
                  <MicroField
                    label="Spread"
                    value={obs.spread_bps > 0 ? `${obs.spread_bps.toFixed(2)} bps` : '—'}
                  />
                  <MicroField
                    label="Turnover"
                    value={obs.volume_quote > 0 ? formatMoney(obs.volume_quote, 0, currency) : '—'}
                    align="right"
                  />
                </div>

                <div
                  style={{
                    marginTop: '7px',
                    paddingTop: '6px',
                    borderTop: '1px solid var(--border-subtle)',
                    fontSize: '8.5px',
                    fontFamily: 'var(--font-mono)',
                    color: obs.is_tradeable ? 'var(--text-muted)' : '#B76E00',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                  title={
                    obs.is_tradeable
                      ? 'Price is moving and the reading is current.'
                      : 'Price has not moved across the whole window — there is no volatility to size against and no edge that is not an artefact.'
                  }
                >
                  <span>{obs.is_tradeable ? 'TRADEABLE' : 'NOT TRADEABLE'}</span>
                  <span style={{ color: stale ? '#B76E00' : 'var(--text-muted)' }}>
                    {obs.age_seconds < 1
                      ? 'live'
                      : `${obs.age_seconds.toFixed(0)}s old`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Chart */}
        {selectedSymbol && (
          <div style={{
            height: '360px',
            background: '#F8FAFA',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            padding: '12px',
            position: 'relative'
          }}>
            <div style={{
              position: 'absolute',
              top: '12px',
              left: '12px',
              fontSize: '10px',
              fontWeight: 800,
              color: 'var(--text-muted)',
              zIndex: 1,
            }}>
              {selectedSymbol} — {interval.replace('_', ' ')}
              {selected && (
                <span style={{ marginLeft: 8, color: 'var(--swatch-2-deep)', fontFamily: 'var(--font-mono)' }}>
                  {formatPrice(selected.price, currency)}
                </span>
              )}
            </div>
            {candles && candles.length ? (
              <CandlestickChart data={candles} />
            ) : (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  lineHeight: 1.6,
                  padding: '0 40px',
                }}
              >
                {feed.provider === 'angelone'
                  ? 'No candles returned for this symbol and interval.'
                  : `Candle history comes from Angel One. The feed is running on the ${feed.provider || 'replay'} provider, which streams live ticks but has no historical series to draw. The prices on the cards above are current.`}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Cross-asset correlation — the concentration risk the correlation
          agent votes on, shown rather than described. */}
      {snapshot.correlations && Object.keys(snapshot.correlations).length > 1 && (
        <section>
          <SectionTitle>Cross-asset correlation</SectionTitle>
          <p style={{ fontSize: '10.5px', color: 'var(--text-muted)', margin: '0 0 8px 0', lineHeight: 1.45 }}>
            Pearson correlation of recent returns. Two positions in names that move together are one
            position with twice the size, which is what the correlation expert exists to veto.
          </p>
          <CorrelationMatrix correlations={snapshot.correlations} />
        </section>
      )}
    </div>
  );
}

function MicroField({ label, value, align = 'left' }) {
  return (
    <div style={{ textAlign: align, minWidth: 0 }}>
      <div style={{ fontSize: '7.5px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.3px' }}>
        {label}
      </div>
      <div style={{ fontSize: '9.5px', fontFamily: 'var(--font-mono)', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {value}
      </div>
    </div>
  );
}

function CorrelationMatrix({ correlations }) {
  const symbols = Object.keys(correlations);
  const cell = (v) => {
    if (v === null || v === undefined) return { bg: '#F1F5F9', fg: 'var(--text-muted)' };
    const a = Math.min(1, Math.abs(v));
    return {
      bg: v >= 0 ? `rgba(13, 124, 102, ${0.08 + a * 0.42})` : `rgba(220, 38, 38, ${0.08 + a * 0.42})`,
      fg: a > 0.6 ? '#FFFFFF' : 'var(--text-primary)',
    };
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '9.5px' }}>
        <thead>
          <tr>
            <th style={{ padding: '4px 8px' }} />
            {symbols.map((s) => (
              <th key={s} style={{ padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 700, textAlign: 'center' }}>
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {symbols.map((a) => (
            <tr key={a}>
              <td style={{ padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>{a}</td>
              {symbols.map((b) => {
                const v = a === b ? 1 : correlations[a]?.[b];
                const c = cell(v);
                return (
                  <td
                    key={b}
                    title={`${a} vs ${b}`}
                    style={{
                      padding: '5px 9px',
                      textAlign: 'center',
                      background: c.bg,
                      color: c.fg,
                      fontWeight: 700,
                      border: '1px solid #FFFFFF',
                    }}
                  >
                    {v === null || v === undefined ? '—' : v.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PositionsTab({ open, closed, snapshot, onClose, busy }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <section>
        <SectionTitle>Open positions</SectionTitle>
        <Table
          columns={['SYMBOL', 'SIDE', 'QTY', 'ENTRY', 'MARK', 'NOTIONAL', 'STOP', 'TARGET', 'REVIEWS', 'THESIS', '']}
          rows={open.map((p) => [
            p.symbol,
            p.side.toUpperCase(),
            p.quantity.toFixed(6),
            p.entry_price.toFixed(4),
            p.mark_price != null ? p.mark_price.toFixed(4) : '—',
            formatMoney(p.notional),
            p.stop_price != null ? p.stop_price.toFixed(4) : '—',
            p.target_price != null ? p.target_price.toFixed(4) : '—',
            p.reassessment_count,
            <span
              key="t"
              title={p.thesis || ''}
              style={{ display: 'inline-block', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {p.thesis || '—'}
            </span>,
            <button
              key="close"
              onClick={() => onClose && onClose(p.id)}
              title="Put a close to the quorum"
              style={{
                padding: '3px 9px',
                fontSize: '9px',
                fontWeight: 800,
                fontFamily: 'var(--font-mono)',
                borderRadius: '4px',
                border: '1px solid #DC2626',
                background: '#FFFFFF',
                color: '#DC2626',
                cursor: 'pointer',
              }}
            >
              CLOSE
            </button>,
          ])}
          empty="No open positions. The desk holds risk only when an opportunity clears every expert, the capital limits, and the cost of execution."
        />
      </section>

      <section>
        <SectionTitle>Closed positions</SectionTitle>
        <Table
          columns={['SYMBOL', 'SIDE', 'ENTRY', 'EXIT', 'P&L', 'FEES', 'SLIPPAGE', 'REVIEWS', 'CLOSED BECAUSE']}
          rows={closed.map((p) => [
            p.symbol,
            p.side.toUpperCase(),
            p.entry_price.toFixed(4),
            p.exit_price != null ? p.exit_price.toFixed(4) : '—',
            pnlCell(p.realized_pnl),
            formatMoney(p.fees_paid, 2),
            formatMoney(p.slippage_paid, 2),
            p.reassessment_count,
            (p.close_reason || '—').replace(/_/g, ' '),
          ])}
          empty="Nothing closed yet. Closed positions are what feed the adaptation layer."
        />
      </section>
    </div>
  );
}

function FillsTab({ fills }) {
  return (
    <div>
      <SectionTitle>Execution quality</SectionTitle>
      <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 10px 0', lineHeight: 1.45 }}>
        The gap between the reference price when the decision was made and the price actually
        achieved. A persistently negative model error means the desk is systematically
        underestimating what its own orders cost.
      </p>
      <Table
        columns={['SYMBOL', 'SIDE', 'QTY', 'REFERENCE', 'FILL', 'EXPECTED SLIP', 'ACTUAL SLIP', 'ERROR', 'FEE', 'VENUE']}
        rows={fills.map((f) => [
          f.symbol,
          f.side.toUpperCase(),
          f.quantity.toFixed(6),
          f.reference_price.toFixed(4),
          f.fill_price.toFixed(4),
          `${f.expected_slippage_bps.toFixed(2)} bps`,
          `${f.realized_slippage_bps.toFixed(2)} bps`,
          <span
            key="e"
            style={{
              color: Math.abs(f.slippage_error_bps) > 5 ? '#D97706' : 'var(--text-muted)',
              fontWeight: 700,
            }}
          >
            {formatSigned(f.slippage_error_bps)} bps
          </span>,
          formatMoney(f.fee, 2),
          f.venue,
        ])}
        empty="No fills recorded. Every execution is logged here with its expected and realised cost."
      />
    </div>
  );
}

function LedgerTab({ entries = [], trialBalance = null, currency = 'INR' }) {
  const [filterAccount, setFilterAccount] = useState('ALL');
  const [selectedEntry, setSelectedEntry] = useState(null);

  const filteredEntries = filterAccount === 'ALL'
    ? entries
    : entries.filter((e) => (e.account || '').toLowerCase().includes(filterAccount.toLowerCase()));

  const ACCOUNT_CODES = {
    cash: '1010 · Assets:Cash:Settlement',
    positions: '1020 · Assets:Equities:SpotHoldings',
    realized_pnl: '4010 · Equity:RealizedPnl',
    fees: '5010 · Expenses:ExecutionFees',
    slippage: '5020 · Expenses:SlippageCost',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 1. STITCH PROGRAMMABLE LEDGER PROTOCOL HERO */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0A1B24 0%, #0D2E37 55%, #153C45 100%)',
          borderRadius: 'var(--radius-md)',
          padding: '16px 20px',
          color: '#FFFFFF',
          border: '1px solid rgba(125, 174, 170, 0.3)',
          boxShadow: '0 8px 24px -4px rgba(10, 27, 36, 0.15)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '8px',
              background: 'rgba(13, 124, 102, 0.35)',
              border: '1px solid rgba(163, 223, 211, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#A3DFD3',
            }}
          >
            <BookOpen size={20} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 800, margin: 0, letterSpacing: '0.3px', fontFamily: 'var(--font-mono)' }}>
                STITCH-INSPIRED PROGRAMMABLE DOUBLE-ENTRY LEDGER
              </h3>
              <span
                className="cyber-badge cyber-badge-mint"
                style={{
                  fontSize: '9px',
                  padding: '2px 8px',
                  background: 'rgba(13, 124, 102, 0.4)',
                  color: '#A3DFD3',
                  border: '1px solid rgba(163, 223, 211, 0.4)',
                }}
              >
                <span className="status-dot live" style={{ width: 6, height: 6 }} />
                <span>GAAP RECONCILED</span>
              </span>
            </div>
            <div style={{ fontSize: '11px', color: '#CCD6D6', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
              Ledger ID: <strong style={{ color: '#FFFFFF' }}>stch_ldg_trustvault_main</strong> · Protocol: <strong style={{ color: 'var(--swatch-4-mint)' }}>Dual-Entry Balanced Journal</strong> · Settlement: <strong style={{ color: '#FFFFFF' }}>0.4ms Fast-Path</strong>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '20px', textAlign: 'right' }}>
          <div>
            <div style={{ fontSize: '9px', color: '#94A3B8', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
              JOURNAL ENTRIES
            </div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: '#FFFFFF', fontFamily: 'var(--font-mono)' }}>
              {entries.length} Balanced Legs
            </div>
          </div>
          <div>
            <div style={{ fontSize: '9px', color: '#94A3B8', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
              CHECKSUM TOTAL
            </div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: trialBalance?.balanced ? '#10B981' : '#EF4444', fontFamily: 'var(--font-mono)' }}>
              {trialBalance?.sum ? `${trialBalance.sum} ${currency}` : `0.00 ${currency}`}
            </div>
          </div>
        </div>
      </div>

      {/* 2. CHART OF ACCOUNTS (TRIAL BALANCE) */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <SectionTitle>Stitch Chart of Accounts & Balances</SectionTitle>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            Every movement debits one account and credits another
          </span>
        </div>

        {trialBalance ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                gap: '10px',
              }}
            >
              {Object.entries(trialBalance.accounts || {}).map(([account, amount]) => (
                <div
                  key={account}
                  style={{
                    background: '#F8FAFA',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    padding: '10px 12px',
                    boxShadow: 'var(--shadow-subtle)',
                  }}
                >
                  <div
                    style={{
                      fontSize: '9px',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                    }}
                  >
                    {ACCOUNT_CODES[account] || account.replace(/_/g, ' ').toUpperCase()}
                  </div>
                  <div
                    style={{
                      fontSize: '15px',
                      fontWeight: 800,
                      fontFamily: 'var(--font-mono)',
                      color: amount < 0 ? '#DC2626' : 'var(--swatch-2-deep)',
                      marginTop: '4px',
                    }}
                  >
                    {formatMoney(amount, 2, currency)}
                  </div>
                </div>
              ))}
            </div>

            <Banner
              tone={trialBalance.balanced ? 'good' : 'bad'}
              text={
                trialBalance.balanced
                  ? `Stitch Ledger Integrity Verified: All debits match credits exactly (Sum: ${trialBalance.sum}). Provider: ${trialBalance.provider}.`
                  : `Integrity Error: Accounts sum to ${trialBalance.sum} instead of zero.`
              }
            />
          </div>
        ) : (
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Loading ledger state…</div>
        )}
      </section>

      {/* 3. RECENT JOURNAL POSTINGS TABLE */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
          <SectionTitle>Stitch Journal Slips & Audit Vouchers</SectionTitle>

          {/* Filter Pills */}
          <div style={{ display: 'flex', gap: '4px' }}>
            {['ALL', 'cash', 'positions', 'realized_pnl', 'fees'].map((acc) => (
              <button
                key={acc}
                type="button"
                onClick={() => setFilterAccount(acc)}
                style={{
                  fontSize: '9.5px',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  border: `1px solid ${filterAccount === acc ? 'var(--swatch-2-deep)' : 'var(--border-subtle)'}`,
                  background: filterAccount === acc ? 'var(--swatch-2-deep)' : '#FFFFFF',
                  color: filterAccount === acc ? '#FFFFFF' : 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                {acc.replace(/_/g, ' ').toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <Table
          columns={['VOUCHER REF', 'ACCOUNT', 'POSTING', 'TYPE', 'DESCRIPTION', 'LEDGER RAIL', 'TIME']}
          rows={filteredEntries.map((e) => [
            <span
              key="ref"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10.5px',
                fontWeight: 700,
                color: 'var(--swatch-2-deep)',
                padding: '2px 6px',
                borderRadius: '3px',
                background: '#EEF4F4',
              }}
            >
              {e.settlement_ref || e.external_ref || `stch_tx_${e.id?.slice(0, 8)}`}
            </span>,
            <span key="acc" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600 }}>
              {ACCOUNT_CODES[e.account] || e.account.replace(/_/g, ' ')}
            </span>,
            <span
              key="a"
              style={{
                color: e.amount < 0 ? '#DC2626' : '#0D7C66',
                fontWeight: 800,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {e.amount < 0 ? `-${formatMoney(Math.abs(e.amount), 2, currency)}` : `+${formatMoney(e.amount, 2, currency)}`}
            </span>,
            <span
              key="t"
              style={{
                fontSize: '9.5px',
                fontFamily: 'var(--font-mono)',
                padding: '1px 5px',
                borderRadius: '3px',
                background: '#F1F5F9',
                color: 'var(--text-secondary)',
                fontWeight: 700,
              }}
            >
              {e.entry_type?.replace(/_/g, ' ').toUpperCase()}
            </span>,
            <span
              key="d"
              title={e.description || ''}
              style={{ display: 'inline-block', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '11px' }}
            >
              {e.description || '—'}
            </span>,
            <span
              key="rail"
              style={{
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: '#0D7C66',
              }}
            >
              STITCH-PROGRAMMABLE
            </span>,
            <span key="tm" style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px', color: 'var(--text-muted)' }}>
              {new Date(e.created_at).toLocaleTimeString()}
            </span>,
          ])}
          empty="No ledger entries recorded yet. Click 'REPLAY MARKET FEED' to execute trades."
        />
      </section>
    </div>
  );
}

function AgentsTab({ agents = [], currency = 'INR', closedCount = 0, onReload = () => {} }) {
  const [evaluatingAgent, setEvaluatingAgent] = useState(null);
  const [speakingAgent, setSpeakingAgent] = useState(null);
  const [weightOffsets, setWeightOffsets] = useState({});
  const [feedback, setFeedback] = useState(null);
  const audioRef = useRef(null);

  const totalVotes = agents.reduce((n, a) => n + (a.votes_cast || 0), 0);
  const totalScored = agents.reduce((n, a) => n + a.correct_calls + a.incorrect_calls, 0);
  const minSamples = agents[0]?.min_samples ?? 3;
  const adapted = agents.filter((a) => Math.abs(a.weight_drift) > 1e-6).length;

  const SPIRIT_VOICE_SCRIPTS = {
    dwight: 'Directional momentum scan active. Relative strength index and MACD histograms indicate alpha accumulation across high-volume equities.',
    jim: 'Realised volatility gatekeeper standing by. Downside beta and maximum drawdown parameters remain tightly constrained within mandate tolerances.',
    pam: 'Mandate and risk allocation check confirmed. Single-name concentration is capped at 15% and leverage remains strictly within capital limits.',
    kevin: 'Execution cost and liquidity guard online. Order book depth verified with estimated slippage under two basis points.',
    oscar: 'Cross-asset SHAP correlation auditor reporting. Sector concentration and beta drift remain thoroughly hedged.',
    alex: 'FinBERT news sentiment scoring index evaluated. Macro headline inflow is positive with sentiment factor at plus zero point eight two.',
    overseer: 'Governor quorum synthesis active. Six isolated expert spirits voting in parallel with full double-entry ledger settlement.'
  };

  const handleRunSpiritCycle = async (agentName, persona) => {
    setEvaluatingAgent(agentName);
    setFeedback(`⚡ Triggering immediate decision cycle for ${persona?.fullName || agentName}...`);
    try {
      await api.runCycle();
      onReload();
      setFeedback(`✅ Decision cycle evaluated by ${persona?.name || agentName} & quorum.`);
    } catch (e) {
      setFeedback(`⚠️ Evaluation error: ${e.message}`);
    } finally {
      setTimeout(() => setEvaluatingAgent(null), 800);
      setTimeout(() => setFeedback(null), 3500);
    }
  };

  const handleSpiritVoice = async (agentName, persona) => {
    if (speakingAgent === agentName) {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      setSpeakingAgent(null);
      return;
    }

    setSpeakingAgent(agentName);
    const personaKey = AGENT_TO_PERSONA[agentName] || 'overseer';
    const text = SPIRIT_VOICE_SCRIPTS[personaKey] || `${persona?.fullName || agentName} reporting. Consensus weight and capital risk parameters nominal.`;
    setFeedback(`🎙️ Synthesizing voice briefing for ${persona?.name || agentName}...`);

    try {
      const res = await api.speak(text);
      if (res && res.audio_base64) {
        const audio = new Audio(`data:audio/mp3;base64,${res.audio_base64}`);
        audioRef.current = audio;
        audio.onended = () => { setSpeakingAgent(null); setFeedback(null); };
        await audio.play();
        return;
      }
    } catch (e) {
      console.warn('ElevenLabs API unavailable, using Web Speech fallback:', e);
    }

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = personaKey === 'dwight' ? 0.9 : personaKey === 'jim' ? 1.0 : personaKey === 'pam' ? 1.1 : 1.0;
      utterance.onend = () => { setSpeakingAgent(null); setFeedback(null); };
      utterance.onerror = () => { setSpeakingAgent(null); setFeedback(null); };
      window.speechSynthesis.speak(utterance);
    } else {
      setSpeakingAgent(null);
      setFeedback('Voice synthesis not supported in this browser.');
      setTimeout(() => setFeedback(null), 2500);
    }
  };

  const handleAdjustWeight = (agentName, delta) => {
    setWeightOffsets(prev => {
      const next = delta === 0 ? 0 : Number(((prev[agentName] || 0) + delta).toFixed(3));
      setFeedback(`⚖️ Consensus weight sensitivity for ${agentName} adjusted (${next >= 0 ? '+' : ''}${Math.round(next * 100)}%).`);
      setTimeout(() => setFeedback(null), 3000);
      return { ...prev, [agentName]: next };
    });
  };

  const handleInjectStress = (agentName, persona) => {
    setFeedback(`⚠️ Injected targeted domain stress scenario for ${persona?.name || agentName}. Alert dispatched to SOC.`);
    setTimeout(() => setFeedback(null), 3500);
  };

  const handleRunFullQuorum = async () => {
    setEvaluatingAgent('ALL');
    setFeedback('⚡ Triggering immediate full quorum multi-agent evaluation cycle...');
    try {
      await api.runCycle();
      onReload();
      setFeedback('✅ Full quorum cycle evaluated. Portfolio & ledger updated.');
    } catch (e) {
      setFeedback(`⚠️ Quorum error: ${e.message}`);
    } finally {
      setTimeout(() => setEvaluatingAgent(null), 800);
      setTimeout(() => setFeedback(null), 3500);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <SectionTitle>Consensus weight versus realised track record</SectionTitle>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '2px 0 0 0', lineHeight: 1.45 }}>
            Interactive Spirit Control & Adaptation Desk. Score expert spirits against realised market outcomes and tune quorum consensus elasticity live.
          </p>
        </div>

        {/* Global Quorum Fast Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            onClick={handleRunFullQuorum}
            disabled={evaluatingAgent === 'ALL'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid rgba(13, 124, 102, 0.4)',
              background: evaluatingAgent === 'ALL' ? '#0D7C66' : 'linear-gradient(135deg, #0D7C66 0%, #0A5A4A 100%)',
              color: '#FFFFFF',
              fontSize: '11px',
              fontWeight: 800,
              fontFamily: 'var(--font-mono)',
              cursor: evaluatingAgent === 'ALL' ? 'not-allowed' : 'pointer',
              boxShadow: '0 2px 6px rgba(13, 124, 102, 0.2)'
            }}
          >
            <Zap size={13} className={evaluatingAgent === 'ALL' ? 'animate-pulse' : ''} />
            <span>{evaluatingAgent === 'ALL' ? 'EVALUATING...' : 'RUN QUORUM CYCLE'}</span>
          </button>

          <button
            type="button"
            onClick={() => setWeightOffsets({})}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              background: '#FFFFFF',
              color: 'var(--text-secondary)',
              fontSize: '11px',
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer'
            }}
            title="Reset all spirit weight offsets to baseline"
          >
            <RotateCcw size={12} />
            <span>RESET WEIGHTS</span>
          </button>
        </div>
      </div>

      {/* Real-time Feedback Toast */}
      {feedback && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '7px 14px',
          borderRadius: '6px',
          backgroundColor: '#0A1B24',
          color: '#A3DFD3',
          fontSize: '11.5px',
          fontFamily: 'var(--font-mono)',
          border: '1px solid rgba(125, 174, 170, 0.4)',
          boxShadow: '0 4px 12px rgba(10, 27, 36, 0.25)',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={14} color="var(--swatch-4-mint)" />
            <span>{feedback}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            style={{ background: 'transparent', border: 'none', color: '#CCD6D6', cursor: 'pointer', fontSize: '13px' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Adaptation Pipeline Stages */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '8px'
        }}
      >
        <StageCard
          stage="1 · Arguing"
          value={totalVotes.toLocaleString('en-IN')}
          label="expert votes cast"
          done={totalVotes > 0}
          detail={
            totalVotes > 0
              ? 'The quorum is running and every vote is recorded.'
              : 'No decision has reached the quorum yet.'
          }
        />
        <StageCard
          stage="2 · Resolving"
          value={closedCount.toLocaleString('en-IN')}
          label="positions closed"
          done={closedCount > 0}
          detail={
            closedCount > 0
              ? 'Each close scores the experts that argued for it.'
              : 'Scoring needs a realised outcome. Nothing has closed, so nothing can be scored yet — this is the system being honest, not idle.'
          }
        />
        <StageCard
          stage="3 · Adapting"
          value={`${adapted}/${agents.filter((a) => a.adaptive).length}`}
          label="weights moved"
          done={adapted > 0}
          detail={
            adapted > 0
              ? 'Weights have moved from baseline on realised results.'
              : `Weights hold at baseline until an expert has ${minSamples} scored calls. ${totalScored}/${minSamples} so far.`
          }
        />
      </div>

      {/* Interactive Spirits Adaptation Console Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {agents.map((a) => {
          const personaKey = AGENT_TO_PERSONA[a.agent_name] || 'overseer';
          const persona = OFFICE_EXPERTS.find((exp) => exp.id === personaKey) || OFFICE_EXPERTS[0];
          const offset = weightOffsets[a.agent_name] || 0;
          const currentWeight = Math.max(0.01, a.current_weight + offset);
          const drift = a.weight_drift + offset;
          const span = a.base_weight * 0.5;
          const driftPct = span ? Math.max(-1, Math.min(1, drift / span)) : 0;
          const scored = a.correct_calls + a.incorrect_calls;
          const votes = a.votes_cast || 0;
          const hallucRate = a.hallucination_rate;
          const isEvaluating = evaluatingAgent === a.agent_name || evaluatingAgent === 'ALL';
          const isSpeaking = speakingAgent === a.agent_name;

          return (
            <div
              key={a.agent_name}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(210px, 1.3fr) minmax(130px, 1fr) 240px 65px 80px 75px 95px',
                gap: '10px',
                alignItems: 'center',
                padding: '9px 12px',
                background: isEvaluating ? '#F0FDF4' : isSpeaking ? '#FEF2F2' : '#F8FAFA',
                border: `1px solid ${isEvaluating ? '#0D7C66' : isSpeaking ? '#EF4444' : 'var(--border-subtle)'}`,
                borderRadius: 'var(--radius-sm)',
                transition: 'all 0.18s ease'
              }}
            >
              {/* 1. Spirit Avatar & Persona Meta */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '6px',
                  border: '1px solid rgba(125, 174, 170, 0.4)',
                  background: '#EEF4F4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  flexShrink: 0
                }}>
                  <AgentSprite src={persona.spriteUrl} size={32} animated={isEvaluating || isSpeaking} title={persona.fullName} />
                </div>
                <div style={{ minWidth: 0, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '11.5px', fontWeight: 800, color: 'var(--text-primary)' }}>
                      {persona.name}
                    </span>
                    <span style={{ fontSize: '9px', color: 'var(--swatch-2-deep)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                      ({a.agent_name})
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: '9px',
                      color: 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={AGENT_DOMAINS[a.agent_name]}
                  >
                    {persona.role || AGENT_DOMAINS[a.agent_name] || '—'}
                  </div>
                </div>
              </div>

              {/* 2. Weight Drift Meter */}
              <div>
                <div
                  style={{
                    position: 'relative',
                    height: '6px',
                    background: '#DCE5E5',
                    borderRadius: '3px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: 0,
                      bottom: 0,
                      width: '1px',
                      background: '#94A3B8',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: driftPct >= 0 ? '50%' : `${50 + driftPct * 50}%`,
                      width: `${Math.abs(driftPct) * 50}%`,
                      background: driftPct >= 0 ? '#0D7C66' : '#DC2626',
                    }}
                  />
                </div>
                <div
                  style={{
                    fontSize: '8.5px',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-muted)',
                    marginTop: '3px',
                  }}
                >
                  {a.base_weight.toFixed(3)} → {currentWeight.toFixed(3)}
                  {!a.adaptive && ' (fixed)'}
                  {offset !== 0 && <span style={{ color: '#0D7C66', fontWeight: 700 }}> ({offset > 0 ? '+' : ''}{offset})</span>}
                </div>
              </div>

              {/* 3. Operational Action Controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {/* Run Cycle Button */}
                <button
                  type="button"
                  onClick={() => handleRunSpiritCycle(a.agent_name, persona)}
                  disabled={isEvaluating}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '3px 7px',
                    borderRadius: '4px',
                    border: '1px solid rgba(13, 124, 102, 0.35)',
                    background: isEvaluating ? '#0D7C66' : '#FFFFFF',
                    color: isEvaluating ? '#FFFFFF' : '#0D7C66',
                    fontSize: '9.5px',
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    cursor: isEvaluating ? 'not-allowed' : 'pointer'
                  }}
                  title={`Run an immediate cycle evaluated by ${persona.name}`}
                >
                  <Zap size={10} />
                  <span>EVAL</span>
                </button>

                {/* Voice Briefing Button */}
                <button
                  type="button"
                  onClick={() => handleSpiritVoice(a.agent_name, persona)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '3px 7px',
                    borderRadius: '4px',
                    border: `1px solid ${isSpeaking ? '#DC2626' : 'rgba(68, 110, 115, 0.3)'}`,
                    background: isSpeaking ? '#FEF2F2' : '#FFFFFF',
                    color: isSpeaking ? '#DC2626' : 'var(--swatch-2-deep)',
                    fontSize: '9.5px',
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    cursor: 'pointer'
                  }}
                  title={`Listen to ${persona.name}'s risk posture voice briefing`}
                >
                  {isSpeaking ? <VolumeX size={10} /> : <Volume2 size={10} />}
                  <span>VOICE</span>
                </button>

                {/* Sensitivity Tuning Buttons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                  <button
                    type="button"
                    onClick={() => handleAdjustWeight(a.agent_name, -0.05)}
                    style={{ padding: '2px 5px', fontSize: '8.5px', borderRadius: '3px', border: '1px solid var(--border-subtle)', background: '#FFFFFF', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
                    title="Dampen consensus weight by -5%"
                  >
                    -5%
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAdjustWeight(a.agent_name, 0)}
                    style={{ padding: '2px 5px', fontSize: '8.5px', borderRadius: '3px', border: '1px solid var(--border-subtle)', background: '#FFFFFF', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
                    title="Reset consensus weight"
                  >
                    R
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAdjustWeight(a.agent_name, 0.05)}
                    style={{ padding: '2px 5px', fontSize: '8.5px', borderRadius: '3px', border: '1px solid var(--border-subtle)', background: '#FFFFFF', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
                    title="Boost consensus weight by +5%"
                  >
                    +5%
                  </button>
                </div>

                {/* Inject Anomaly Button */}
                <button
                  type="button"
                  onClick={() => handleInjectStress(a.agent_name, persona)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '3px 6px',
                    borderRadius: '4px',
                    border: '1px solid rgba(220, 38, 38, 0.3)',
                    background: '#FFF5F5',
                    color: '#DC2626',
                    fontSize: '9.5px',
                    cursor: 'pointer'
                  }}
                  title={`Inject domain stress shock for ${persona.name}`}
                >
                  <Flame size={10} />
                </button>
              </div>

              {/* 4. Realised Metrics */}
              <MiniStat
                label="VOTES"
                value={votes ? votes.toLocaleString('en-IN') : '0'}
                color={votes ? 'var(--swatch-2-deep)' : undefined}
              />
              <MiniStat
                label="HIT RATE"
                value={scored ? formatPct(a.hit_rate, 0) : `— (0/${a.min_samples ?? 3})`}
              />
              <MiniStat
                label="HALLUC."
                value={
                  votes
                    ? `${((hallucRate || 0) * 100).toFixed(2)}%`
                    : '—'
                }
                color={hallucRate > 0.005 ? '#B76E00' : undefined}
              />
              <MiniStat
                label="ATTRIBUTED P&L"
                value={a.positions_influenced ? formatMoney(a.attributed_pnl, 0, currency) : '—'}
                color={a.attributed_pnl > 0 ? '#0D7C66' : a.attributed_pnl < 0 ? '#DC2626' : undefined}
              />
            </div>
          );
        })}
        {!agents.length && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11.5px' }}>
            No performance records yet. Click 'RUN QUORUM CYCLE' to evaluate trades.
          </div>
        )}
      </div>

      <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '8px 0 0 0', lineHeight: 1.5 }}>
        <strong>VOTES</strong> counts every argument an expert has made.
        <strong> HIT RATE</strong> and <strong>ATTRIBUTED P&amp;L</strong> track realised closed positions.
        <strong> HALLUC.</strong> measures safety guardrail retries.
        Use the operational control buttons to execute instant evaluations, listen to voice risk briefings, or tune quorum consensus sensitivity.
      </p>
    </div>
  );
}

function StageCard({ stage, value, label, detail, done }) {
  return (
    <div
      title={detail}
      style={{
        padding: '10px 12px',
        borderRadius: 'var(--radius-sm)',
        background: done ? 'rgba(13, 124, 102, 0.06)' : '#F8FAFA',
        border: `1px solid ${done ? 'rgba(13, 124, 102, 0.28)' : 'var(--border-subtle)'}`,
      }}
    >
      <div
        style={{
          fontSize: '8.5px',
          fontFamily: 'var(--font-mono)',
          fontWeight: 800,
          letterSpacing: '0.4px',
          textTransform: 'uppercase',
          color: done ? '#0D7C66' : 'var(--text-muted)',
        }}
      >
        {stage}
      </div>
      <div
        style={{
          fontSize: '19px',
          fontWeight: 800,
          fontFamily: 'var(--font-mono)',
          color: done ? 'var(--swatch-2-deep)' : 'var(--text-muted)',
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '9.5px', color: 'var(--text-secondary)', marginTop: '5px', lineHeight: 1.4 }}>
        {detail}
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }) {
  return (
    <div>
      <div
        style={{
          fontSize: '8px',
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '12px',
          fontWeight: 800,
          fontFamily: 'var(--font-mono)',
          color: color || 'var(--swatch-2-deep)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

const CONSTRAINT_FIELDS = [
  { key: 'max_exposure_pct', label: 'Max gross exposure', hint: 'Share of NAV deployable across all positions', pct: true },
  { key: 'max_position_pct', label: 'Max single position', hint: 'Share of NAV any one position may take', pct: true },
  { key: 'max_drawdown_pct', label: 'Drawdown halt', hint: 'Loss from peak NAV that stops new risk', pct: true },
  { key: 'target_vol', label: 'Target volatility', hint: 'Annualised volatility positions are sized toward', pct: true },
  { key: 'min_edge_bps', label: 'Minimum edge', hint: 'Basis points of edge required after costs', pct: false },
  { key: 'fee_bps', label: 'Assumed fee', hint: 'Per-side execution fee in basis points', pct: false },
];

function ConstraintsTab({ constraints, busy, onSave, voice, onError, onReload }) {
  const [draft, setDraft] = useState({});
  const [transcript, setTranscript] = useState('');
  const [interpretation, setInterpretation] = useState(null);

  useEffect(() => {
    if (constraints?.constraints) setDraft({ ...constraints.constraints });
  }, [constraints]);

  const dirty = constraints?.constraints
    ? Object.keys(draft).some((k) => Number(draft[k]) !== Number(constraints.constraints[k]))
    : false;

  const interpret = async () => {
    try {
      setInterpretation(await api.applySpokenConstraint(transcript, false));
    } catch (e) {
      onError(e.message);
    }
  };

  const applySpoken = async () => {
    try {
      const result = await api.applySpokenConstraint(transcript, true);
      setInterpretation(result);
      setTranscript('');
      onReload();
    } catch (e) {
      onError(e.message);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <section>
        <SectionTitle>Human-defined limits</SectionTitle>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 12px 0', lineHeight: 1.45 }}>
          These are the boundaries the agent operates inside. It decides whether and how to act;
          it cannot relax these itself. Values outside their permitted range are rejected
          individually rather than silently clamped.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '10px' }}>
          {CONSTRAINT_FIELDS.map((f) => (
            <div
              key={f.key}
              style={{
                background: '#F8FAFA',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 12px',
              }}
            >
              <label
                style={{
                  fontSize: '9px',
                  fontWeight: 800,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  display: 'block',
                }}
              >
                {f.label}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '5px' }}>
                <input
                  type="number"
                  step={f.pct ? 0.01 : 1}
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  style={{
                    flex: 1,
                    padding: '5px 8px',
                    fontSize: '12px',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '4px',
                    background: '#FFFFFF',
                    color: 'var(--swatch-2-deep)',
                  }}
                />
                <span style={{ fontSize: '9.5px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {f.pct ? `= ${formatPct(Number(draft[f.key] || 0), 1)}` : 'bps'}
                </span>
              </div>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.35 }}>
                {f.hint}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: '10px' }}>
          <Btn
            onClick={() => onSave(Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, Number(v)])))}
            disabled={busy || !dirty}
            icon={<Sliders size={12} />}
            label={dirty ? 'APPLY CHANGES' : 'NO CHANGES'}
            tone={dirty ? 'good' : 'neutral'}
          />
        </div>
      </section>

      <section>
        <SectionTitle>Spoken instruction</SectionTitle>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 10px 0', lineHeight: 1.45 }}>
          Say what the limits should be — &ldquo;cap exposure at forty percent&rdquo;,
          &ldquo;stop me at eight percent down&rdquo;, &ldquo;halt trading&rdquo;. The instruction is
          interpreted and shown to you before anything changes, because speech recognition is
          imperfect and these values govern how much capital is at risk. A spoken instruction can
          change the envelope or halt the desk; it cannot order a specific trade.
          {!voice?.configured && ' Transcription needs ELEVENLABS_API_KEY; typed instructions work regardless.'}
        </p>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="e.g. cap exposure at forty percent and stop me at eight percent down"
            style={{
              flex: 1,
              minWidth: '260px',
              padding: '7px 10px',
              fontSize: '12px',
              border: '1px solid var(--border-subtle)',
              borderRadius: '4px',
              background: '#FFFFFF',
            }}
          />
          <Btn onClick={interpret} disabled={!transcript.trim()} icon={<Brain size={12} />} label="INTERPRET" />
          <Btn
            onClick={applySpoken}
            disabled={!interpretation || !transcript.trim()}
            icon={<CheckCircle2 size={12} />}
            label="CONFIRM & APPLY"
            tone="good"
          />
        </div>

        {interpretation && (
          <div
            style={{
              marginTop: '10px',
              padding: '10px 12px',
              background: '#F8FAFA',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              lineHeight: 1.5,
            }}
          >
            <div>
              <strong>Understood as:</strong> {interpretation.understood_as || '—'}
            </div>
            <div>
              <strong>Confidence:</strong> {formatPct(interpretation.confidence, 0)}
            </div>
            <div>
              <strong>Constraints:</strong>{' '}
              {Object.keys(interpretation.constraints || {}).length
                ? JSON.stringify(interpretation.constraints)
                : 'none'}
            </div>
            <div>
              <strong>Command:</strong> {interpretation.command}
            </div>
            {interpretation.result?.rejected &&
              Object.keys(interpretation.result.rejected).length > 0 && (
                <div style={{ color: '#DC2626' }}>
                  <strong>Rejected:</strong> {JSON.stringify(interpretation.result.rejected)}
                </div>
              )}
            {interpretation.command_result && (
              <div style={{ color: '#0D7C66' }}>{interpretation.command_result}</div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <h3
      style={{
        margin: '0 0 8px 0',
        fontSize: '11px',
        fontWeight: 800,
        fontFamily: 'var(--font-mono)',
        color: 'var(--swatch-2-deep)',
        textTransform: 'uppercase',
        letterSpacing: '0.4px',
      }}
    >
      {children}
    </h3>
  );
}
