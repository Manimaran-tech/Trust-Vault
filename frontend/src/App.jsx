import React, { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { WebSocketProvider } from './context/WebSocketContext';
import Navbar from './components/Navbar';
import AmbientBackground from './components/AmbientBackground';
import Dashboard from './pages/Dashboard';
import Simulator from './pages/Simulator';
import Portfolio from './pages/Portfolio';
import DecisionDetail from './pages/DecisionDetail';
import AuditLog from './pages/AuditLog';
import Watchdog from './pages/Watchdog';
import Architecture from './pages/Architecture';
import { initGlobalScrollReveal } from './lib/useScrollReveal';
import { animate, stagger } from './lib/animeUtils';

function AnimatedPageWrapper({ children }) {
  const location = useLocation();
  const pageRef = useRef(null);

  useEffect(() => {
    // Reset scroll to top on tab switch
    window.scrollTo({ top: 0, behavior: 'instant' });

    if (pageRef.current) {
      // 1. Smooth Page-Level Entrance
      animate(pageRef.current, {
        opacity: [0, 1],
        translateY: [14, 0],
        duration: 380,
        ease: 'outExpo'
      });

      // 2. Staggered Entrance Cascade for all cards & sections on the new tab
      const directCards = pageRef.current.querySelectorAll(
        '.glass-card, .page-header, .unified-workbench-window, .panel-container, .cyber-card'
      );
      if (directCards.length > 0) {
        animate(directCards, {
          opacity: [0, 1],
          translateY: [16, 0],
          delay: stagger(35, { start: 50 }),
          duration: 480,
          ease: 'outExpo'
        });
      }
    }
  }, [location.pathname]);

  return (
    <div ref={pageRef} key={location.pathname} style={{ width: '100%' }}>
      {children}
    </div>
  );
}

function AppRoutes() {
  useEffect(() => {
    const cleanup = initGlobalScrollReveal();
    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  return (
    <WebSocketProvider>
      <AmbientBackground />
      <div className="app-layout" style={{ position: 'relative', minHeight: '100vh', zIndex: 1 }}>
        <Navbar />
        <main className="main-content" style={{ position: 'relative', zIndex: 2 }}>
          <AnimatedPageWrapper>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/simulator" element={<Simulator />} />
              <Route path="/portfolio" element={<Portfolio />} />
              <Route path="/decision/:id" element={<DecisionDetail />} />
              <Route path="/audit" element={<AuditLog />} />
              <Route path="/watchdog" element={<Watchdog />} />
              <Route path="/architecture" element={<Architecture />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AnimatedPageWrapper>
        </main>
      </div>
    </WebSocketProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
