import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { WS_URL, ensureAuth } from '../api';

const WebSocketContext = createContext(null);

export function WebSocketProvider({ children }) {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimeout = useRef(null);

  const connect = useCallback(async () => {
    try {
      // Ensure we have a valid token before opening the socket
      let token = localStorage.getItem('trustvault_token');
      if (!token) {
        token = await ensureAuth();
      }

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = async () => {
        let currentToken = localStorage.getItem('trustvault_token') || token;
        if (!currentToken) {
          currentToken = await ensureAuth();
        }
        if (currentToken && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'auth', token: currentToken }));
        } else {
          ws.close(4001, 'No auth token');
        }
      };

      ws.onmessage = (event) => {
        if (event.data === 'pong') return;
        try {
          const data = JSON.parse(event.data);

          // Handle auth response
          if (data.type === 'auth_ok') {
            setConnected(true);
            // Start heartbeat after successful auth
            const heartbeat = setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) ws.send('ping');
            }, 30000);
            ws._heartbeat = heartbeat;
            return;
          }

          if (data.type === 'error') {
            console.error('WebSocket error:', data.message);
            return;
          }

          // Stamp arrival time so consumers can age events out instead of
          // showing a stale agent state indefinitely.
          setEvents(prev => [{ ...data, receivedAt: Date.now() }, ...prev].slice(0, 200));
        } catch (e) { /* ignore */ }
      };

      ws.onclose = () => {
        setConnected(false);
        if (ws._heartbeat) clearInterval(ws._heartbeat);
        reconnectTimeout.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    } catch (e) {
      reconnectTimeout.current = setTimeout(connect, 3000);
    }
  }, []);

  useEffect(() => {
    connect();

    // The API layer silently re-authenticates when a token expires. The socket
    // authenticated with the old token is already dead, so rebuild it against
    // the new one instead of waiting out the reconnect backoff.
    const onReauth = () => {
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* already closing */ }
      }
      connect();
    };
    window.addEventListener('trustvault:reauthenticated', onReauth);

    return () => {
      window.removeEventListener('trustvault:reauthenticated', onReauth);
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
    };
  }, [connect]);

  return (
    <WebSocketContext.Provider value={{ events, connected }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  return useContext(WebSocketContext);
}
