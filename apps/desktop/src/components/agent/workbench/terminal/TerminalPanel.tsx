import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TerminalSquare, Play, Trash2, ExternalLink, Plus, SlidersHorizontal } from 'lucide-react';
import { Button, Input, Space, Tag, theme } from 'antd';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useTranslation } from 'react-i18next';
import '@xterm/xterm/css/xterm.css';

import { api } from '../../../../services/desktop_api';
import { useChatStore } from '../../../../store/chat';
import {
  describeTerminalPlacement,
  useTerminalSessionsStore,
  type TerminalPlacementInfo,
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
  const initialRead = useTerminalSessionsStore((state) => state.initialRead);
  const resizeSession = useTerminalSessionsStore((state) => state.resize);
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
      // Replay retained history first, then subscribe. Placement-aware:
      // sandbox sessions replay store text fed by the poll pump.
      const read = await initialRead(session);
      if (cancelled) return;
      if (read.resync) setResync(true);
      const text = read.text;
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
        void resizeSession(session, xterm.cols, xterm.rows);
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
      {urls.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
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
      )}
      {resync && (
        <div data-pt-terminal-resync style={{ fontSize: 11, color: token.colorTextTertiary, marginBottom: 4 }}>
          {t('chat.terminal.resync')}
        </div>
      )}
      <div ref={containerRef} data-pt-terminal-xterm style={{ height: 280, borderRadius: 6, overflow: 'hidden' }} />
    </div>
  );
}

// Read-only description of the task's single execution surface. The task
// workspace choice already decided local vs remote; the terminal never
// re-chooses placement, it only displays it.
function PlacementIndicator({ refreshKey }: { refreshKey: string }) {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();
  const [info, setInfo] = useState<TerminalPlacementInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setInfo(null);
    setFailed(false);
    const resolve = () => {
      void describeTerminalPlacement()
        .then((resolved) => {
          if (active) setInfo(resolved);
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    };
    resolve();
    // The workspace pill lives outside this panel; refetch when the user
    // returns focus after changing the task's directory selection.
    window.addEventListener('focus', resolve);
    return () => {
      active = false;
      window.removeEventListener('focus', resolve);
    };
  }, [refreshKey]);

  if (failed) {
    return (
      <div
        data-pt-terminal-unavailable
        role="alert"
        style={{ fontSize: 12, color: token.colorErrorText, marginBottom: 8 }}
      >
        {t('chat.terminal.sandboxUnavailable')}
      </div>
    );
  }
  if (!info) return null;

  const isLocal = info.placement === 'desktop';
  return (
    <div
      data-pt-terminal-placement-indicator
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        fontSize: 12,
        color: token.colorTextSecondary,
        marginBottom: 8,
      }}
    >
      <Tag color={isLocal ? 'default' : 'geekblue'}>
        {isLocal ? t('chat.terminal.placement.desktop') : t('chat.terminal.placement.remote')}
      </Tag>
      <span
        data-pt-terminal-placement-root
        title={info.root}
        style={{
          fontFamily: 'monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 240,
        }}
      >
        {info.root}
      </span>
      {isLocal && (
        <Tag>{t(`chat.input.workspace.${info.shellAccess === 'full' ? 'fullShort' : 'standardShort'}`)}</Tag>
      )}
      {!isLocal && info.sandboxRef && (
        <span style={{ color: token.colorTextTertiary, fontFamily: 'monospace' }}>
          {info.sandboxRef}
        </span>
      )}
    </div>
  );
}

