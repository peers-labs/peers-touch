import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

export interface TerminalHandle {
  writeCommand: (cmd: string) => void;
  focus: () => void;
}

interface TerminalProps {
  sessionId: string | null;
  onDisconnect?: () => void;
  onConnected?: (cols: number, rows: number) => void;
  isRecovered?: boolean;
}

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

function getWsUrl(sessionId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = BASE_URL.startsWith('http')
    ? BASE_URL.replace(/^https?:/, proto)
    : `${proto}//${window.location.host}${BASE_URL}`;
  return `${base}/applets/remote-cli/ws?session=${sessionId}`;
}

export const TerminalPanel = forwardRef<TerminalHandle, TerminalProps>(
  function TerminalPanel({ sessionId, onDisconnect, onConnected, isRecovered }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<XTerm | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const onDisconnectRef = useRef(onDisconnect);
    onDisconnectRef.current = onDisconnect;
    const onConnectedRef = useRef(onConnected);
    onConnectedRef.current = onConnected;

    const writeCommand = useCallback((cmd: string) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(cmd + '\n');
      }
    }, []);

    const focus = useCallback(() => {
      termRef.current?.focus();
    }, []);

    useImperativeHandle(ref, () => ({ writeCommand, focus }), [writeCommand, focus]);

    // Create xterm instance once per sessionId
    useEffect(() => {
      if (!containerRef.current) return;

      const term = new XTerm({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
        theme: {
          background: '#1a1a2e',
          foreground: '#e0e0e0',
          cursor: '#56b6c2',
          selectionBackground: '#3e4451',
        },
        scrollback: 10000,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      const linksAddon = new WebLinksAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(linksAddon);
      term.open(containerRef.current);
      fitAddon.fit();

      termRef.current = term;
      fitRef.current = fitAddon;

      if (!sessionId) {
        term.writeln('\x1b[90mNo active session. Select a connection and click Connect.\x1b[0m');
      }

      const handleResize = () => fitAddon.fit();
      window.addEventListener('resize', handleResize);

      const observer = new ResizeObserver(() => fitAddon.fit());
      observer.observe(containerRef.current);

      return () => {
        window.removeEventListener('resize', handleResize);
        observer.disconnect();
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
      };
    }, [sessionId]);

    // WebSocket connection — depends ONLY on sessionId (not onDisconnect)
    useEffect(() => {
      if (!sessionId || !termRef.current) return;

      const term = termRef.current;
      const url = getWsUrl(sessionId);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        term.clear();
        if (isRecovered) {
          term.writeln('\x1b[32mSession restored.\x1b[0m\r\n');
        } else {
          term.writeln('\x1b[32mConnected.\x1b[0m\r\n');
        }

        // Sync PTY dimensions after connection
        setTimeout(() => {
          if (fitRef.current && ws.readyState === WebSocket.OPEN) {
            fitRef.current.fit();
            const dims = fitRef.current.proposeDimensions();
            if (dims) {
              onConnectedRef.current?.(dims.cols, dims.rows);
            }
          }
          // For recovered sessions, also nudge the shell
          if (isRecovered && ws.readyState === WebSocket.OPEN) {
            ws.send('\n');
          }
        }, 200);
      };

      ws.onmessage = (e) => {
        const data = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
        term.write(data);
      };

      ws.onclose = () => {
        term.writeln('\r\n\x1b[31mDisconnected.\x1b[0m');
        onDisconnectRef.current?.();
      };

      ws.onerror = () => {
        term.writeln('\r\n\x1b[31mWebSocket error.\x1b[0m');
      };

      const disposable = term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      return () => {
        disposable.dispose();
        ws.close();
        wsRef.current = null;
      };
    }, [sessionId, isRecovered]);

    return (
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
        }}
      />
    );
  },
);
