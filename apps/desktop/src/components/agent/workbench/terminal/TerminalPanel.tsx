import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Dropdown, Input, theme } from 'antd';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
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

function shellLabel(command: string): string {
  const base = command.split('/').filter(Boolean).pop() ?? command;
  return base || 'shell';
}

function TerminalViewer({ session }: { session: TerminalSessionView }) {
  const { token } = theme.useToken();
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const attachOutput = useTerminalSessionsStore((state) => state.attachOutput);
  const attachStatus = useTerminalSessionsStore((state) => state.attachStatus);
  const initialRead = useTerminalSessionsStore((state) => state.initialRead);
  const resizeSession = useTerminalSessionsStore((state) => state.resize);
  const hydrateFromCursor = useTerminalSessionsStore((state) => state.hydrateFromCursor);
  const writeInput = useTerminalSessionsStore((state) => state.writeInput);

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
    xterm.loadAddon(new WebLinksAddon((_event, url) => {
      void api.openExternalUrl(url).catch(() => undefined);
    }));
    xterm.open(container);
    requestAnimationFrame(() => fit.fit());
    terminalRef.current = xterm;

    const dataDisposable = xterm.onData((data) => {
      void writeInput(session.sessionId, data);
    });

    let cancelled = false;
    let unsub: () => void = () => undefined;
    void (async () => {
      const read = await initialRead(session);
      if (cancelled) return;
      xterm.write(read.text);
      await hydrateFromCursor(session.sessionId, 0).catch(() => undefined);

      const unsubscribeOutput = attachOutput(session.sessionId, (chunk) => {
        xterm.write(chunk);
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

  return <div ref={containerRef} data-pt-terminal-xterm style={{ flex: 1, minHeight: 0, borderRadius: 6, overflow: 'hidden' }} />;
}

// Trae-style work surface: a shell tab strip plus the live shell. Placement
// (local project vs remote sandbox) is decided by the task workspace and is
// only surfaced as a tooltip, never as a management console.
export function TerminalPanel() {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();
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
  const [placement, setPlacement] = useState<TerminalPlacementInfo | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [openError, setOpenError] = useState('');

  useEffect(() => {
    void api.accountGetDeviceId().then(({ device_id }) => setDeviceId(device_id));
  }, []);

  useEffect(() => {
    let active = true;
    void describeTerminalPlacement()
      .then((info) => {
        if (active) setPlacement(info);
      })
      .catch(() => {
        if (active) setPlacement(null);
      });
    return () => {
      active = false;
    };
  }, [conversationId, sessions.length, creating]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.sessionId === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  // Dead shells leave the strip; the active shell stays until the user closes
  // the tab so its exit output remains visible.
  const tabs = useMemo(
    () => sessions.filter((session) => session.status === 'running' || session.sessionId === activeSessionId),
    [sessions, activeSessionId],
  );

  if (!conversationId) return null;

  const startShell = async () => {
    setOpenError('');
    try {
      await openShell(conversationId, deviceId);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error));
    }
  };

  const startCustom = async () => {
    if (!command.trim()) return;
    setOpenError('');
    try {
      await openShell(conversationId, deviceId, {
        command: command.trim(),
        args: tokenizeArgs(args),
      });
      setCommand('');
      setArgs('');
      setShowCustom(false);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error));
    }
  };

  const closeTab = async (session: TerminalSessionView, event: React.MouseEvent) => {
    event.stopPropagation();
    if (session.status === 'running') {
      await killSession(conversationId, session.sessionId).catch(() => undefined);
    }
    await removeSession(conversationId, session.sessionId).catch(() => undefined);
  };

  const placementTitle = placement
    ? `${placement.placement === 'desktop' ? t('chat.terminal.placement.desktop') : t('chat.terminal.placement.remote')} · ${placement.root || '—'}`
    : '';

  const addMenuItems = [
    {
      key: 'new-shell',
      label: (
        <span data-pt-terminal-new-shell onClick={() => void startShell()}>
          {t('chat.terminal.newShell')}
        </span>
      ),
    },
    {
      key: 'custom',
      label: (
        <span data-pt-terminal-custom-toggle onClick={() => setShowCustom((value) => !value)}>
          {t('chat.terminal.customCommand')}
        </span>
      ),
    },
  ];

  return (
    <div
      data-pt-terminal-panel
      style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: token.colorBgSpotlight,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '4px 6px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
        }}
      >
        {tabs.map((session) => {
          const selected = session.sessionId === activeSessionId;
          const dead = session.status !== 'running';
          return (
            <div
              key={session.sessionId}
              data-pt-terminal-session={session.sessionId}
              data-pt-terminal-status={session.status}
              title={placementTitle}
              onClick={() => selectSession(conversationId, session.sessionId)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 8px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                color: selected ? token.colorText : token.colorTextSecondary,
                background: selected ? token.colorFillTertiary : 'transparent',
              }}
            >
              <span data-pt-terminal-tab-name>{shellLabel(session.command)}</span>
              {dead ? <span data-pt-terminal-exit-mark>×</span> : null}
              <X
                size={12}
                data-pt-terminal-close={session.sessionId}
                onClick={(event) => void closeTab(session, event)}
                style={{ opacity: 0.55 }}
              />
            </div>
          );
        })}
        <Dropdown menu={{ items: addMenuItems }} trigger={['click']} placement="bottomLeft">
          <button
            type="button"
            aria-label={t('chat.terminal.newShell')}
            data-pt-terminal-add
            disabled={!deviceId || creating}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              border: 'none',
              borderRadius: 6,
              background: 'transparent',
              color: token.colorTextSecondary,
              cursor: 'pointer',
            }}
          >
            <Plus size={14} />
          </button>
        </Dropdown>
      </div>

      {showCustom && (
        <div
          data-pt-terminal-start-form
          style={{
            display: 'flex',
            gap: 6,
            padding: '6px 8px',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            flexShrink: 0,
          }}
        >
          <Input
            size="small"
            aria-label={t('chat.terminal.command')}
            data-pt-terminal-command
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            style={{ width: 120 }}
            placeholder={t('chat.terminal.command')}
          />
          <Input
            size="small"
            aria-label={t('chat.terminal.args')}
            data-pt-terminal-args
            value={args}
            onChange={(event) => setArgs(event.target.value)}
            style={{ flex: 1, minWidth: 0 }}
            placeholder={t('chat.terminal.args')}
          />
          <button
            type="button"
            data-pt-terminal-start
            disabled={!command.trim() || !deviceId}
            onClick={() => void startCustom()}
            style={{
              border: 'none',
              borderRadius: 6,
              padding: '0 12px',
              background: token.colorPrimary,
              color: '#fff',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {t('chat.terminal.start')}
          </button>
        </div>
      )}

      {openError && (
        <div role="alert" data-pt-terminal-error style={{ color: token.colorErrorText, fontSize: 12, padding: '6px 10px' }}>
          {t('chat.terminal.startFailed')}: {openError}
        </div>
      )}

      {activeSession ? (
        <TerminalViewer key={activeSession.sessionId} session={activeSession} />
      ) : (
        <div
          data-pt-terminal-empty
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: token.colorTextTertiary,
            fontSize: 12,
          }}
        >
          {creating ? <span data-pt-terminal-starting>{t('chat.terminal.starting')}</span> : null}
        </div>
      )}
    </div>
  );
}
