import { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '@peers-touch/ui';
import '@xterm/xterm/css/xterm.css';

import { api } from '../../../../services/desktop_api';
import { useChatStore } from '../../../../store/chat';
import {
  describeTerminalPlacement,
  useTerminalSessionsStore,
  type TerminalPlacementInfo,
  type TerminalSessionView,
} from '../../../../store/terminalSessions';
import { DARK_TERMINAL_THEME, TERMINAL_FONT_FAMILY } from './terminalTheme';
import './terminal.css';

const EMPTY_SESSIONS: TerminalSessionView[] = [];

function shellLabel(command: string): string {
  const base = command.split('/').filter(Boolean).pop() ?? command;
  return base || 'shell';
}

function TerminalViewer({ session }: { session: TerminalSessionView }) {
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
    // The shell is a console surface: it always renders the dark terminal
    // palette instead of inheriting the app's light surface tokens.
    const xterm = new Terminal({
      fontSize: 13,
      scrollback: 5000,
      convertEol: true,
      cursorBlink: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      theme: DARK_TERMINAL_THEME,
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

  return <div ref={containerRef} data-pt-terminal-xterm className="wb-term__xterm" />;
}

// Zero-form work surface: opening the Terminal tab auto-starts one
// interactive shell inside the task's resolved workspace (project grant or
// sandbox). The strip only switches/closes live shells; starting a custom
// command is just typing into the shell, so no launch form is offered.
export function TerminalPanel({ autoError = '' }: { autoError?: string }) {
  const { t } = useTranslation('chat');
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
  const creating = useTerminalSessionsStore((state) => state.creating);
  const [placement, setPlacement] = useState<TerminalPlacementInfo | null>(null);

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

  return (
    <div data-pt-terminal-panel className="wb-term">
      <div className="wb-term__tabs">
        {tabs.map((session) => {
          const selected = session.sessionId === activeSessionId;
          const dead = session.status !== 'running';
          return (
            <div
              key={session.sessionId}
              className="wb-term__tab"
              data-pt-terminal-session={session.sessionId}
              data-pt-terminal-status={session.status}
              data-selected={selected}
              title={placementTitle}
            >
              <Button
                actionId={`wb.terminal.select.${session.sessionId}`}
                emphasis="quiet"
                density="compact"
                aria-current={selected ? 'page' : undefined}
                onActivate={() => selectSession(conversationId, session.sessionId)}
              >
                <span data-pt-terminal-tab-name>{shellLabel(session.command)}</span>
                {dead ? <span data-pt-terminal-exit-mark>×</span> : null}
              </Button>
              <IconButton
                actionId={`wb.terminal.close.${session.sessionId}`}
                iconId="close"
                iconSize={12}
                label={t('chat.terminal.panel.close')}
                emphasis="quiet"
                density="compact"
                data-pt-terminal-close={session.sessionId}
                onActivate={(event) => void closeTab(session, event)}
              />
            </div>
          );
        })}
      </div>

      {activeSession ? (
        <TerminalViewer key={activeSession.sessionId} session={activeSession} />
      ) : (
        <div data-pt-terminal-empty className="wb-term__empty">
          {creating ? <span data-pt-terminal-starting>{t('chat.terminal.starting')}</span> : null}
          {!creating && autoError ? (
            <span role="alert" data-pt-terminal-error className="wb-term__error">
              {t('chat.terminal.startFailed')}: {autoError}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
