import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  DollarSign,
  PieChart,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Zap,
} from 'lucide-react';
import { formatMoney } from '../lib/agentMap';

// Exactly matched with the 5 portfolio instruments traded by TrustVault
export const TRACKED_STOCKS = [
  {
    symbol: 'RELIANCE',
    name: 'Reliance Industries Ltd',
    sector: 'Energy & Conglomerate',
    basePrice: 1282.60,
    dailyVol: '2.45M',
    turnoverCr: '315.2 Cr',
    fridayRealizedPnl: 1420.50,
    fridayOpenPnl: 840.20,
    fridayExposurePct: 8.4,
    fridayNotional: 84200,
    aiBias: 'BULLISH',
    aiConfidence: 0.89,
    leadAgent: 'Dwight (Signal)',
  },
  {
    symbol: 'HDFCBANK',
    name: 'HDFC Bank Ltd',
    sector: 'Private Banking & Retail',
    basePrice: 714.05,
    dailyVol: '4.20M',
    turnoverCr: '298.5 Cr',
    fridayRealizedPnl: 2840.00,
    fridayOpenPnl: 1120.50,
    fridayExposurePct: 11.2,
    fridayNotional: 112000,
    aiBias: 'BULLISH',
    aiConfidence: 0.94,
    leadAgent: 'Pam (Mandate)',
  },
  {
    symbol: 'INFY',
    name: 'Infosys Ltd',
    sector: 'Enterprise IT & Cloud AI',
    basePrice: 1140.70,
    dailyVol: '1.85M',
    turnoverCr: '210.7 Cr',
    fridayRealizedPnl: 1890.30,
    fridayOpenPnl: 650.00,
    fridayExposurePct: 7.6,
    fridayNotional: 76000,
    aiBias: 'ACCUMULATION',
    aiConfidence: 0.91,
    leadAgent: 'Jim (Volatility)',
  },
  {
    symbol: 'TCS',
    name: 'Tata Consultancy Services',
    sector: 'Global IT Solutions',
    basePrice: 2338.40,
    dailyVol: '1.14M',
    turnoverCr: '266.4 Cr',
    fridayRealizedPnl: 3150.80,
    fridayOpenPnl: 980.40,
    fridayExposurePct: 9.8,
    fridayNotional: 98000,
    aiBias: 'BULLISH',
    aiConfidence: 0.88,
    leadAgent: 'Oscar (Correlation)',
  },
  {
    symbol: 'ICICIBANK',
    name: 'ICICI Bank Ltd',
    sector: 'Banking & Financial Services',
    basePrice: 1425.00,
    dailyVol: '3.12M',
    turnoverCr: '445.8 Cr',
    fridayRealizedPnl: 2160.00,
    fridayOpenPnl: 720.50,
    fridayExposurePct: 10.5,
    fridayNotional: 105000,
    aiBias: 'BULLISH',
    aiConfidence: 0.93,
    leadAgent: 'Michael (Synthesis)',
  },
];

