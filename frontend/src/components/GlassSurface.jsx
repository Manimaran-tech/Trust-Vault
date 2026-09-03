/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useState, useRef, useId } from 'react';
import './GlassSurface.css';

const GlassSurface = ({
  children,
  width = '100%',
  height = 68,
  borderRadius = 9999,
  borderWidth = 0.07,
  brightness = 50,
  opacity = 0.93,
  blur = 11,
  displace = 0,
  backgroundOpacity = 0.15,
  saturation = 1.8,
  distortionScale = 30,
  redOffset = 8,
  greenOffset = 0,
  blueOffset = -8,
  xChannel = 'R',
  yChannel = 'G',
  mixBlendMode = 'screen',
  className = '',
  style = {}
}) => {
  const uniqueId = useId().replace(/:/g, '-');
  const filterId = `liquid-glass-filter-${uniqueId}`;

  const containerRef = useRef(null);

  const containerStyle = {
    ...style,
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    borderRadius: typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius,
  };

  return (
    <div
      ref={containerRef}
      className={`liquid-glass-surface ${className}`}
      style={containerStyle}
    >
      {/* SVG Liquid Caustic Refraction Filter */}
      <svg className="liquid-glass-svg-filter" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id={filterId} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.015 0.03"
              numOctaves="3"
              seed="7"
              result="waterNoise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="waterNoise"
              scale={distortionScale}
              xChannelSelector={xChannel}
              yChannelSelector={yChannel}
              result="dispGraphic"
            />
            <feGaussianBlur in="dispGraphic" stdDeviation="0.4" />
          </filter>
        </defs>
      </svg>

      {/* Liquid Caustic Refraction Ripple Textures */}
      <div className="liquid-caustics-mesh" />
      <div className="liquid-caustics-ripples" />

      {/* Prismatic Rainbow Edge Dispersion (Chromatic Aberration) */}
      <div className="liquid-prismatic-border" />
      <div className="liquid-specular-highlight" />

      {/* Interactive Content Layer */}
      <div className="liquid-glass-content">{children}</div>
    </div>
  );
};

export default GlassSurface;
