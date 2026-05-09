import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, toast } from '@lobehub/ui';
import { Divider, Modal, theme, Tooltip, Typography } from 'antd';
import { timestampDate } from '@bufbuild/protobuf/wkt';
import {
  Ban,
  BellOff,
  ChevronRight,
  ExternalLink,
  FileText,
  Film,
  Image as ImageIcon,
  Lock,
  LogOut,
  Paperclip,
  Pin,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useSocialChatStore } from '../../store/socialChat';
import { api, type AccountProfile } from '../../services/desktop_api';
import { log } from '../../utils/logger';
import type {
  FriendChatMessage,
  FriendChatSession,
  FriendMessageAttachment,
} from '../../gen/proto/domain/chat/friend_chat_pb';
import type {
  Group,
  GroupMember,
  GroupMessage,
  GroupMessageAttachment,
} from '../../gen/proto/domain/chat/group_chat_pb';
import { readFeatureFlags } from '../../modules/settings/featureFlags';
import { SafetyVerificationPanel } from './SafetyVerificationPanel';
import { useAttachmentUrl } from './useAttachmentUrl';
import { PublicProfileCard, type PublicProfileModel } from '../profile/PublicProfileCard';

const { Text } = Typography;

type DetailActionRowProps = {
  icon: ReactNode;
  title: string;
  description: string;
  soonLabel?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
};

type SocialMessage = FriendChatMessage | GroupMessage;
type DetailAttachment = FriendMessageAttachment | GroupMessageAttachment;
type DetailAttachmentKind = 'media' | 'file';

interface DetailAttachmentItem {
  id: string;
  attachment: DetailAttachment;
  kind: DetailAttachmentKind;
  isImage: boolean;
  isVideo: boolean;
  timestampMs: number;
}