// Collapsed custom-command entry. Default interaction is the zero-form shell;
// this stays available for long-running services and the E2E service gate.
function CustomCommandForm({
  conversationId,
  onStarted,
}: {
  conversationId: string;
  onStarted: () => void;
}) {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();
  const openShell = useTerminalSessionsStore((state) => state.openShell);
  const [deviceId, setDeviceId] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void api.accountGetDeviceId().then(({ device_id }) => setDeviceId(device_id));
  }, []);

  const start = useCallback(async () => {
    setError('');
    try {
      await openShell(
        conversationId,
        deviceId,
        command.trim() ? { command: command.trim(), args: tokenizeArgs(args) } : undefined,
      );
      setCommand('');
      setArgs('');
      onStarted();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError));
    }
  }, [args, command, conversationId, deviceId, openShell, onStarted]);

  return (
    <div style={{ marginBottom: 10 }}>
      <Space.Compact style={{ width: '100%' }} data-pt-terminal-start-form>
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
      </Space.Compact>
      {error && (
        <div role="alert" style={{ color: token.colorErrorText, fontSize: 12, marginTop: 4 }}>
          {t('chat.terminal.startFailed')}: {error}
        </div>
      )}
    </div>
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
  const openShell = useTerminalSessionsStore((state) => state.openShell);
  const creating = useTerminalSessionsStore((state) => state.creating);
  const [deviceId, setDeviceId] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [openError, setOpenError] = useState('');

  useEffect(() => {
    void api.accountGetDeviceId().then(({ device_id }) => setDeviceId(device_id));
  }, []);

  const activeSession = useMemo(
    () => sessions.find((session) => session.sessionId === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  if (!conversationId) return null;

  const handleNewShell = async () => {
    setOpenError('');
    try {
      await openShell(conversationId, deviceId);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div
      data-pt-terminal-panel
      style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TerminalSquare size={15} />
        <strong data-pt-terminal-panel-title style={{ fontSize: 13 }}>
          {t('chat.terminal.panel.title')}
        </strong>
        <div style={{ flex: 1 }} />
        <Button
          size="small"
          icon={<Plus size={13} />}
          data-pt-terminal-new-shell
          disabled={!deviceId || creating}
          onClick={() => void handleNewShell()}
        >
          {t('chat.terminal.newShell')}
        </Button>
        <Button
          size="small"
          type={showCustom ? 'default' : 'text'}
          icon={<SlidersHorizontal size={13} />}
          data-pt-terminal-custom-toggle
          onClick={() => setShowCustom((value) => !value)}
        >
          {t('chat.terminal.customCommand')}
        </Button>
      </div>

      <PlacementIndicator refreshKey={`${conversationId}:${sessions.length}:${creating ? 1 : 0}`} />
      {openError && (
        <div role="alert" style={{ color: token.colorErrorText, fontSize: 12 }}>
          {t('chat.terminal.startFailed')}: {openError}
        </div>
      )}
      {showCustom && (
        <div data-pt-terminal-custom-form>
          <CustomCommandForm conversationId={conversationId} onStarted={() => setShowCustom(false)} />
        </div>
      )}

      {sessions.length === 0 ? (
        <div data-pt-terminal-empty style={{ color: token.colorTextSecondary, fontSize: 12 }}>
          {creating
            ? <span data-pt-terminal-starting>{t('chat.terminal.starting')}</span>
            : t('chat.terminal.empty')}
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
                  flexWrap: 'wrap',
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
                <Tag
                  data-pt-terminal-list-placement={session.placement}
                  color={session.placement === 'sandbox' ? 'geekblue' : 'default'}
                  style={{ marginInlineEnd: 0 }}
                >
                  {session.placement === 'sandbox'
                    ? t('chat.terminal.placement.remote')
                    : t('chat.terminal.placement.desktop')}
                </Tag>
                <Tag>{t(`chat.terminal.status.${session.status}`)}</Tag>
                {session.cwd && (
                  <span
                    data-pt-terminal-cwd
                    title={session.cwd}
                    style={{
                      color: token.colorTextSecondary,
                      fontSize: 12,
                      fontFamily: 'monospace',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 220,
                    }}
                  >
                    {t('chat.terminal.cwd')}: {session.cwd}
                  </span>
                )}
                {session.pid > 0 && (
                  <span data-pt-terminal-pid style={{ color: token.colorTextSecondary, fontSize: 12 }}>
                    {t('chat.terminal.pid')}: {session.pid}
                  </span>
                )}
                {(session.status === 'exited' || session.status === 'killed') && session.exitCode !== null && (
                  <span data-pt-terminal-exit-code style={{ color: token.colorTextSecondary, fontSize: 12 }}>
                    {t('chat.terminal.exitCode')}: {session.exitCode}
                  </span>
                )}
                <div style={{ flex: 1 }} />
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
    </div>
  );
}
