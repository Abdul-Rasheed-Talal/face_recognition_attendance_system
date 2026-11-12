import { useEffect, useRef, useState, useCallback } from 'react';
import { LiveAttendanceEvent } from '../types';

export function useWebSocket(onEvent?: (event: LiveAttendanceEvent) => void) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const pingIntervalRef = useRef<any>(null);

  const connect = useCallback(() => {
    try {
      const wsUrl = 'ws://localhost:8000/ws/attendance';
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        // Start ping heartbeat
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, 15000);
      };

      ws.onmessage = (event) => {
        try {
          if (event.data === 'pong') return;
          const data: LiveAttendanceEvent = JSON.parse(event.data);
          if (onEvent) {
            onEvent(data);
          }
        } catch (err) {
          console.debug('Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        // Reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.debug('WebSocket error:', err);
        ws.close();
      };
    } catch (e) {
      console.debug('WebSocket connection error:', e);
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    }
  }, [onEvent]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    };
  }, [connect]);

  return { isConnected };
}