const IMAGE_FILENAME_PATTERN = /\.(apng|avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i;
const VIDEO_FILENAME_PATTERN = /\.(avi|m4v|mkv|mov|mp4|mpeg|mpg|webm)$/i;
const RECENT_MEDIA_LIMIT = 6;
const RECENT_FILE_LIMIT = 4;

type DetailActionRowProps = {
  icon: ReactNode;
  title: string;
  description: string;
  soonLabel?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
};

type SocialMessage = FriendChatMessage | GroupMessage;
type DetailAttachment = FriendMessageAttachment | GroupMessageAttachment;
type DetailAttachmentKind = 'media' | 'file';

interface DetailAttachmentItem {
  id: string;
  attachment: DetailAttachment;
  kind: DetailAttachmentKind;
  isImage: boolean;
  isVideo: boolean;
  timestampMs: number;
}

const IMAGE_FILENAME_PATTERN = /\.(apng|avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i;
const VIDEO_FILENAME_PATTERN = /\.(avi|m4v|mkv|mov|mp4|mpeg|mpg|webm)$/i;
const RECENT_MEDIA_LIMIT = 6;
const RECENT_FILE_LIMIT = 4;

function getInitial(name: string): string {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

function isImageAttachment(attachment: DetailAttachment): boolean {
  const mimeType = attachment.mimeType?.toLowerCase() ?? '';
  const filename = attachment.filename ?? '';
  return mimeType.startsWith('image/') || IMAGE_FILENAME_PATTERN.test(filename);
}

function isVideoAttachment(attachment: DetailAttachment): boolean {
  const mimeType = attachment.mimeType?.toLowerCase() ?? '';
  const filename = attachment.filename ?? '';
  return mimeType.startsWith('video/') || VIDEO_FILENAME_PATTERN.test(filename);
}

function formatAttachmentSize(size: DetailAttachment['size']): string {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getMessageTimestampMs(message: SocialMessage): number {
  const ts = message.createdAt ?? message.sentAt;
  return ts ? timestampDate(ts).getTime() : 0;
}

function getCurrentConversationAttachments(messages: SocialMessage[]): DetailAttachmentItem[] {
  const items: DetailAttachmentItem[] = [];
  messages.forEach((message, messageIndex) => {
    if (message.recalled || !message.attachments || message.attachments.length === 0) return;

    const timestampMs = getMessageTimestampMs(message);
    message.attachments.forEach((attachment, attachmentIndex) => {
      const isImage = isImageAttachment(attachment);
      const isVideo = isVideoAttachment(attachment);
      items.push({
        id: `${message.ulid || messageIndex}:${attachment.cid || attachmentIndex}`,
        attachment,
        kind: isImage || isVideo ? 'media' : 'file',
        isImage,
        isVideo,
        timestampMs,
      });
    });
  });

  return items.sort((a, b) => b.timestampMs - a.timestampMs);
}

function MemberItem({ member }: { member: GroupMember }) {
  const { token } = theme.useToken();
  const name = member.nickname || member.actorDid.slice(0, 16);
  return (
    <Flexbox horizontal align="center" gap={10} style={{ padding: '6px 0' }}>
      <Flexbox
        align="center"
        justify="center"
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          background: token.colorFillSecondary,
          color: token.colorTextSecondary,
          fontSize: 13,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {getInitial(name)}
      </Flexbox>
      <Text ellipsis style={{ fontSize: 13, flex: 1, minWidth: 0 }}>{name}</Text>
    </Flexbox>
  );
}

function DetailActionRow({
  icon,
  title,
  description,
  soonLabel,
  disabled,
  danger,
  onClick,
}: DetailActionRowProps) {
  const { token } = theme.useToken();
  const iconColor = danger ? token.colorError : token.colorPrimary;

  return (
    <Button
      type="text"
      block
      disabled={disabled}
      onClick={onClick}
      style={{
        height: 'auto',
        padding: '10px 12px',
        justifyContent: 'stretch',
        opacity: disabled ? 0.72 : 1,
      }}
    >
      <Flexbox horizontal align="center" gap={10} style={{ width: '100%', minWidth: 0 }}>
        <Flexbox
          align="center"
          justify="center"
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            background: danger ? token.colorErrorBg : token.colorFillSecondary,
            color: disabled ? token.colorTextDisabled : iconColor,
            flexShrink: 0,
          }}
        >
          {icon}
        </Flexbox>
        <Flexbox gap={2} style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <Text
            style={{
              color: disabled ? token.colorTextDisabled : danger ? token.colorError : token.colorText,
              fontSize: 13,
              fontWeight: 600,
            }}
            ellipsis
          >
            {title}
          </Text>
          <Text type="secondary" style={{ fontSize: 11 }} ellipsis>
            {description}
          </Text>
        </Flexbox>
        {soonLabel ? (
          <Text
            type="secondary"
            style={{
              padding: '2px 6px',
              borderRadius: 999,
              background: token.colorFillTertiary,
              fontSize: 11,
              flexShrink: 0,
            }}
          >
            {soonLabel}
          </Text>
        ) : (
          <ChevronRight size={15} style={{ color: token.colorTextQuaternary, flexShrink: 0 }} />
        )}
      </Flexbox>
    </Button>
  );
}

function DetailAttachmentCard({ item }: { item: DetailAttachmentItem }) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const [previewFailed, setPreviewFailed] = useState(false);
  const openUrl = useAttachmentUrl(item.attachment.cid);
  const previewCid = item.isImage
    ? (item.attachment.thumbnailCid || item.attachment.cid)
    : item.attachment.thumbnailCid;
  const previewUrl = useAttachmentUrl(previewCid);
  const filename = item.attachment.filename?.trim() || t('chat.social.detail.unnamedAttachment');
  const sizeLabel = formatAttachmentSize(item.attachment.size);
  const canOpen = Boolean(openUrl);
  const isMedia = item.kind === 'media';
  const tooltip = canOpen
    ? t('chat.social.detail.openAttachment')
    : t('chat.social.detail.attachmentUnavailable');
  const Icon = item.isImage ? ImageIcon : item.isVideo ? Film : FileText;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setPreviewFailed(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [previewUrl, item.attachment.cid]);

  const handleOpen = () => {
    if (openUrl) window.open(openUrl, '_blank');
  };

  if (isMedia) {
    return (
      <Tooltip title={tooltip}>
        <span style={{ display: 'inline-flex' }}>
          <button
            type="button"
            disabled={!canOpen}
            onClick={handleOpen}
            style={{
              appearance: 'none',
              width: 86,
              minHeight: 106,
              padding: 6,
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 14,
              background: token.colorFillQuaternary,
              color: token.colorText,
              cursor: canOpen ? 'pointer' : 'default',
              opacity: canOpen ? 1 : 0.58,
              textAlign: 'left',
            }}
          >
            <Flexbox gap={5}>
              <Flexbox
                align="center"
                justify="center"
                style={{
                  width: '100%',
                  height: 58,
                  overflow: 'hidden',
                  borderRadius: 10,
                  background: token.colorFillSecondary,
                  color: token.colorTextTertiary,
                }}
              >
                {previewUrl && !previewFailed ? (
                  <img
                    src={previewUrl}
                    alt={filename}
                    onError={() => setPreviewFailed(true)}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <Icon size={22} />
                )}
              </Flexbox>
              <Text ellipsis style={{ fontSize: 11, fontWeight: 600, maxWidth: '100%' }}>
                {filename}
              </Text>
              <Flexbox horizontal align="center" justify="space-between" gap={4}>
                <Text type="secondary" ellipsis style={{ fontSize: 10, minWidth: 0 }}>
                  {sizeLabel || t('chat.social.detail.mediaAttachment')}
                </Text>
                {canOpen ? <ExternalLink size={10} style={{ color: token.colorTextTertiary, flexShrink: 0 }} /> : null}
              </Flexbox>
            </Flexbox>
          </button>
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={tooltip}>
      <span style={{ display: 'block', width: '100%' }}>
        <button
          type="button"
          disabled={!canOpen}
          onClick={handleOpen}
          style={{
            appearance: 'none',
            width: '100%',
            padding: '8px 10px',
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 13,
            background: token.colorFillQuaternary,
            color: token.colorText,
            cursor: canOpen ? 'pointer' : 'default',
            opacity: canOpen ? 1 : 0.58,
            textAlign: 'left',
          }}
        >
          <Flexbox horizontal align="center" gap={9} style={{ minWidth: 0 }}>
            <Flexbox
              align="center"
              justify="center"
              style={{
                width: 32,
                height: 32,
                flex: '0 0 32px',
                borderRadius: 10,
                background: token.colorFillSecondary,
                color: token.colorPrimary,
              }}
            >
              <Paperclip size={16} />
            </Flexbox>
            <Flexbox gap={1} style={{ flex: 1, minWidth: 0 }}>
              <Text ellipsis style={{ fontSize: 12, fontWeight: 600 }}>
                {filename}
              </Text>
              <Text type="secondary" ellipsis style={{ fontSize: 11 }}>
                {sizeLabel || t('chat.social.detail.fileAttachment')}
              </Text>
            </Flexbox>
            {canOpen ? <ExternalLink size={13} style={{ color: token.colorTextTertiary, flexShrink: 0 }} /> : null}
          </Flexbox>
        </button>
      </span>
    </Tooltip>
  );
}

function DetailAttachmentSection({
  title,
  emptyLabel,
  items,
  limit,
}: {
  title: string;
  emptyLabel: string;
  items: DetailAttachmentItem[];
  limit: number;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const visibleItems = items.slice(0, limit);
  const hiddenCount = Math.max(items.length - visibleItems.length, 0);
  const isFileSection = visibleItems[0]?.kind === 'file';

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align="center" justify="space-between">
        <Text strong style={{ fontSize: 13 }}>{title}</Text>
        {hiddenCount > 0 ? (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('chat.social.detail.moreAttachments', { count: hiddenCount })}
          </Text>
        ) : null}
      </Flexbox>
      {visibleItems.length > 0 ? (
        <Flexbox
          horizontal={!isFileSection}
          gap={7}
          style={{
            flexWrap: isFileSection ? undefined : 'wrap',
          }}
        >
          {visibleItems.map((item) => (
            <DetailAttachmentCard key={item.id} item={item} />
          ))}
        </Flexbox>
      ) : (
        <Flexbox
          horizontal
          align="center"
          gap={8}
          style={{
            padding: '10px 11px',
            borderRadius: 13,
            border: `1px dashed ${token.colorBorderSecondary}`,
            background: token.colorFillQuaternary,
            color: token.colorTextSecondary,
          }}
        >
          <Paperclip size={14} />
          <Text type="secondary" style={{ fontSize: 12 }}>{emptyLabel}</Text>
        </Flexbox>
      )}
    </Flexbox>
  );
}

function getFriendPeerDid(session: FriendChatSession | undefined, currentUserDid: string | null): string {
  if (!session) return '';
  if (currentUserDid) {
    if (session.participantADid === currentUserDid) return session.participantBDid || '';
    if (session.participantBDid === currentUserDid) return session.participantADid || '';
  }
  return session.participantBDid || session.participantADid || '';
}

function getFriendPeerName(session: FriendChatSession | undefined, currentUserDid: string | null): string {
  if (!session) return '';
  if (currentUserDid) {
    if (session.participantADid === currentUserDid)
      return session.participantBDisplayName || session.participantBDid || '';
    if (session.participantBDid === currentUserDid)
      return session.participantADisplayName || session.participantADid || '';
  }
  return session.participantBDisplayName || session.participantBDid || '';
}

function getFriendPeerAvatar(session: FriendChatSession | undefined, currentUserDid: string | null): string {
  if (!session) return '';
  if (currentUserDid) {
    if (session.participantADid === currentUserDid) return session.participantBAvatar || '';
    if (session.participantBDid === currentUserDid) return session.participantAAvatar || '';
  }
  return session.participantBAvatar || session.participantAAvatar || '';
}

function getFriendPeerOnlineSnapshot(session: FriendChatSession | undefined, peerDid: string): boolean | null {
  if (!session || !peerDid) return null;
  if (session.participantADid === peerDid) return session.participantAOnline;
  if (session.participantBDid === peerDid) return session.participantBOnline;
  return null;
}

export function ChatDetailPanel() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const {
    activeTab, activeSessionUlid, activeGroupUlid,
    sessions, groups, groupMembers, messages,
    setShowDetail, loadGroupMembers, loadGroups, selectGroup,
  } = useSocialChatStore();
  const encryptionEnabled = useSocialChatStore((s) => s.encryptionEnabled);
  const ownFingerprint = useSocialChatStore((s) => s.ownFingerprint);
  const currentUserDid = useSocialChatStore((s) => s.currentUserDid);
  const peerOnline = useSocialChatStore((s) => s.peerOnline);
  const peerProfiles = useSocialChatStore((s) => s.peerProfiles);
  const loadPeerProfile = useSocialChatStore((s) => s.loadPeerProfile);

  const activeUlid = activeTab === 'friend' ? activeSessionUlid : activeGroupUlid;
  const isGroup = activeTab === 'group';
  const activeFriendSession = activeTab === 'friend'
    ? sessions.find((s) => s.ulid === activeUlid)
    : undefined;
  const activeGroup: Group | undefined = isGroup
    ? groups.find((g) => g.ulid === activeUlid)
    : undefined;

  // The verify section is collapsed by default — most users won't
  // open it on every glance at a chat, and the QR / fetch is
  // network-bound. Lazy mount also defers the bundle fetch.
  const [verifyOpen, setVerifyOpen] = useState(false);

  // Resolve the peer DID for friend chats. Group safety numbers
  // are an N×N problem (each pair has its own number) and we
  // intentionally defer them until the chat ratchet upgrade —
  // see docs/architecture/crypto/double-ratchet-migration.md.
  const peerDid = getFriendPeerDid(activeFriendSession, currentUserDid);
  const members: GroupMember[] = isGroup && activeUlid ? (groupMembers[activeUlid] || []) : [];
  const groupMemberCount = isGroup ? (activeGroup?.memberCount || members.length) : 0;
  const currentName = isGroup
    ? (activeGroup?.name || t('chat.social.sessionList.unnamedGroup'))
    : getFriendPeerName(activeFriendSession, currentUserDid);
  const displayName = currentName || t('chat.social.sessionList.unknown');
  const peerAvatar = getFriendPeerAvatar(activeFriendSession, currentUserDid);
  const peerPresenceSnapshot = getFriendPeerOnlineSnapshot(activeFriendSession, peerDid);
  const peerPresenceKnown = peerDid ? (peerDid in peerOnline || peerPresenceSnapshot !== null) : false;
  const peerIsOnline = peerDid in peerOnline ? peerOnline[peerDid] : peerPresenceSnapshot;
  const soonLabel = t('chat.social.detail.comingSoonBadge');
  const currentConversationAttachments = useMemo(
    () => getCurrentConversationAttachments(activeUlid ? (messages[activeUlid] || []) : []),
    [activeUlid, messages],
  );
  const mediaAttachments = currentConversationAttachments.filter((item) => item.kind === 'media');
  const fileAttachments = currentConversationAttachments.filter((item) => item.kind === 'file');

  const showComingSoon = (action: string) => {
    log.info('chat', `${action} detail action clicked`);
    toast.info(t('chat.social.detail.comingSoon'));
  };

  const actionRows: DetailActionRowProps[] = [
    {
      icon: <Search size={16} />,
      title: t('chat.social.detail.searchMessages'),
      description: t('chat.social.detail.searchMessagesDesc'),
      soonLabel,
      onClick: () => showComingSoon('Search messages'),
    },
    {
      icon: <BellOff size={16} />,
      title: t('chat.social.detail.notifications'),
      description: t('chat.social.detail.notificationsDesc'),
      soonLabel,
      disabled: true,
    },
    {
      icon: <Pin size={16} />,
      title: t('chat.social.detail.pinTop'),
      description: t('chat.social.detail.pinTopDesc'),
      soonLabel,
      disabled: true,
    },
    {
      icon: <Trash2 size={16} />,
      title: t('chat.social.detail.clearHistory'),
      description: t('chat.social.detail.clearHistoryDesc'),
      soonLabel,
      disabled: true,
      danger: true,
    },
  ];


  useEffect(() => {
    if (isGroup && activeUlid) {
      loadGroupMembers(activeUlid);
    }
  }, [isGroup, activeUlid, loadGroupMembers]);

  // Lazy peer profile load — same pattern as ChatContactsDetailPanel.
  // The cache lives in socialChat (single owner) so this effect just
  // signals the projection to fetch when a friend chat is selected.
  useEffect(() => {
    if (!isGroup && peerDid) {
      void loadPeerProfile(peerDid);
    }
  }, [isGroup, peerDid, loadPeerProfile]);

  const cachedPeerProfile = !isGroup && peerDid ? peerProfiles[peerDid] : undefined;

  const handleConfirmUpgrade = async () => {
    /*
     * M3 implementation: invoke api.cryptoSessionRefresh() (or equivalent) to tear down
     * the session and re-run X3DH so the new Double Ratchet session starts at v = 1.
     * That API does not exist yet — this handler is a QA stub when crypto.dr_enabled is on.
     */
    log.info('chat', 'Encryption upgrade requested by user', {
      sessionUlid: activeUlid,
      peerDid,
      drEnabled: true,
    });
    toast.info(t('chat.social.encryption.upgradeStubFired'));
  };

  const openEncryptionUpgradeModal = () => {
    const drEnabled = readFeatureFlags().cryptoDrEnabled;
    Modal.confirm({
      title: t('chat.social.encryption.upgradeTitle'),
      width: 480,
      content: (
        <Flexbox gap={10}>
          <Text style={{ display: 'block' }}>{t('chat.social.encryption.upgradeBody.line1')}</Text>
          <Text style={{ display: 'block' }}>{t('chat.social.encryption.upgradeBody.line2')}</Text>
          <Text style={{ display: 'block' }}>{t('chat.social.encryption.upgradeBody.line3')}</Text>
          {!drEnabled ? (
            <Text type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
              {t('chat.social.encryption.upgradeBlocked')}
            </Text>
          ) : null}
        </Flexbox>
      ),
      okText: t('chat.social.encryption.upgradeOk'),
      cancelText: t('common.action.cancel', { ns: 'common' }),
      okButtonProps: { disabled: !drEnabled },
      onOk: drEnabled ? () => handleConfirmUpgrade() : undefined,
    });
  };

  return (
    <Flexbox
      style={{
        width: 320,
        height: '100%',
        background: token.colorBgContainer,
        overflow: 'auto',
      }}
    >
      <Flexbox
        horizontal
        align="center"
        style={{
          position: 'relative',
          padding: '12px 16px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
        }}
      >
        <Text strong style={{ width: '100%', textAlign: 'center', fontSize: 15 }}>
          {t('chat.social.detail.title')}
        </Text>
        <Button
          type="text"
          icon={<X size={16} />}
          onClick={() => setShowDetail(false)}
          style={{ position: 'absolute', right: 12, width: 28, height: 28 }}
        />
      </Flexbox>

      <Flexbox style={{ padding: 16 }}>
        <PublicProfileCard
          compact
          profile={buildChatDetailProfile({
            isGroup,
            displayName,
            peerAvatar,
            peerDid,
            activeGroup,
            groupMemberCount,
            peerPresenceKnown,
            peerIsOnline,
            encryptionEnabled,
            cachedPeerProfile,
            t,
          })}
          avatarNode={isGroup ? (
            <Flexbox
              align="center"
              justify="center"
              style={{
                width: 76,
                height: 76,
                borderRadius: 18,
                background: token.colorFillSecondary,
                color: token.colorTextSecondary,
              }}
            >
              <Users size={34} />
            </Flexbox>
          ) : undefined}
        />
      </Flexbox>

      <Divider style={{ margin: '0 16px', minWidth: 'auto', width: 'auto' }} />

      {isGroup && (
        <>
          <Flexbox style={{ padding: '12px 16px' }} gap={6}>
            <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 4 }}>
              <Text strong style={{ fontSize: 13 }}>{t('chat.social.detail.members', { count: groupMemberCount })}</Text>
              <Button type="link" size="small" style={{ fontSize: 12, padding: 0 }} onClick={() => log.info('chat', 'See all members clicked')}>
                {t('chat.social.detail.seeAll')}
              </Button>
            </Flexbox>
            {members.length > 0 ? (
              members.slice(0, 6).map((m) => (
                <MemberItem key={m.actorDid} member={m} />
              ))
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('chat.social.detail.membersLoading')}
              </Text>
            )}
            <Button
              type="dashed"
              icon={<UserPlus size={14} />}
              block
              size="small"
              style={{ marginTop: 4 }}
              onClick={() => log.info('chat', 'Add member clicked')}
            >
              {t('chat.social.detail.addMember')}
            </Button>
          </Flexbox>
          <Divider style={{ margin: '0 16px', minWidth: 'auto', width: 'auto' }} />
        </>
      )}

      <Flexbox style={{ padding: '12px 16px' }} gap={12}>
        <Text strong style={{ fontSize: 13 }}>{t('chat.social.detail.sharedContent')}</Text>
        <DetailAttachmentSection
          title={t('chat.social.detail.mediaWithCount', { count: mediaAttachments.length })}
          emptyLabel={t('chat.social.detail.mediaEmpty')}
          items={mediaAttachments}
          limit={RECENT_MEDIA_LIMIT}
        />
        <DetailAttachmentSection
          title={t('chat.social.detail.filesWithCount', { count: fileAttachments.length })}
          emptyLabel={t('chat.social.detail.filesEmpty')}
          items={fileAttachments}
          limit={RECENT_FILE_LIMIT}
        />
      </Flexbox>

      <Divider style={{ margin: '0 16px', minWidth: 'auto', width: 'auto' }} />

      <Flexbox style={{ padding: '12px 16px' }} gap={8}>
        <Text strong style={{ fontSize: 13 }}>{t('chat.social.detail.actions')}</Text>
        <Flexbox
          gap={2}
          style={{
            padding: 4,
            borderRadius: 16,
            background: token.colorFillQuaternary,
            border: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {actionRows.map((action) => (
            <DetailActionRow key={action.title} {...action} />
          ))}
        </Flexbox>
      </Flexbox>

      <Divider style={{ margin: '0 16px', minWidth: 'auto', width: 'auto' }} />

      <Flexbox style={{ padding: '8px 16px 16px' }}>
        {isGroup ? (
          <Button
            type="text"
            danger
            icon={<LogOut size={16} />}
            style={{ justifyContent: 'flex-start', height: 36 }}
            block
            onClick={async () => {
              if (activeUlid) {
                try {
                  await api.groupChatLeaveGroup(activeUlid);
                  await loadGroups();
                  selectGroup('');
                  setShowDetail(false);
                } catch (e) {
                  log.error('chat', 'leave group failed', e);
                }
              }
            }}
          >
            {t('chat.social.detail.leaveGroup')}
        </Button>
      ) : (
        <Button
          type="text"
          danger
          icon={<Ban size={16} />}
          style={{ justifyContent: 'flex-start', height: 36 }}
          block
          onClick={() => log.info('chat', 'Block user clicked')}
        >
          {t('chat.social.detail.blockUser')}
          </Button>
        )}
      </Flexbox>

      {encryptionEnabled && (
        <>
          <Divider style={{ margin: '0 16px', minWidth: 'auto', width: 'auto' }} />
          <Flexbox style={{ padding: '12px 16px' }} gap={8}>
            <Flexbox horizontal align="center" gap={6}>
              <Lock size={14} style={{ color: token.colorSuccess }} />
              <Text strong style={{ fontSize: 13 }}>{t('chat.social.encryption.title')}</Text>
            </Flexbox>
            <Text type="secondary" style={{ fontSize: 11 }}>{t('chat.social.encryption.fingerprint')}</Text>
            <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {ownFingerprint || '—'}
            </Text>
            {/* Identity verification — only meaningful on friend
                chats where there is a single peer to compare
                against. Group safety numbers wait on the chat
                ratchet upgrade. */}
            {!isGroup && peerDid ? (
              <Button
                type={verifyOpen ? 'default' : 'primary'}
                ghost={!verifyOpen}
                icon={<ShieldCheck size={14} />}
                size="small"
                onClick={() => setVerifyOpen((v) => !v)}
                style={{ marginTop: 4 }}
              >
                {verifyOpen
                  ? t('chat.social.verify.hide')
                  : t('chat.social.verify.show')}
              </Button>
            ) : null}
          </Flexbox>
          {!isGroup && peerDid && verifyOpen && currentUserDid ? (
            <SafetyVerificationPanel
              localActorDid={currentUserDid}
              localFingerprint={ownFingerprint || ''}
              peerDid={peerDid}
            />
          ) : null}
          {activeTab === 'friend' ? (
            <Flexbox style={{ padding: '8px 16px 12px' }}>
              <Button
                type="text"
                icon={<Sparkles size={16} />}
                style={{ justifyContent: 'flex-start', height: 36 }}
                block
                onClick={openEncryptionUpgradeModal}
              >
                {t('chat.social.encryption.upgradeButton')}
              </Button>
            </Flexbox>
          ) : null}
        </>
      )}
    </Flexbox>
  );
}

