import { useEffect, useState } from 'react';
import { TerminalSquare } from 'lucide-react';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';

import { api } from '../../../../services/desktop_api';
import { useChatStore } from '../../../../store/chat';
import { useTerminalSessionsStore } from '../../../../store/terminalSessions';
import { TerminalPanel } from './TerminalPanel';

// TW-D5: viewer entry for device-held terminal sessions. Closing the panel
// only unsubscribes; the worker keeps the process alive.
export function TerminalDock() {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();
  const open = useTerminalSessionsStore((state) => state.open);
  const setOpen = useTerminalSessionsStore((state) => state.setOpen);
  const initConversation = useTerminalSessionsStore((state) => state.initConversation);
  const conversationId = useChatStore((state) => state.currentSessionKey);
  const [deviceId, setDeviceId] = useState('');

  useEffect(() => {
    void api.accountGetDeviceId().then(({ device_id }) => setDeviceId(device_id));
  }, []);

  useEffect(() => {
    if (!open || !conversationId || !deviceId) return;
    void initConversation(conversationId, deviceId).catch(() => undefined);
  }, [open, conversationId, deviceId, initConversation]);

  if (!conversationId) return null;

  return (
    <>
      <div
        data-pt-terminal-dock
        style={{ position: 'absolute', right: 14, bottom: 14, zIndex: 2 }}
      >
        <button
          type="button"
          aria-label={t('chat.terminal.dock.title')}
          title={t('chat.terminal.dock.title')}
          data-pt-terminal-toggle
          onClick={() => setOpen(!open)}
          style={{
            width: 30,
            height: 30,
            border: 0,
            borderRadius: 8,
            background: open ? token.colorPrimary : 'transparent',
            color: open ? token.colorPrimaryText : token.colorTextSecondary,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <TerminalSquare size={16} strokeWidth={1.85} />
        </button>
      </div>
      {open ? <TerminalPanel /> : null}
    </>
  );
}
