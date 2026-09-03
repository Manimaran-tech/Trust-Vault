import React, { useEffect, useRef } from 'react';

/**
 * High-Performance Native Scroll Reveal Engine (60/120 FPS Compositor Optimized)
 * Pure IntersectionObserver with zero main-thread scroll listener overhead
 */
export function initGlobalScrollReveal() {
  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;

  const observerOptions = {
    root: null,
    rootMargin: '0px 0px -30px 0px',
    threshold: 0.05
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  const scanAndObserve = () => {
    const targets = document.querySelectorAll(
      '.scroll-reveal, .scroll-reveal-left, .scroll-reveal-right, .scroll-reveal-scale, .scroll-auto-reveal'
    );
    targets.forEach((target) => {
      if (!target.classList.contains('is-revealed')) {
        observer.observe(target);
      }
    });
  };

  scanAndObserve();

  // Low-frequency debounced observer for DOM mutations
  let mutationTimeout = null;
  const mutationObserver = new MutationObserver(() => {
    if (mutationTimeout) clearTimeout(mutationTimeout);
    mutationTimeout = setTimeout(scanAndObserve, 150);
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  return () => {
    observer.disconnect();
    mutationObserver.disconnect();
    if (mutationTimeout) clearTimeout(mutationTimeout);
  };
}

/**
 * ScrollReveal Wrapper Component
 */
export function ScrollReveal({
  children,
  direction = 'up', // 'up', 'left', 'right', 'scale'
  delay = 0,
  className = '',
  style = {}
}) {
  const ref = useRef(null);

  const directionClass =
    direction === 'left' ? 'scroll-reveal-left' :
    direction === 'right' ? 'scroll-reveal-right' :
    direction === 'scale' ? 'scroll-reveal-scale' :
    'scroll-reveal';

  return (
    <div
      ref={ref}
      className={`${directionClass} ${className}`}
      style={{
        transitionDelay: delay ? `${delay}ms` : undefined,
        ...style
      }}
    >
      {children}
    </div>
  );
}