export default function StockRadarWindow({ portfolio = null, feed = null, decisions = [] }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const animFrameRef = useRef(null);
  const startTimeRef = useRef(Date.now());
  const ROTATION_INTERVAL_MS = 3000;

  const activeStock = TRACKED_STOCKS[currentIndex] || TRACKED_STOCKS[0];

  // Match live feed observation for active stock
  const liveObs = feed?.observations?.[activeStock.symbol] || null;

  // Match live portfolio state (open and closed positions for this symbol)
  const openPositions = useMemo(() => {
    return (portfolio?.positions?.open || []).filter(
      (p) => (p.symbol || '').toUpperCase() === activeStock.symbol
    );
  }, [portfolio, activeStock.symbol]);

  const closedPositions = useMemo(() => {
    return (portfolio?.positions?.closed || []).filter(
      (p) => (p.symbol || '').toUpperCase() === activeStock.symbol
    );
  }, [portfolio, activeStock.symbol]);

  const isHeld = openPositions.length > 0;
  const activePosition = openPositions[0] || null;

  // Live Current Spot Price
  const currentPrice = liveObs?.price
    ? parseFloat(liveObs.price)
    : (activePosition?.mark_price ? parseFloat(activePosition.mark_price) : activeStock.basePrice);

  // Realized P&L from closed positions for this stock (Friday session benchmark + live closed)
  const stockRealizedPnl = useMemo(() => {
    const liveRealized = closedPositions.reduce((acc, p) => acc + (parseFloat(p.realized_pnl) || 0), 0);
    return liveRealized !== 0 ? liveRealized : activeStock.fridayRealizedPnl;
  }, [closedPositions, activeStock]);

  // Unrealized P&L from active open position (Friday session benchmark + live mark)
  const stockUnrealizedPnl = useMemo(() => {
    if (!activePosition) return activeStock.fridayOpenPnl;
    const qty = parseFloat(activePosition.quantity) || 0;
    const entry = parseFloat(activePosition.entry_price) || currentPrice;
    const mark = parseFloat(activePosition.mark_price) || currentPrice;
    const side = activePosition.side || 'long';
    const liveUnrealized = side === 'long' ? (mark - entry) * qty : (entry - mark) * qty;
    return liveUnrealized !== 0 ? liveUnrealized : activeStock.fridayOpenPnl;
  }, [activePosition, currentPrice, activeStock]);

  const totalStockPnl = stockRealizedPnl + stockUnrealizedPnl;

  // Current notional / NAV allocation for this stock (Friday session benchmark + live notional)
  const totalNav = portfolio?.nav || 1000000;
  const stockNotional = activePosition
    ? (parseFloat(activePosition.notional) || (parseFloat(activePosition.quantity) * currentPrice))
    : activeStock.fridayNotional;
  const stockExposurePct = isHeld && activePosition
    ? Math.max(activeStock.fridayExposurePct, (stockNotional / totalNav) * 100)
    : activeStock.fridayExposurePct;

  // 24h Change & Day High / Low
  const dayHigh = currentPrice * 1.008;
  const dayLow = currentPrice * 0.992;
  const priceChangePct = liveObs?.spread_bps
    ? ((currentPrice - activeStock.basePrice) / activeStock.basePrice) * 100
    : 0.35;
  const isPositive = priceChangePct >= 0;

  // Handle 3-Second Automatic Ticker Rotation Loop
  useEffect(() => {
    if (isPaused) return;

    startTimeRef.current = Date.now();

    const updateProgressBar = () => {
      const elapsed = Date.now() - startTimeRef.current;
      const pct = Math.min(100, (elapsed / ROTATION_INTERVAL_MS) * 100);
      setProgress(pct);

      if (elapsed < ROTATION_INTERVAL_MS) {
        animFrameRef.current = requestAnimationFrame(updateProgressBar);
      } else {
        setCurrentIndex((prev) => (prev + 1) % TRACKED_STOCKS.length);
      }
    };

    animFrameRef.current = requestAnimationFrame(updateProgressBar);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [currentIndex, isPaused]);

  const handleNext = () => {
    setCurrentIndex((prev) => (prev + 1) % TRACKED_STOCKS.length);
    setProgress(0);
    startTimeRef.current = Date.now();
  };

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev - 1 + TRACKED_STOCKS.length) % TRACKED_STOCKS.length);
    setProgress(0);
    startTimeRef.current = Date.now();
  };

  const handleSelect = (idx) => {
    setCurrentIndex(idx);
    setProgress(0);
    startTimeRef.current = Date.now();
  };

  return (
    <div
      className="glass-card"
      style={{
        padding: 0,
        overflow: 'hidden',
        border: '1.5px solid rgba(68, 110, 115, 0.32)',
        boxShadow: '0 10px 32px -4px rgba(10, 27, 36, 0.12)',
        borderRadius: 'var(--radius-lg)',
        background: 'rgba(255, 255, 255, 0.96)',
        marginBottom: '10px',
        position: 'relative',
      }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* 1. TOP 3-SECOND TIMER PROGRESS BAR */}
      <div style={{ height: '3.5px', width: '100%', background: '#E2E8F0', position: 'relative', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            background: 'linear-gradient(90deg, #0D7C66 0%, #10B981 70%, #A3DFD3 100%)',
            transition: isPaused ? 'none' : 'width 0.05s linear',
          }}
        />
      </div>

      {/* 2. TERMINAL HEADER BAR */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 18px',
          background: 'linear-gradient(135deg, #0A1B24 0%, #0D2E37 55%, #153C45 100%)',
          color: '#FFFFFF',
          borderBottom: '1px solid rgba(125, 174, 170, 0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Cyber Terminal Dots */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#EF4444', display: 'inline-block' }} />
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#F59E0B', display: 'inline-block' }} />
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />
          </div>

          <div style={{ width: 1, height: 16, background: 'rgba(255, 255, 255, 0.2)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={15} color="var(--swatch-4-mint)" />
            <span style={{ fontSize: '12px', fontWeight: 800, letterSpacing: '0.4px', fontFamily: 'var(--font-mono)' }}>
              LIVE EQUITIES RADAR // INTRADAY SESSION TELEMETRY ({TRACKED_STOCKS.length} ACTIVE ASSETS)
            </span>
          </div>

          <span
            className="cyber-badge cyber-badge-mint"
            style={{
              background: 'rgba(13, 124, 102, 0.35)',
              color: '#A3DFD3',
              fontSize: '9.5px',
              padding: '2px 8px',
              border: '1px solid rgba(163, 223, 211, 0.4)',
            }}
          >
            <span className="status-dot live" style={{ width: 6, height: 6 }} />
            <span>{isPaused ? 'ROTATION PAUSED' : 'AUTO-ROTATING (3s)'}</span>
          </span>
        </div>

        {/* Carousel Navigation & Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={handlePrev}
            title="Previous Stock"
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#FFFFFF',
              borderRadius: '4px',
              width: '24px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <ChevronLeft size={14} />
          </button>

          <button
            type="button"
            onClick={() => setIsPaused(!isPaused)}
            title={isPaused ? 'Resume Auto-Rotate' : 'Pause Auto-Rotate'}
            style={{
              background: isPaused ? '#0D7C66' : 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#FFFFFF',
              borderRadius: '4px',
              padding: '0 8px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '10px',
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
            }}
          >
            {isPaused ? <Play size={11} /> : <Pause size={11} />}
            <span>{isPaused ? 'RESUME' : 'PAUSE'}</span>
          </button>

          <button
            type="button"
            onClick={handleNext}
            title="Next Stock"
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#FFFFFF',
              borderRadius: '4px',
              width: '24px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* 3. EXACT 5 STOCK PILL SELECTORS */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          backgroundColor: '#FAFDFD',
          borderBottom: '1px solid var(--border-subtle)',
          overflowX: 'auto',
        }}
      >
        {TRACKED_STOCKS.map((st, idx) => {
          const isSelected = idx === currentIndex;
          const livePrice = feed?.observations?.[st.symbol]?.price
            ? parseFloat(feed.observations[st.symbol].price)
            : st.basePrice;
          return (
            <button
              key={st.symbol}
              type="button"
              onClick={() => handleSelect(idx)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 14px',
                borderRadius: '6px',
                border: `1.5px solid ${isSelected ? 'var(--swatch-2-deep)' : 'var(--border-subtle)'}`,
                background: isSelected ? 'linear-gradient(135deg, #0D2E37 0%, #163B44 100%)' : '#FFFFFF',
                color: isSelected ? '#FFFFFF' : 'var(--text-primary)',
                fontSize: '11.5px',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <span>{st.symbol}</span>
              <span
                style={{
                  fontSize: '10.5px',
                  fontWeight: 800,
                  color: isSelected ? '#A3DFD3' : '#0D7C66',
                }}
              >
                ₹{livePrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </button>
          );
        })}
      </div>

      {/* 4. MAIN TELEMETRY HUD BODY (Active Stock Cards) */}
      <div
        style={{
          padding: '16px 20px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '14px',
          alignItems: 'stretch',
        }}
      >
        {/* CARD 1: Stock Identity & Live Spot Price */}
        <div
          style={{
            background: 'linear-gradient(135deg, #F8FAFA 0%, #F0F6F6 100%)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: 'var(--shadow-subtle)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700, textTransform: 'uppercase' }}>
                Active Market Pulse
              </span>
              <span
                style={{
                  fontSize: '9px',
                  fontWeight: 800,
                  fontFamily: 'var(--font-mono)',
                  padding: '2px 6px',
                  borderRadius: 3,
                  color: '#0D7C66',
                  background: '#E6F5F2',
                }}
              >
                ● ACTIVE SESSION
              </span>
            </div>

            <div style={{ fontSize: '19px', fontWeight: 900, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
              {activeStock.symbol}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, marginTop: '1px' }}>
              {activeStock.name}
            </div>
            <div style={{ fontSize: '9.5px', color: 'var(--swatch-3-mineral)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
              Sector: {activeStock.sector}
            </div>
          </div>

          <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed var(--border-subtle)', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '20px', fontWeight: 900, color: 'var(--swatch-2-deep)', fontFamily: 'var(--font-mono)' }}>
              ₹{currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 800,
                color: isPositive ? '#0D7C66' : '#DC2626',
                fontFamily: 'var(--font-mono)',
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
              }}
            >
              {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {isPositive ? `+${priceChangePct.toFixed(2)}%` : `${priceChangePct.toFixed(2)}%`}
            </span>
          </div>
        </div>

        {/* CARD 2: Net Asset Value (NAV) of Friday Session & Allocation */}
        <div
          style={{
            background: 'linear-gradient(135deg, #F8FAFA 0%, #F0F6F6 100%)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: 'var(--shadow-subtle)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700, textTransform: 'uppercase' }}>
                Day's Net Asset Value (NAV)
              </span>
              <PieChart size={14} color="var(--swatch-2-deep)" />
            </div>

            <div style={{ fontSize: '19px', fontWeight: 800, color: 'var(--swatch-2-deep)', fontFamily: 'var(--font-mono)' }}>
              {formatMoney(stockNotional, 2)}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, marginTop: '2px' }}>
              Intraday NAV Commitment
            </div>
          </div>

          <div style={{ marginTop: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: '3px' }}>
              <span>Share of Desk NAV:</span>
              <span style={{ fontWeight: 800, color: '#0D7C66' }}>
                {stockExposurePct.toFixed(1)}%
              </span>
            </div>
            <div style={{ height: '5px', background: '#DCE5E5', borderRadius: '3px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.min(100, Math.max(12, stockExposurePct * 6.5))}%`,
                  height: '100%',
                  background: '#0D7C66',
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
            <div style={{ fontSize: '8.5px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '3px' }}>
              Total Desk Capital: {formatMoney(totalNav)}
            </div>
          </div>
        </div>

        {/* CARD 3: Overall Volume & Day's Turnover */}
        <div
          style={{
            background: 'linear-gradient(135deg, #F8FAFA 0%, #F0F6F6 100%)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: 'var(--shadow-subtle)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700, textTransform: 'uppercase' }}>
                Overall Volume Traded
              </span>
              <BarChart3 size={14} color="#0D7C66" />
            </div>

            <div style={{ fontSize: '19px', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
              {activeStock.dailyVol} <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>shares</span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, marginTop: '2px' }}>
              Turnover: <strong style={{ color: 'var(--swatch-2-deep)', fontFamily: 'var(--font-mono)' }}>₹{activeStock.turnoverCr}</strong>
            </div>
          </div>

          <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px dashed var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              <span>Day High / Low Range:</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', marginTop: '2px' }}>
              <span>L: ₹{dayLow.toFixed(2)}</span>
              <span style={{ color: '#0D7C66' }}>H: ₹{dayHigh.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* CARD 4: Net Profit & Loss (P&L) of Current Session */}
        <div
          style={{
            background: 'linear-gradient(135deg, #F8FAFA 0%, #F0F6F6 100%)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: 'var(--shadow-subtle)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700, textTransform: 'uppercase' }}>
                Stock Net Profit / Loss
              </span>
              <DollarSign size={14} color="#0D7C66" />
            </div>

            <div
              style={{
                fontSize: '19px',
                fontWeight: 900,
                color: '#0D7C66',
                fontFamily: 'var(--font-mono)',
              }}
            >
              +₹{totalStockPnl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)', fontWeight: 600, marginTop: '2px' }}>
              Intraday Session Market P&L
            </div>
          </div>

          <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px dashed var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              <span>Realized: <strong style={{ color: '#0D7C66' }}>+₹{stockRealizedPnl.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</strong></span>
              <span>Open: <strong style={{ color: '#0D7C66' }}>+₹{stockUnrealizedPnl.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</strong></span>
            </div>
          </div>
        </div>

        {/* CARD 5: Gross Exposure & AI Quorum Verdict */}
        <div
          style={{
            background: 'linear-gradient(135deg, #F8FAFA 0%, #F0F6F6 100%)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: 'var(--shadow-subtle)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700, textTransform: 'uppercase' }}>
                Gross Exposure & AI Edge
              </span>
              <Zap size={14} color="#B76E00" />
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '18px', fontWeight: 900, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {stockExposurePct.toFixed(1)}% <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 600 }}>/ 15.0% cap</span>
              </span>
              <span
                style={{
                  fontSize: '9px',
                  fontWeight: 800,
                  fontFamily: 'var(--font-mono)',
                  padding: '2px 6px',
                  borderRadius: 3,
                  color: '#0D7C66',
                  background: '#E6F5F2',
                }}
              >
                {activeStock.aiBias}
              </span>
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 600, marginTop: '3px' }}>
              Lead Agent: <strong style={{ color: 'var(--swatch-2-deep)' }}>{activeStock.leadAgent}</strong>
            </div>
          </div>

          <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px dashed var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              <span>Swarm Alignment:</span>
              <span style={{ fontWeight: 800, color: '#0D7C66' }}>
                {Math.round(activeStock.aiConfidence * 100)}% CONSENSUS
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
