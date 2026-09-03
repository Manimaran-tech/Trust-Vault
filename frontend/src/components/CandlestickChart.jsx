import React, { useMemo, useCallback, useState } from 'react';
import { scaleLinear, scaleTime, scaleBand } from '@visx/scale';
import { Bar, Line } from '@visx/shape';
import { ParentSize } from '@visx/responsive';
import { extent, max, min } from 'd3-array';

/**
 * CandlestickChart — OHLC candle chart built with @visx (Bklit UI style).
 *
 * Composable, responsive, with hover tooltips and gradient backgrounds.
 * Each candle is colored green (positive) or red (negative) with wicks.
 */

// ---------- Palette ----------
const PALETTE = {
  positive: '#0D7C66',
  positiveFaded: 'rgba(13, 124, 102, 0.25)',
  negative: '#DC2626',
  negativeFaded: 'rgba(220, 38, 38, 0.25)',
  grid: 'rgba(125, 174, 170, 0.12)',
  axis: 'var(--text-muted)',
  tooltip: {
    bg: 'rgba(13, 46, 55, 0.95)',
    fg: '#F8FAFA',
    border: 'rgba(125, 174, 170, 0.35)',
  },
  wick: '#64748B',
};

const MARGIN = { top: 16, right: 52, bottom: 40, left: 12 };

// ---------- Helpers ----------
const getDate = (d) => new Date(d.date);
const getOpen = (d) => d.open;
const getHigh = (d) => d.high;
const getLow = (d) => d.low;
const getClose = (d) => d.close;
const getVolume = (d) => d.volume || 0;
const isPositive = (d) => d.close >= d.open;

