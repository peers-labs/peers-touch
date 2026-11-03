import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TerminalSquare, Play, X, Trash2, ExternalLink } from 'lucide-react';
import { Button, Drawer, Input, Space, Tag, theme } from 'antd';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useTranslation } from 'react-i18next';
import '@xterm/xterm/css/xterm.css';

import { api, terminalWorkerRead, terminalWorkerResize } from '../../../../services/desktop_api';
import { useChatStore } from '../../../../store/chat';
import {
  useTerminalSessionsStore,
  type TerminalSessionView,
} from '../../../../store/terminalSessions';

const URL_PATTERN = /https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?::\d+)?(?:\/[^\s"']*)?/g;
const EMPTY_SESSIONS: TerminalSessionView[] = [];

// Minimal shell-style tokenizer: honors single/double quoted segments so
// `sh -c "echo URL; exec python3 -m http.server 8080"` keeps one -c argument.
function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '' | '"' | "'" = '';
  for (const char of input) {
    if (quote) {
      if (char === quote) {
        quote = '';
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function TerminalViewer({ session }: { session: TerminalSessionView }) {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const attachOutput = useTerminalSessionsStore((state) => state.attachOutput);
  const attachStatus = useTerminalSessionsStore((state) => state.attachStatus);
  const hydrateFromCursor = useTerminalSessionsStore((state) => state.hydrateFromCursor);
  const writeInput = useTerminalSessionsStore((state) => state.writeInput);
  const [resync, setResync] = useState(false);
  const [urls, setUrls] = useState<string[]>([]);
  const textRef = useRef('');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const xterm = new Terminal({
      fontSize: 12,
      scrollback: 5000,
      convertEol: true,
      theme: { background: token.colorBgSpotlight },
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(container);
    requestAnimationFrame(() => fit.fit());
    terminalRef.current = xterm;
    fitRef.current = fit;

    const dataDisposable = xterm.onData((data) => {
      void writeInput(session.sessionId, data);
    });

    let cancelled = false;
    let unsub: () => void = () => undefined;
    void (async () => {
      // Replay retained history first, then subscribe.
      const read = await terminalWorkerRead(session.sessionId, 0);
      if (cancelled) return;
      if (read.resync) setResync(true);
      const decoded = atob(read.chunkB64 || '');
      const bytes = Uint8Array.from(decoded, (ch) => ch.charCodeAt(0));
      const text = new TextDecoder().decode(bytes);
      textRef.current = text;
      xterm.write(text);
      setUrls(Array.from(new Set(text.match(URL_PATTERN) ?? [])));
      await hydrateFromCursor(session.sessionId, 0).catch(() => undefined);

      const unsubscribeOutput = attachOutput(session.sessionId, (chunk) => {
        textRef.current += chunk;
        xterm.write(chunk);
        const matches = textRef.current.match(URL_PATTERN) ?? [];
        setUrls((previous) => Array.from(new Set([...previous, ...matches])));
      });
      const unsubscribeStatus = attachStatus(session.sessionId, () => undefined);
      unsub = () => {
        unsubscribeOutput();
        unsubscribeStatus();
      };
    })();

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        void terminalWorkerResize(session.sessionId, xterm.cols, xterm.rows);
      } catch {
        // Terminal may have been removed concurrently; ignore resize races.
      }
    });
    observer.observe(container);

    return () => {
      cancelled = true;
      unsub();
      dataDisposable.dispose();
      observer.disconnect();
      xterm.dispose();
      terminalRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionId]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Tag>{t(`chat.terminal.status.${session.status}`)}</Tag>
        <span data-pt-terminal-pid style={{ color: token.colorTextSecondary, fontSize: 12 }}>
          {t('chat.terminal.pid')}: {session.pid}
        </span>
        {session.exitCode !== null && (
          <span data-pt-terminal-exit-code style={{ color: token.colorTextSecondary, fontSize: 12 }}>
            {t('chat.terminal.exitCode')}: {session.exitCode}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {urls.map((url) => (
          <Button
            key={url}
            size="small"
            icon={<ExternalLink size={12} />}
            data-pt-terminal-open-url={url}
            onClick={() => void api.openExternalUrl(url).catch(() => undefined)}
          >
            {url}
          </Button>
        ))}
      </div>
      {resync && (
        <div data-pt-terminal-resync style={{ fontSize: 11, color: token.colorTextTertiary, marginBottom: 4 }}>
          {t('chat.terminal.resync')}
        </div>
      )}
      <div ref={containerRef} data-pt-terminal-xterm style={{ height: 280, borderRadius: 6, overflow: 'hidden' }} />
    </div>
  );
}

function StartSessionForm({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();
  const createSession = useTerminalSessionsStore((state) => state.createSession);
  const [deviceId, setDeviceId] = useState('');
  const [command, setCommand] = useState('python3');
  const [args, setArgs] = useState('-m http.server 18099');
  const [error, setError] = useState('');

  useEffect(() => {
    void api.accountGetDeviceId().then(({ device_id }) => setDeviceId(device_id));
  }, []);

  const start = useCallback(async () => {
    setError('');
    try {
      await createSession({
        conversationId,
        command: command.trim(),
        args: tokenizeArgs(args),
      }, deviceId);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError));
    }
  }, [args, command, conversationId, createSession, deviceId]);

  return (
    <Space.Compact style={{ width: '100%', marginBottom: 10 }} data-pt-terminal-start-form>
      <Input
        aria-label={t('chat.terminal.command')}
        data-pt-terminal-command
        value={command}
        onChange={(event) => setCommand(event.target.value)}
        style={{ width: 140 }}
        placeholder={t('chat.terminal.command')}
      />
      <Input
        aria-label={t('chat.terminal.args')}
        data-pt-terminal-args
        value={args}
        onChange={(event) => setArgs(event.target.value)}
        style={{ width: 240 }}
        placeholder={t('chat.terminal.args')}
      />
      <Button
        type="primary"
        icon={<Play size={13} />}
        data-pt-terminal-start
        disabled={!command.trim() || !deviceId}
        onClick={() => void start()}
      >
        {t('chat.terminal.start')}
      </Button>
      {error && (
        <span role="alert" style={{ color: token.colorErrorText, fontSize: 12, marginLeft: 8 }}>
          {t('chat.terminal.startFailed')}: {error}
        </span>
      )}
    </Space.Compact>
  );
}

export function TerminalPanel() {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();
  // The panel always follows the active task conversation; it never keeps a
  // stale conversation snapshot after the user switches topics.
  const conversationId = useChatStore((state) => state.currentSessionKey);
  const sessions = useTerminalSessionsStore((state) =>
    conversationId ? state.sessionsByConversation[conversationId] ?? EMPTY_SESSIONS : EMPTY_SESSIONS,
  );
  const activeSessionId = useTerminalSessionsStore((state) =>
    conversationId ? state.activeSessionByConversation[conversationId] ?? null : null,
  );
  const selectSession = useTerminalSessionsStore((state) => state.selectSession);
  const killSession = useTerminalSessionsStore((state) => state.killSession);
  const removeSession = useTerminalSessionsStore((state) => state.removeSession);

  const activeSession = useMemo(
    () => sessions.find((session) => session.sessionId === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  if (!conversationId) return null;

  return (
    <Drawer
      open
      placement="right"
      width={560}
      title={
        <Space>
          <TerminalSquare size={15} />
          <span data-pt-terminal-panel-title>{t('chat.terminal.panel.title')}</span>
        </Space>
      }
      onClose={() => useTerminalSessionsStore.getState().setOpen(false)}
      closeIcon={<X data-pt-terminal-close />}
      getContainer={false}
      mask={false}
      styles={{ body: { padding: 12, display: 'flex', flexDirection: 'column', gap: 8 } }}
    >
      <StartSessionForm conversationId={conversationId} />
      {sessions.length === 0 ? (
        <div data-pt-terminal-empty style={{ color: token.colorTextSecondary, fontSize: 12 }}>
          {t('chat.terminal.empty')}
        </div>
      ) : (
        <>
          <div data-pt-terminal-list style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sessions.map((session) => (
              <div
                key={session.sessionId}
                data-pt-terminal-session={session.sessionId}
                data-pt-terminal-status={session.status}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 8px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: session.sessionId === activeSessionId
                    ? token.colorPrimaryBg
                    : token.colorFillQuaternary,
                }}
                onClick={() => selectSession(conversationId, session.sessionId)}
              >
                <TerminalSquare size={13} />
                <span style={{ fontSize: 12, fontFamily: 'monospace' }}>
                  {session.command} {session.args.join(' ')}
                </span>
                <div style={{ flex: 1 }} />
                <Tag>{t(`chat.terminal.status.${session.status}`)}</Tag>
                {session.status === 'running' && (
                  <Button
                    size="small"
                    danger
                    data-pt-terminal-kill={session.sessionId}
                    onClick={(event) => {
                      event.stopPropagation();
                      void killSession(conversationId, session.sessionId);
                    }}
                  >
                    {t('chat.terminal.kill')}
                  </Button>
                )}
                <Button
                  size="small"
                  icon={<Trash2 size={12} />}
                  data-pt-terminal-remove={session.sessionId}
                  onClick={(event) => {
                    event.stopPropagation();
                    void removeSession(conversationId, session.sessionId);
                  }}
                >
                  {t('chat.terminal.remove')}
                </Button>
              </div>
            ))}
          </div>
          {activeSession && (
            <div data-pt-terminal-viewer style={{ minHeight: 0 }}>
              <TerminalViewer session={activeSession} />
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}
