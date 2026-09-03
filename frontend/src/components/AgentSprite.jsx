import React, { useEffect, useState } from 'react';

/**
 * One frame of a pixel-agents character sheet.
 *
 * The sheets are 112x96 laid out as 7 animation columns by 3 facing rows of
 * 16x32 cells. Every place that showed a sprite used to do this arithmetic
 * inline and get it slightly wrong — a 16x24 window onto a 32px cell crops the
 * feet, a 190x160 background scales a 16px cell to 27.14px and lands the frame
 * off the pixel grid. Doing it once, correctly, is the difference between a
 * character and a smear.
 *
 * The sheets are served from `/sprites`, not from raw.githubusercontent, so a
 * blocked network or an offline demo machine cannot turn the whole roster into
 * empty boxes.
 */
const COLS = 7;
const ROWS = 3;
const CELL_W = 16;
const CELL_H = 32;

export const FACING = { down: 0, up: 1, side: 2 };

export default function AgentSprite({
  src,
  /** Height of the rendered character in px. Width follows the sheet's ratio. */
  size = 40,
  facing = 'down',
  /** Cycle the first three columns, so an active agent visibly breathes. */
  animated = false,
  frame = 0,
  title,
  style = {},
}) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!animated) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 420);
    return () => clearInterval(id);
  }, [animated]);

  const scale = size / CELL_H;
  const w = CELL_W * scale;
  const h = CELL_H * scale;
  const col = animated ? tick % 3 : frame % COLS;
  const row = FACING[facing] ?? 0;

  return (
    <div
      title={title}
      style={{
        width: `${w}px`,
        height: `${h}px`,
        flexShrink: 0,
        backgroundImage: `url(${src})`,
        backgroundSize: `${COLS * w}px ${ROWS * h}px`,
        backgroundPosition: `-${col * w}px -${row * h}px`,
        backgroundRepeat: 'no-repeat',
        imageRendering: 'pixelated',
        ...style,
      }}
    />
  );
}
