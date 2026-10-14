import { ActionIcon, Button } from '@lobehub/ui';
import { theme } from 'antd';
import { Bell, Check, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { NotificationData } from '../../services/desktop_api';
import { NotificationType } from '../../gen/proto/domain/notification/notification_pb';
import { useSocialChatStore } from '../../store/socialChat';
import { useSessionStore } from '../../store/session';
import { UserSquareAvatar } from '../common/UserSquareAvatar';

export function notificationText(item: NotificationData, t: TFunction<'layout'>): string {
  const actor = item.metadata.sender_name
    || item.metadata.actor_name
    || t('layout.notifications.person');
  const keys: Partial<Record<NotificationType, string>> = {
    [NotificationType.FRIEND_REQUEST]: 'friendRequest',
    [NotificationType.FRIEND_ACCEPTED]: 'friendAccepted',
    [NotificationType.POST_LIKED]: 'postLiked',
    [NotificationType.POST_COMMENTED]: 'postCommented',
    [NotificationType.POST_REPOSTED]: 'postReposted',
    [NotificationType.MENTIONED]: 'mentioned',
    [NotificationType.FRIEND_MESSAGE]: 'message',
    [NotificationType.GROUP_INVITED]: 'groupInvited',
    [NotificationType.CHAT_MENTIONED]: 'mentioned',
  };
  const key = keys[item.type as NotificationType];
  return key ? t(`layout.notifications.type.${key}`, { actor }) : item.title || t('layout.notifications.title');
}

export function NotificationRow({
  item, busy, onRead, onDelete, onDecision,
}: {
  item: NotificationData;
  busy: boolean;
  onRead: () => void;
  onDelete: () => void;
  onDecision: (accept: boolean) => void;
}) {
  const { t, i18n } = useTranslation('layout');
  const { token } = theme.useToken();
  const actorPtid = useSessionStore((state) => state.currentUser?.actorPtid);
  const request = useSocialChatStore((state) => state.friendRequests.find((candidate) => (
    item.type === NotificationType.FRIEND_REQUEST
    && candidate.id === item.targetId
    && candidate.senderPtid === item.actorPtid
    && candidate.receiverPtid === actorPtid
    && candidate.status === 1
  )));
  const profile = useSocialChatStore((state) => state.peerProfiles[item.actorPtid]);
  const name = profile?.display_name || profile?.username
    || item.metadata.sender_name || t('layout.notifications.person');
  const unread = item.status === 1;
  const createdAt = item.createdAt ? Date.parse(item.createdAt) : Number.NaN;
  const age = Math.max(0, Math.round((Date.now() - createdAt) / 60_000));
  const time = Number.isNaN(createdAt) ? '' : new Intl.RelativeTimeFormat(i18n.language, {
    numeric: 'auto',
  }).format(age < 60 ? -age : age < 1440 ? -Math.floor(age / 60) : -Math.floor(age / 1440),
    age < 60 ? 'minute' : age < 1440 ? 'hour' : 'day');

  return (
    <div
      data-shell-notification={item.id} data-ui-row
      style={{
        display: 'grid', gridColumn: '1 / -1', gridTemplateColumns: 'subgrid',
        alignItems: 'center', paddingBlock: 10,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        background: unread ? token.colorPrimaryBg : 'transparent',
      }}
    >
      <div style={{ gridColumn: 2 }} data-ui-column="avatar">
        {item.actorPtid ? (
          <UserSquareAvatar remoteUrl={profile?.avatar} name={name} size={34} />
        ) : <Bell size={20} color={token.colorTextSecondary} />}
      </div>
      <div data-ui-column="content" style={{ gridColumn: 3, minWidth: 0, paddingInline: 10 }}>
        <div style={{ fontSize: 13, fontWeight: unread ? 600 : 400, color: token.colorText, overflowWrap: 'anywhere' }}>
          {notificationText({ ...item, metadata: { ...item.metadata, sender_name: name } }, t)}
        </div>
        {item.body && <div style={{ fontSize: 12, color: token.colorTextSecondary, overflowWrap: 'anywhere', marginTop: 2 }}>
          {item.body}
        </div>}
        {unread && <Button type="text" size="small" disabled={busy} onClick={onRead}>
          {t('layout.notifications.markRead')}
        </Button>}
      </div>
      <time dateTime={item.createdAt || undefined} title={item.createdAt || undefined} data-ui-column="time"
        style={{ gridColumn: 4, fontSize: 11, color: token.colorTextSecondary, textAlign: 'end', paddingInlineEnd: 10 }}>
        {time}
      </time>
      <div data-ui-column="actions" style={{ gridColumn: 5, display: 'flex', justifyContent: 'flex-end', gap: 5 }}>
        {request ? <>
          <ActionIcon icon={Check} size="small" disabled={busy}
            title={t('layout.notifications.accept', { name })}
            aria-label={t('layout.notifications.accept', { name })}
            style={{ color: token.colorPrimary, background: token.colorPrimaryBg, borderRadius: 8 }}
            onClick={() => onDecision(true)} />
          <ActionIcon icon={X} size="small" disabled={busy}
            title={t('layout.notifications.decline', { name })}
            aria-label={t('layout.notifications.decline', { name })}
            onClick={() => onDecision(false)} />
        </> : <ActionIcon icon={Trash2} size="small" disabled={busy}
          title={t('layout.notifications.dismiss')} aria-label={t('layout.notifications.dismiss')} onClick={onDelete} />}
      </div>
    </div>
  );
}
