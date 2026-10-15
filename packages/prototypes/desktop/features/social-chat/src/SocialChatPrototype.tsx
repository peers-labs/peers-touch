import { DesktopShell } from '@peers-touch/prototype-desktop-shell';
import { useMemo } from 'react';
import { NOTIFICATION_PROJECTION_FIXTURE } from './mock';
import { SocialChatPage } from './pages/SocialChatPage';

export function SocialChatPrototype() {
  const pages = useMemo(() => ({ chat: () => <SocialChatPage /> }), []);
  return (
    <DesktopShell
      pages={pages}
      initialPage="chat"
      initialNotifications={NOTIFICATION_PROJECTION_FIXTURE}
    />
  );
}