interface BuildChatDetailProfileArgs {
  isGroup: boolean;
  displayName: string;
  peerAvatar: string;
  peerDid: string;
  activeGroup: Group | undefined;
  groupMemberCount: number;
  peerPresenceKnown: boolean;
  peerIsOnline: boolean | null | undefined;
  encryptionEnabled: boolean;
  cachedPeerProfile: AccountProfile | null | undefined;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

// Compose the profile data shown in the chat detail card from session-derived
// snapshots and the lazily-loaded Station profile. Station fields take
// precedence whenever present so freshly-edited bios/regions show through;
// the session row keeps the avatar/displayName/online state visible during
// the brief network round-trip.
function buildChatDetailProfile({
  isGroup,
  displayName,
  peerAvatar,
  peerDid,
  activeGroup,
  groupMemberCount,
  peerPresenceKnown,
  peerIsOnline,
  encryptionEnabled,
  cachedPeerProfile,
  t,
}: BuildChatDetailProfileArgs): PublicProfileModel {
  const presenceLabel = isGroup
    ? t('chat.social.detail.membersCount', { count: groupMemberCount })
    : peerPresenceKnown
      ? peerIsOnline
        ? t('chat.social.detail.online')
        : t('chat.social.detail.offline')
      : t('chat.social.detail.directMessage');
  const encryptionBadge = {
    label: encryptionEnabled
      ? t('chat.social.detail.encrypted')
      : t('chat.social.detail.notEncrypted'),
    tone: encryptionEnabled ? ('success' as const) : ('warning' as const),
  };

  if (isGroup) {
    return {
      displayName,
      did: activeGroup?.ulid,
      bio: activeGroup?.description,
      relationLabel: presenceLabel,
      relationTone: 'default',
      badges: [encryptionBadge],
      stats: [
        {
          label: t('chat.social.detail.membersLabel', { defaultValue: 'members' }),
          value: groupMemberCount,
        },
      ],
    };
  }

  const stats: { label: string; value: number }[] = [];
  if (cachedPeerProfile) {
    if (typeof cachedPeerProfile.statuses_count === 'number') {
      stats.push({
        label: t('chat.social.detail.posts', { defaultValue: 'Posts' }),
        value: cachedPeerProfile.statuses_count,
      });
    }
    if (typeof cachedPeerProfile.followers_count === 'number') {
      stats.push({
        label: t('chat.social.detail.followers', { defaultValue: 'Followers' }),
        value: cachedPeerProfile.followers_count,
      });
    }
    if (typeof cachedPeerProfile.following_count === 'number') {
      stats.push({
        label: t('chat.social.detail.following', { defaultValue: 'Following' }),
        value: cachedPeerProfile.following_count,
      });
    }
  }

  return {
    displayName: cachedPeerProfile?.display_name?.trim() || displayName,
    avatar: cachedPeerProfile?.avatar?.trim() || peerAvatar,
    header: cachedPeerProfile?.header?.trim() || undefined,
    username: cachedPeerProfile?.username?.trim() || undefined,
    bio: cachedPeerProfile?.note?.trim() || undefined,
    did: cachedPeerProfile?.id?.trim() || peerDid,
    createdAt: cachedPeerProfile?.created_at?.trim() || undefined,
    region: cachedPeerProfile?.region?.trim() || undefined,
    tags: (cachedPeerProfile?.tags ?? []).filter(Boolean),
    links: (cachedPeerProfile?.links ?? []).filter((l) => l && (l.label || l.url)),
    relationLabel: presenceLabel,
    relationTone: peerIsOnline ? 'success' : 'default',
    badges: [encryptionBadge],
    stats: stats.length > 0 ? stats : undefined,
  };
}
