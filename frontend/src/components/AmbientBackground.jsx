import React, { useEffect, useRef } from 'react';

export default function AmbientBackground({
  videoSrc = '/retro_sky_clouds.mp4',
  playbackRate = 0.6, // Slightly slower, relaxing cloud movement
  opacity = 0.42
}) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) {
      // Set slow playback speed
      videoRef.current.playbackRate = playbackRate;
      videoRef.current.defaultPlaybackRate = playbackRate;

      // Ensure autoplay starts reliably
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          // Autoplay was prevented or postponed
          console.debug('Ambient video autoplay note:', err);
        });
      }
    }
  }, [playbackRate, videoSrc]);

  return (
    <div className="ambient-background-root" aria-hidden="true">
      {/* 1. Slow, Smooth HTML5 MP4 Background Video with Floating Drift */}
      <div
        className="ambient-cloud-layer"
        style={{
          position: 'absolute',
          inset: '-25px',
          width: 'calc(100% + 50px)',
          height: 'calc(100% + 50px)',
          overflow: 'hidden',
          opacity: opacity,
          filter: 'blur(0.2px) saturate(0.95) contrast(1.04) brightness(1.05)',
          mixBlendMode: 'multiply',
          animation: 'ambientDriftSubtle 36s ease-in-out infinite alternate',
          willChange: 'transform'
        }}
      >
        <video
          ref={videoRef}
          src={videoSrc}
          autoPlay
          loop
          muted
          playsInline
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center top',
            pointerEvents: 'none'
          }}
        />
      </div>

      {/* 2. Precision Cyber Micro-Grid */}
      <div className="ambient-tech-grid" />

      {/* 3. Soft Sage/Mint Ambient Radial Orbs */}
      <div className="ambient-radial-orb-1" />
      <div className="ambient-radial-orb-2" />
      <div className="ambient-radial-orb-3" />

      {/* Parallax Drift Keyframes */}
      <style>{`
        @keyframes ambientDriftSubtle {
          0% {
            transform: translate3d(0, 0, 0) scale(1);
          }
          50% {
            transform: translate3d(-10px, -6px, 0) scale(1.015);
          }
          100% {
            transform: translate3d(8px, -12px, 0) scale(1.022);
          }
        }
      `}</style>
    </div>
  );
}
