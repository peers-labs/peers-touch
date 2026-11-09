import { useEffect, useState } from 'react';

import { api } from '../../../../services/desktop_api';
import { useChatStore } from '../../../../store/chat';
import { useTerminalSessionsStore } from '../../../../store/terminalSessions';
import { useWorkbenchTabsStore } from '../../../../store/workbenchTabs';
import { TerminalPanel } from './TerminalPanel';

// TW-D5: viewer panel for device-held terminal sessions, rendered as a tab
// inside the unified WorkbenchPanel. Closing the tab only unsubscribes; the
// worker keeps the process alive.
export function TerminalDock() {
  const active = useWorkbenchTabsStore((state) => state.active === 'terminal');
  const initConversation = useTerminalSessionsStore((state) => state.initConversation);
  const ensureAutoShell = useTerminalSessionsStore((state) => state.ensureAutoShell);
  const conversationId = useChatStore((state) => state.currentSessionKey);
  const [deviceId, setDeviceId] = useState('');

  useEffect(() => {
    void api.accountGetDeviceId().then(({ device_id }) => setDeviceId(device_id));
  }, []);

  useEffect(() => {
    if (!active || !conversationId || !deviceId) return undefined;
    let cancelled = false;
    // Reconcile persisted sessions first; only when the conversation still
    // has no terminal do we auto-open an interactive shell in its resolved
    // workspace (project grant or private sandbox).
    void (async () => {
      await initConversation(conversationId, deviceId).catch(() => undefined);
      if (cancelled) return;
      await ensureAutoShell(conversationId, deviceId).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [active, conversationId, deviceId, ensureAutoShell, initConversation]);

  if (!conversationId || !active) return null;
  return <TerminalPanel />;
}
