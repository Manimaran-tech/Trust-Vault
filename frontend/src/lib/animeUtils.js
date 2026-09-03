import { animate, createTimeline, createTimer, createDraggable, createScope, stagger, spring, eases, splitText } from 'animejs';

/**
 * Animate a numeric value on an element or React ref from start to end with Anime.js
 */
export function animateCounter(elementOrRef, fromValue, toValue, options = {}) {
  const el = elementOrRef?.current || elementOrRef;
  if (!el) return null;

  const {
    duration = 1000,
    decimals = 0,
    prefix = '',
    suffix = '',
    ease = 'outExpo',
    onUpdate
  } = options;

  const obj = { val: fromValue };

  return animate(obj, {
    val: toValue,
    duration,
    ease,
    onUpdate: () => {
      const formatted = `${prefix}${obj.val.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      })}${suffix}`;
      
      if (el.textContent !== undefined) {
        el.textContent = formatted;
      }
      if (onUpdate) onUpdate(obj.val, formatted);
    }
  });
}

/**
 * Stagger entrance animation for child elements or selector
 */
export function staggerEntrance(targets, options = {}) {
  if (!targets) return null;
  const {
    opacity = [0, 1],
    translateY = [20, 0],
    scale = [0.96, 1],
    delay = stagger(45, { start: 50 }),
    duration = 650,
    ease = 'outBack(1.4)'
  } = options;

  return animate(targets, {
    opacity,
    translateY,
    scale,
    delay,
    duration,
    ease
  });
}

/**
 * High-tech glowing energy pulse
 */
export function pulseGlow(target, color = 'rgba(13, 124, 102, 0.4)', duration = 1200) {
  if (!target) return null;
  const el = target?.current || target;
  return animate(el, {
    boxShadow: [
      `0 0 0 0 ${color}`,
      `0 0 18px 4px ${color}`,
      `0 0 0 0 transparent`
    ],
    duration,
    ease: 'inOutQuad',
    alternate: true,
    loop: 2
  });
}

/**
 * Draggable interactive card with spring return or free drag
 */
export function makeDraggable(target, options = {}) {
  const el = target?.current || target;
  if (!el) return null;

  return createDraggable(el, {
    snap: options.snap || 0,
    axis: options.axis || 'all',
    container: options.container,
    release: true,
    ...options
  });
}

/**
 * Radar / scanner sweeping timer animation
 */
export function createRadarTimer(onTick, intervalMs = 1000) {
  return createTimer({
    frameRate: 60,
    onUpdate: (timer) => {
      if (onTick) onTick(timer);
    }
  });
}

export {
  animate,
  createTimeline,
  createTimer,
  createDraggable,
  createScope,
  stagger,
  spring,
  eases,
  splitText
};