function formatPrice(v) {
  if (v == null) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTime(d) {
  const date = new Date(d);
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDate(d) {
  const date = new Date(d);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

// ---------- Inner Chart ----------
function CandlestickChartInner({ data, width, height, fadedOpacity = 0.25 }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;
  const volumeHeight = innerHeight * 0.18;
  const priceHeight = innerHeight - volumeHeight - 8;

  const xScale = useMemo(
    () =>
      scaleBand({
        domain: data.map((_, i) => i),
        range: [0, innerWidth],
        padding: 0.3,
      }),
    [data, innerWidth],
  );

  const yScale = useMemo(() => {
    const allHigh = max(data, getHigh) || 0;
    const allLow = min(data, getLow) || 0;
    const pad = (allHigh - allLow) * 0.08;
    return scaleLinear({
      domain: [allLow - pad, allHigh + pad],
      range: [priceHeight, 0],
      nice: true,
    });
  }, [data, priceHeight]);

  const volumeScale = useMemo(() => {
    const maxVol = max(data, getVolume) || 1;
    return scaleLinear({
      domain: [0, maxVol],
      range: [0, volumeHeight],
    });
  }, [data, volumeHeight]);

  const candleWidth = xScale.bandwidth();

  const handleMouseMove = useCallback(
    (event) => {
      const svgRect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - svgRect.left - MARGIN.left;
      const idx = Math.round((x / innerWidth) * (data.length - 1));
      if (idx >= 0 && idx < data.length) {
        setHoverIndex(idx);
      }
    },
    [data.length, innerWidth],
  );

  const handleMouseLeave = useCallback(() => setHoverIndex(null), []);

  if (innerWidth <= 0 || innerHeight <= 0 || !data.length) {
    return (
      <div
        style={{
          width,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: '11px',
          fontFamily: 'var(--font-mono)',
        }}
      >
        No candle data available
      </div>
    );
  }

  // Y-axis ticks
  const yTicks = yScale.ticks(6);

  // X-axis ticks — show every Nth label to avoid crowding
  const xStep = Math.max(1, Math.floor(data.length / 8));

  const hoverPoint = hoverIndex != null ? data[hoverIndex] : null;

  return (
    <div style={{ position: 'relative' }}>
      <svg
        width={width}
        height={height}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ overflow: 'visible' }}
      >
        <defs>
          <linearGradient id="candle-volume-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(125, 174, 170, 0.3)" />
            <stop offset="100%" stopColor="rgba(125, 174, 170, 0.05)" />
          </linearGradient>
        </defs>

        <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
          {/* Grid lines */}
          {yTicks.map((tick) => (
            <line
              key={tick}
              x1={0}
              x2={innerWidth}
              y1={yScale(tick)}
              y2={yScale(tick)}
              stroke={PALETTE.grid}
              strokeDasharray="3,3"
            />
          ))}

          {/* Y-axis labels (right side) */}
          {yTicks.map((tick) => (
            <text
              key={tick}
              x={innerWidth + 6}
              y={yScale(tick)}
              dy="0.35em"
              fill={PALETTE.axis}
              fontSize="9"
              fontFamily="var(--font-mono)"
              fontWeight="600"
            >
              {formatPrice(tick)}
            </text>
          ))}

          {/* Volume bars */}
          {data.map((d, i) => {
            const vol = getVolume(d);
            if (!vol) return null;
            const barH = volumeScale(vol);
            const x = xScale(i);
            return (
              <Bar
                key={`vol-${i}`}
                x={x}
                y={priceHeight + 8 + (volumeHeight - barH)}
                width={candleWidth}
                height={barH}
                fill="url(#candle-volume-grad)"
                opacity={hoverIndex === i ? 1 : 0.6}
                rx={1}
              />
            );
          })}

          {/* Candles */}
          {data.map((d, i) => {
            const x = xScale(i);
            const cx = x + candleWidth / 2;
            const pos = isPositive(d);
            const bodyTop = pos ? yScale(getClose(d)) : yScale(getOpen(d));
            const bodyBottom = pos ? yScale(getOpen(d)) : yScale(getClose(d));
            const bodyHeight = Math.max(1, bodyBottom - bodyTop);
            const color = pos ? PALETTE.positive : PALETTE.negative;
            const fadedColor = pos ? PALETTE.positiveFaded : PALETTE.negativeFaded;
            const isActive = hoverIndex === i;
            const opacity = hoverIndex != null && !isActive ? fadedOpacity : 1;

            return (
              <g key={`candle-${i}`} opacity={opacity}>
                {/* Wick */}
                <Line
                  from={{ x: cx, y: yScale(getHigh(d)) }}
                  to={{ x: cx, y: yScale(getLow(d)) }}
                  stroke={isActive ? color : PALETTE.wick}
                  strokeWidth={isActive ? 1.5 : 1}
                />
                {/* Body */}
                <Bar
                  x={x}
                  y={bodyTop}
                  width={candleWidth}
                  height={bodyHeight}
                  fill={color}
                  stroke={isActive ? color : 'none'}
                  strokeWidth={isActive ? 1.5 : 0}
                  rx={1}
                />
              </g>
            );
          })}

          {/* Hover crosshair */}
          {hoverIndex != null && (
            <>
              <line
                x1={xScale(hoverIndex) + candleWidth / 2}
                x2={xScale(hoverIndex) + candleWidth / 2}
                y1={0}
                y2={priceHeight + volumeHeight + 8}
                stroke="rgba(125, 174, 170, 0.4)"
                strokeDasharray="4,3"
                strokeWidth={1}
              />
              <line
                x1={0}
                x2={innerWidth}
                y1={yScale(getClose(data[hoverIndex]))}
                y2={yScale(getClose(data[hoverIndex]))}
                stroke="rgba(125, 174, 170, 0.3)"
                strokeDasharray="4,3"
                strokeWidth={1}
              />
              {/* Price label on right */}
              <g transform={`translate(${innerWidth + 2}, ${yScale(getClose(data[hoverIndex]))})`}>
                <rect x={0} y={-8} width={46} height={16} rx={3} fill="rgba(13, 46, 55, 0.9)" />
                <text x={4} y={4} fill="#FFFFFF" fontSize="8.5" fontFamily="var(--font-mono)" fontWeight="700">
                  {formatPrice(getClose(data[hoverIndex]))}
                </text>
              </g>
            </>
          )}

          {/* X-axis */}
          {data.map((d, i) => {
            if (i % xStep !== 0) return null;
            const x = xScale(i) + candleWidth / 2;
            return (
              <text
                key={`x-${i}`}
                x={x}
                y={priceHeight + volumeHeight + 26}
                textAnchor="middle"
                fill={PALETTE.axis}
                fontSize="8.5"
                fontFamily="var(--font-mono)"
                fontWeight="600"
              >
                {formatDate(d.date)}
              </text>
            );
          })}
        </g>
      </svg>

      {/* Tooltip */}
      {hoverPoint && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: MARGIN.left + 8,
            background: PALETTE.tooltip.bg,
            border: `1px solid ${PALETTE.tooltip.border}`,
            borderRadius: '6px',
            padding: '8px 12px',
            fontSize: '10px',
            fontFamily: 'var(--font-mono)',
            color: PALETTE.tooltip.fg,
            pointerEvents: 'none',
            zIndex: 10,
            minWidth: '140px',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: '4px', fontSize: '9px', opacity: 0.7 }}>
            {formatDate(hoverPoint.date)} {formatTime(hoverPoint.date)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
            <span style={{ opacity: 0.7 }}>O</span>
            <span style={{ fontWeight: 700 }}>{formatPrice(hoverPoint.open)}</span>
            <span style={{ opacity: 0.7 }}>H</span>
            <span style={{ fontWeight: 700, color: PALETTE.positive }}>{formatPrice(hoverPoint.high)}</span>
            <span style={{ opacity: 0.7 }}>L</span>
            <span style={{ fontWeight: 700, color: PALETTE.negative }}>{formatPrice(hoverPoint.low)}</span>
            <span style={{ opacity: 0.7 }}>C</span>
            <span style={{ fontWeight: 700, color: isPositive(hoverPoint) ? PALETTE.positive : PALETTE.negative }}>
              {formatPrice(hoverPoint.close)}
            </span>
            {hoverPoint.volume > 0 && (
              <>
                <span style={{ opacity: 0.7 }}>Vol</span>
                <span style={{ fontWeight: 700 }}>{hoverPoint.volume.toLocaleString('en-IN')}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Responsive Wrapper ----------
export default function CandlestickChart({ data = [], height = 340, fadedOpacity = 0.25 }) {
  if (!data.length) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: '11px',
          fontFamily: 'var(--font-mono)',
          background: 'rgba(248, 250, 250, 0.4)',
          borderRadius: 'var(--radius-sm)',
          border: '1px dashed var(--border-subtle)',
        }}
      >
        Waiting for candle data…
      </div>
    );
  }

  return (
    <ParentSize>
      {({ width }) =>
        width > 0 ? (
          <CandlestickChartInner data={data} width={width} height={height} fadedOpacity={fadedOpacity} />
        ) : null
      }
    </ParentSize>
  );
}
