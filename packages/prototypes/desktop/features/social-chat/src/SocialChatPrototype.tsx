import {
  createGroupAdmissionAdapter,
  DesktopShell,
} from '@peers-touch/prototype-desktop-shell';
import { useMemo } from 'react';
import { NOTIFICATION_PROJECTION_FIXTURE } from './mock';
import { SocialChatPage } from './pages/SocialChatPage';

export function SocialChatPrototype() {
  const groupAdmissionAdapter = useMemo(
    () => createGroupAdmissionAdapter({
      invitations: NOTIFICATION_PROJECTION_FIXTURE
        .filter(item => item.kind === 'group_invite' && item.pending)
        .map(item => ({
          invitationId: item.id,
          conversationId: 'group-release-room',
          groupName: 'Release Room',
          inviterName: item.title,
          inviterInitials: item.initials,
          inviterAvatarBackground: item.avatarBg,
          timeLabel: item.time,
          policyRevision: 1,
          state: 'pending' as const,
        })),
    }),
    [],
  );
  const pages = useMemo(
    () => ({
      chat: () => (
        <SocialChatPage groupAdmissionAdapter={groupAdmissionAdapter} />
      ),
    }),
    [groupAdmissionAdapter],
  );
  return (
    <DesktopShell
      pages={pages}
      initialPage="chat"
      initialNotifications={NOTIFICATION_PROJECTION_FIXTURE.filter(
        item => item.kind !== 'group_invite',
      )}
      groupAdmissionAdapter={groupAdmissionAdapter}
    />
  );
}
