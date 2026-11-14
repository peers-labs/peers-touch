import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  type ChatAttachmentLike,
  chatMediaKindForAttachment,
  formatChatAttachmentSize,
} from '@peers-touch/client-chat-core';
import {
  Button as PtButton,
  Dialog,
  IconButton,
  Select as PtSelect,
  Spin as PtSpin,
  Switch as PtSwitch,
  Tag as PtTag,
  TextField as PtTextField,
  TextArea as PtTextArea,
  Toggle as PtToggle,
  Tooltip as PtTooltip,
  type Tone,
} from '@peers-touch/ui';
import {
  BellOff,
  Camera,
  ExternalLink,
  FileText,
  Film,
  Image as ImageIcon,
  Lock,
  LogOut,
  Paperclip,
  Pencil,
  Pin,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { groupAvatarRemoteUrl } from '../../store/socialChat';
import {
  canonicalProfileAvatar,
} from '../../store/socialProfileProjection';
import { GroupSquareAvatar } from '../common/GroupSquareAvatar';
import {
  CHAT_BACKGROUND_OPTIONS,
  directConversationDisplayName,
  projectDesktopIMMessages,
  type DesktopIMMessageProjection,
  type FriendChatSession,
  type Group,
  type GroupMember,
} from '../../store/socialProjection';
import { formatJoinedDate } from '../profile/profileModel';
import { api, type AccountProfile } from '../../services/desktop_api';
import { log } from '../../utils/logger';
import { MemberRole } from '../../gen/proto/domain/chat/conversation_pb';
import { ChatStorageOperationState } from '../../gen/proto/domain/chat/storage_pb';
import { SafetyVerificationPanel } from './SafetyVerificationPanel';
import { useAttachmentAccess } from './useAttachmentAccess';
import { PublicProfileCard, type PublicProfileModel } from '../profile/PublicProfileCard';
import { ProfilePrimaryAction } from '../profile/ProfilePrimaryAction';
import { useProfileRelationship } from '../profile/useProfileRelationship';
import { SquareAvatar } from '../common/SquareAvatar';
import { getGroupMemberControlState } from './chatGroupPermissions';
import { presentError } from '../../services/errorPresenter';
import { mapChatError } from '../../services/errorMappings/chatErrorMapping';
import {
  useActiveChatFederationSlice,
  useActiveSocialChatSlice,
} from './useActiveSocialChatStore';
import { useSocialChatStore } from '../../store/socialChat';
import {
  messagingCommands,
} from '../../messaging/runtime';
import { setCachedOssAttachmentUrl } from '../../services/ossAttachmentUrlCache';
import { resolveFederationStationName } from '../../store/federation';
import {
  resolveConversationStationChip,
  useLocalStationConnection,
} from '../../store/stationConnection';
import {
  chatStorageProjectionRuntime,
  chatStorageReleasedBytes,
  isConversationClearProjectionCommitted,
} from '../../runtimes/chatStorageRuntime';
import { confirmRequest, notifyError, notifySuccess } from '../../ui/feedback';

// Side-sheet header band. It must match the conversation `.sc-chat-head`
// height (48px) so the two headers' bottom rules line up when the sheet opens
// beside the chat; a taller 52px band left a visible step between the panes.
const DETAIL_HEADER_HEIGHT = 48;

type DetailAttachment = ChatAttachmentLike;
type DetailAttachmentKind = 'media' | 'file';

interface DetailAttachmentItem {
  id: string;
  attachment: DetailAttachment;
  kind: DetailAttachmentKind;
  isImage: boolean;
  isVideo: boolean;
  timestampMs: number;
}

const RECENT_MEDIA_LIMIT = 6;
const RECENT_FILE_LIMIT = 4;
type GroupMemberLike = Pick<GroupMember, 'ptid' | 'nickname' | 'role' | 'muted'>;

interface GroupMemberDisplay extends GroupMemberLike {
  displayName: string;
  subtitle?: string;
  avatar?: string;
}

function getInitial(name: string): string {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

function groupRoleLabel(role: number, t: (key: string) => string): string {
  if (role >= MemberRole.OWNER) return t('chat.social.detail.roleOwner');
  if (role >= MemberRole.ADMIN) return t('chat.social.detail.roleAdmin');
  return t('chat.social.detail.roleMember');
}

function groupRoleTone(role: number): Tone {
  if (role >= MemberRole.OWNER) return 'warning';
  if (role >= MemberRole.ADMIN) return 'info';
  return 'neutral';
}

function formatReleasedBytes(value: bigint): string {
  const bytes = Number(value);
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = bytes / 1024;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[unit]}`;
}

function getCurrentConversationAttachments(messages: DesktopIMMessageProjection[]): DetailAttachmentItem[] {
  const items: DetailAttachmentItem[] = [];
  messages.forEach((message, messageIndex) => {
    if (message.recalled || !message.attachments || message.attachments.length === 0) return;

    const timestampMs = message.sentAtMs;
    message.attachments.forEach((attachment, attachmentIndex) => {
      const mediaKind = chatMediaKindForAttachment(attachment);
      const isImage = mediaKind === 'image';
      const isVideo = mediaKind === 'video';
      items.push({
        id: `${message.id || messageIndex}:${attachment.cid || attachmentIndex}`,
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

function MemberAvatar({
  member,
  size = 32,
  radius,
}: {
  member: GroupMemberDisplay;
  size?: number;
  radius?: number;
}) {
  const resolvedRadius = radius ?? Math.round(size * 0.32);
  return (
    <span
      className="sc-detail-member__avatar"
      data-chat-avatar-ptid={member.ptid}
      data-chat-avatar-src={member.avatar || ''}
      style={{
        width: size,
        height: size,
        borderRadius: resolvedRadius,
        fontSize: Math.max(12, Math.round(size * 0.36)),
      }}
    >
      <SquareAvatar
        remoteUrl={member.avatar}
        name={member.displayName}
        size={size}
        radius={resolvedRadius}
        style={{ display: 'block' }}
      >
        {getInitial(member.displayName)}
      </SquareAvatar>
    </span>
  );
}

function MemberPreviewCard({ member }: { member: GroupMemberDisplay }) {
  const { t } = useTranslation('chat');
  const role = Number(member.role ?? MemberRole.MEMBER);
  return (
    <div className="sc-detail-member__preview" data-chat-group-member={member.ptid}>
      <MemberAvatar member={member} size={38} radius={11} />
      <strong className="sc-detail-member__preview-name">{member.displayName}</strong>
      {(role >= MemberRole.ADMIN || member.muted) ? (
        <span
          className="sc-detail-member__preview-role"
          data-role={role >= MemberRole.OWNER ? 'owner' : role >= MemberRole.ADMIN ? 'admin' : 'muted'}
        >
          {member.muted ? t('chat.social.detail.memberMuted') : groupRoleLabel(role, t)}
        </span>
      ) : null}
    </div>
  );
}

function MemberItem({ member, action, lockedReason }: { member: GroupMemberDisplay; action?: ReactNode; lockedReason?: string }) {
  const { t } = useTranslation('chat');
  const role = Number(member.role ?? MemberRole.MEMBER);
  return (
    <div className="sc-detail-member-item">
      <MemberAvatar member={member} size={30} radius={9} />
      <div className="sc-detail-member-item__body">
        <strong>{member.displayName}</strong>
        <span className="sc-detail-member-item__tags">
          {member.subtitle ? (
            <span className="sc-detail-member-item__subtitle">{member.subtitle}</span>
          ) : null}
          {role >= MemberRole.ADMIN ? (
            <PtTag className="sc-detail-member-item__role">{groupRoleLabel(role, t)}</PtTag>
          ) : null}
          {member.muted ? (
            <PtTag tone="warning">{t('chat.social.detail.memberMuted')}</PtTag>
          ) : null}
        </span>
      </div>
      {!action && lockedReason ? (
        <PtTooltip label={lockedReason}>
          <Lock size={13} className="sc-detail-member-item__lock" />
        </PtTooltip>
      ) : null}
      {action ? (
        <span className="sc-detail-member-item__actions">{action}</span>
      ) : null}
    </div>
  );
}

function DetailSection({ title, children, relaxed = false }: { title?: string; children: ReactNode; relaxed?: boolean }) {
  return (
    <div className={relaxed ? 'sc-detail-section sc-detail-section--relaxed' : 'sc-detail-section'}>
      {title && (
        <div className="sc-detail-section__title">{title}</div>
      )}
      <div className="sc-detail-section__card">
        {children}
      </div>
    </div>
  );
}

function Toggle({
  action,
  checked,
  disabled = false,
  onChange,
}: {
  action: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <PtSwitch
      className="sc-detail-switch"
      data-chat-conversation-action={action}
      data-chat-conversation-action-state={checked ? 'on' : 'off'}
      checked={checked}
      disabled={disabled}
      aria-busy={disabled}
      onCheckedChange={onChange}
    />
  );
}

function DetailAttachmentCard({ item }: { item: DetailAttachmentItem }) {
  const { t } = useTranslation('chat');
  const [previewFailed, setPreviewFailed] = useState(false);
  const { src: openUrl, openState, open: handleOpen } = useAttachmentAccess(
    item.attachment,
    item.kind === 'media',
  );
  const previewUrl = item.isImage && openUrl ? `${openUrl}?representation=preview` : undefined;
  const filename = item.attachment.filename?.trim() || t('chat.social.detail.unnamedAttachment');
  const sizeLabel = formatChatAttachmentSize(item.attachment.size);
  const hasAttachmentIdentity = Boolean(
    (item.attachment as DetailAttachment & { attachmentId?: string }).attachmentId
      || item.attachment.cid?.startsWith('messaging:'),
  );
  const canOpen = hasAttachmentIdentity;
  const isMedia = item.kind === 'media';
  const openStateLabel = openState === 'pending'
    ? t('chat.social.messageArea.attachmentStateDownloading')
    : openState === 'error'
      ? t('chat.social.messageArea.attachmentDownloadFailed')
      : '';
  const tooltip = openStateLabel || (
    hasAttachmentIdentity
      ? t('chat.social.detail.openAttachment')
      : t('chat.social.detail.attachmentUnavailable')
  );
  const Glyph = item.isImage ? ImageIcon : item.isVideo ? Film : FileText;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setPreviewFailed(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [previewUrl, item.attachment.cid]);

  if (isMedia) {
    return (
      <PtTooltip label={tooltip}>
        <button
          className="sc-detail-attachment sc-detail-attachment--media"
          data-chat-detail-attachment={item.id}
          data-chat-detail-attachment-kind={item.kind}
          data-chat-detail-attachment-open-state={openState}
          aria-busy={openState === 'pending'}
          type="button"
          disabled={!canOpen}
          onClick={handleOpen}
        >
          <span className="sc-detail-attachment__thumb">
            {previewUrl && !previewFailed ? (
              <img
                src={previewUrl}
                alt={filename}
                onError={() => setPreviewFailed(true)}
              />
            ) : (
              <Glyph size={22} />
            )}
          </span>
          <strong className="sc-detail-attachment__name">{filename}</strong>
          {openStateLabel ? (
            <span className={`sc-detail-attachment__state${openState === 'error' ? ' is-error' : ''}`}>
              {openStateLabel}
            </span>
          ) : null}
          <span className="sc-detail-attachment__line">
            <span className="sc-detail-attachment__meta">
              {sizeLabel || t('chat.social.detail.mediaAttachment')}
            </span>
            {canOpen ? <ExternalLink size={10} /> : null}
          </span>
        </button>
      </PtTooltip>
    );
  }

  return (
    <PtTooltip label={tooltip}>
      <button
        className="sc-detail-attachment sc-detail-attachment--file"
        data-chat-detail-attachment={item.id}
        data-chat-detail-attachment-kind={item.kind}
        data-chat-detail-attachment-open-state={openState}
        aria-busy={openState === 'pending'}
        type="button"
        disabled={!canOpen}
        onClick={handleOpen}
      >
        <span className="sc-detail-attachment__file-glyph">
          <Paperclip size={16} />
        </span>
        <span className="sc-detail-attachment__file-body">
          <strong className="sc-detail-attachment__name">{filename}</strong>
          <span className="sc-detail-attachment__meta">
            {openStateLabel || sizeLabel || t('chat.social.detail.fileAttachment')}
          </span>
        </span>
        {canOpen ? <ExternalLink size={13} /> : null}
      </button>
    </PtTooltip>
  );
}

function DetailAttachmentSection({
  kind,
  title,
  emptyLabel,
  items,
  limit,
}: {
  kind: 'media' | 'files';
  title: string;
  emptyLabel: string;
  items: DetailAttachmentItem[];
  limit: number;
}) {
  const { t } = useTranslation('chat');
  const visibleItems = items.slice(0, limit);
  const hiddenCount = Math.max(items.length - visibleItems.length, 0);
  const isFileSection = visibleItems[0]?.kind === 'file';

  return (
    <div className="sc-detail-attachments" data-chat-detail-attachments={kind} data-chat-detail-attachment-count={items.length}>
      <div className="sc-detail-attachments__head">
        <strong>{title}</strong>
        {hiddenCount > 0 ? (
          <span>{t('chat.social.detail.moreAttachments', { count: hiddenCount })}</span>
        ) : null}
      </div>
      {visibleItems.length > 0 ? (
        <div className={`sc-detail-attachments__grid${isFileSection ? ' is-files' : ''}`}>
          {visibleItems.map((item) => (
            <DetailAttachmentCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="sc-detail-attachments__empty">
          <Paperclip size={14} />
          <span>{emptyLabel}</span>
        </div>
      )}
    </div>
  );
}

function getFriendPeerDid(session: FriendChatSession | undefined, currentUserPtid: string | null): string {
  if (!session) return '';
  if (currentUserPtid) {
    if (session.participantAPtid === currentUserPtid) return session.participantBPtid || '';
    if (session.participantBPtid === currentUserPtid) return session.participantAPtid || '';
  }
  return session.participantBPtid || session.participantAPtid || '';
}

function getFriendPeerName(session: FriendChatSession | undefined, currentUserPtid: string | null): string {
  if (!session) return '';
  if (currentUserPtid) {
    if (session.participantAPtid === currentUserPtid)
      return session.participantBDisplayName || '';
    if (session.participantBPtid === currentUserPtid)
      return session.participantADisplayName || '';
  }
  return session.participantBDisplayName || session.participantADisplayName || '';
}

function getFriendPeerAvatar(session: FriendChatSession | undefined, currentUserPtid: string | null): string {
  if (!session) return '';
  if (currentUserPtid) {
    if (session.participantAPtid === currentUserPtid)
      return session.participantBAvatar || '';
    if (session.participantBPtid === currentUserPtid)
      return session.participantAAvatar || '';
  }
  return session.participantBAvatar || session.participantAAvatar || '';
}

function getFriendPeerDisplayProfile(session: FriendChatSession | undefined, currentUserPtid: string | null) {
  if (!session) return undefined;
  const did = getFriendPeerDid(session, currentUserPtid);
  const name = getFriendPeerName(session, currentUserPtid);
  const avatar = getFriendPeerAvatar(session, currentUserPtid);
  if (!did || !name) return undefined;
  return { did, name, avatar };
}

export function ChatDetailPanel() {
  const { t } = useTranslation('chat');
  const {
    activeTab, activeSessionUlid, activeGroupUlid,
    sessions, groups, groupMembers,
    setShowDetail, selectGroup, loadSessions, loadGroupMembers, loadMessages,
    loadConversationPreviews, clearConversationProjection,
    conversationLocalState, updateConversationLocalState,
    setConversationBackgroundPreview,
    setConversationAvatarPreview,
    getIMConversations,
    messages,
    encryptionEnabled,
    ownFingerprint,
    currentUserPtid,
    currentUserProfile,
    peerOnline,
    peerProfiles,
    loadPeerProfile,
    setGroupSecurityState,
  } = useActiveSocialChatSlice((s) => ({
    activeTab: s.activeTab,
    activeSessionUlid: s.activeSessionUlid,
    activeGroupUlid: s.activeGroupUlid,
    sessions: s.sessions,
    groups: s.groups,
    groupMembers: s.groupMembers,
    setShowDetail: s.setShowDetail,
    selectGroup: s.selectGroup,
    loadSessions: s.loadSessions,
    loadGroupMembers: s.loadGroupMembers,
    loadMessages: s.loadMessages,
    loadConversationPreviews: s.loadConversationPreviews,
    clearConversationProjection: s.clearConversationProjection,
    conversationLocalState: s.conversationLocalState,
    updateConversationLocalState: s.updateConversationLocalState,
    setConversationBackgroundPreview: s.setConversationBackgroundPreview,
    setConversationAvatarPreview: s.setConversationAvatarPreview,
    getIMConversations: s.getIMConversations,
    messages: s.messages,
    encryptionEnabled: s.encryptionEnabled,
    ownFingerprint: s.ownFingerprint,
    currentUserPtid: s.currentUserPtid,
    currentUserProfile: s.currentUserProfile,
    peerOnline: s.peerOnline,
    peerProfiles: s.peerProfiles,
    loadPeerProfile: s.loadPeerProfile,
    setGroupSecurityState: s.setGroupSecurityState,
  }));
  const actorStationEntries = useActiveChatFederationSlice(
    (state) => state.actorStationEntries,
  );

  const activeUlid = activeTab === 'friend' ? activeSessionUlid : activeGroupUlid;
  const isGroup = activeTab === 'group';
  // Bots are Station-resident actors; the authority-station availability row
  // is meaningless (and renders as an error) for their conversations.
  const isAutomatedConversation = useSocialChatStore((s) => (
    activeTab === 'friend' && activeUlid ? s.isAutomatedConversation(activeUlid) : false
  ));
  const activeConversation = activeUlid
    ? getIMConversations().find((conversation) => conversation.kind === activeTab && conversation.id === activeUlid)
    : undefined;
  // Self-direct (Saved Messages): the authenticated profile is already in
  // memory, so no peer fetch; presence and safety-number UI are hidden.
  const isSelfDirect = !isGroup && activeConversation?.selfDirect === true;
  const activeFriendSession = activeTab === 'friend'
    ? sessions.find((s) => s.ulid === activeUlid)
    : undefined;
  const activeGroup: Group | undefined = isGroup
    ? groups.find((g) => g.ulid === activeUlid)
    : undefined;
  // The active conversation projection already carries the optimistic local
  // avatar preview while an upload is in flight, so prefer it.
  const groupAvatarUrl = activeConversation?.avatar
    || groupAvatarRemoteUrl(activeGroup);
  const authorityStationId = activeConversation?.authorityStationId?.trim() || '';
  const localStation = useLocalStationConnection();
  const authorityStationName = resolveFederationStationName({
    actorPtid: activeConversation?.peerPtid,
    stationPeerId: authorityStationId,
    actorStationEntries,
  });
  // Keep parity with the header chip: automated conversations already express
  // Station residency through the profile card, never a second station badge.
  const stationChip = activeConversation && !isAutomatedConversation
    ? resolveConversationStationChip({
      kind: isGroup ? 'group' : 'friend',
      authorityStationId,
      authorityStationName,
      localStation,
    })
    : null;

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [memberManagerOpen, setMemberManagerOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [backgroundModalOpen, setBackgroundModalOpen] = useState(false);
  const [inviteDids, setInviteDids] = useState<string[]>([]);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [groupAvatarUploading, setGroupAvatarUploading] = useState(false);
  const [editingMyNickname, setEditingMyNickname] = useState(false);
  const [editMyNicknameValue, setEditMyNicknameValue] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [editDescriptionValue, setEditDescriptionValue] = useState('');
  const [descriptionSaving, setDescriptionSaving] = useState(false);
  const [editingRemark, setEditingRemark] = useState(false);
  const [editRemarkValue, setEditRemarkValue] = useState('');
  const [historyActionPending, setHistoryActionPending] = useState(false);
  const [conversationActionPending, setConversationActionPending] = useState<string | null>(null);
  const [backgroundRetryPath, setBackgroundRetryPath] = useState<string | null>(null);

  const peerPtid = !isGroup
    ? activeConversation?.peerPtid || getFriendPeerDid(activeFriendSession, currentUserPtid)
    : '';
  // Inside the conversation the Message action would be redundant; the card
  // still shows Add/Accept for strangers and Manage for self-direct.
  const profileRelationshipKind = useProfileRelationship(isGroup ? '' : peerPtid);
  const members: GroupMember[] = isGroup && activeUlid ? (groupMembers[activeUlid] || []) : [];
  const myGroupMember = currentUserPtid ? members.find((member) => member.ptid === currentUserPtid) : undefined;
  const myGroupNickname = myGroupMember?.nickname?.trim() || '';
  const memberProfiles = useMemo(() => {
    const profiles = new Map<string, { name: string; avatar: string }>();
    if (currentUserPtid) {
      profiles.set(currentUserPtid, {
        name: currentUserProfile?.displayName?.trim() || currentUserProfile?.username?.trim() || '',
        avatar: currentUserProfile?.avatar || '',
      });
    }
    sessions.forEach((session) => {
      const peerProfile = getFriendPeerDisplayProfile(session, currentUserPtid);
      if (peerProfile?.did && peerProfile.name) {
        profiles.set(peerProfile.did, { name: peerProfile.name, avatar: peerProfile.avatar });
      }
    });
    for (const [did, profile] of Object.entries(peerProfiles)) {
      if (profile && !profiles.has(did)) {
        profiles.set(did, {
          name: profile.display_name?.trim() || profile.username?.trim() || '',
          avatar: canonicalProfileAvatar(profile),
        });
      }
    }
    return profiles;
  }, [currentUserPtid, currentUserProfile, sessions, peerProfiles]);
  const displayMembers: GroupMemberDisplay[] = useMemo(() => {
    const sourceMembers: GroupMemberLike[] = members.length > 0
      ? members
      : activeGroup?.ownerPtid
        ? [{
            ptid: activeGroup.ownerPtid,
            nickname: '',
            role: MemberRole.OWNER,
            muted: false,
          }]
        : [];
    return sourceMembers.map((member) => {
      const nickname = member.nickname?.trim() || '';
      const profile = memberProfiles.get(member.ptid);
      const profileName = profile?.name?.trim() || '';
      const displayName = nickname || profileName || t('chat.social.detail.unknownMember');
      return {
        ...member,
        displayName,
        subtitle: nickname && profileName && nickname !== profileName ? profileName : undefined,
        avatar: profile?.avatar || '',
      };
    });
  }, [activeGroup?.ownerPtid, memberProfiles, members, t]);
  const memberDisplayByDid = useMemo(
    () => new Map(displayMembers.map((member) => [member.ptid, member])),
    [displayMembers],
  );
  const getMemberDisplayName = (member: GroupMember): string =>
    memberDisplayByDid.get(member.ptid)?.displayName
    || member.nickname?.trim()
    || t('chat.social.detail.unknownMember');
  const memberPtidSet = useMemo(() => new Set(members.map((member) => member.ptid)), [members]);
  const inviteCandidates = useMemo(
    () => sessions
      .map((session) => ({
        did: getFriendPeerDid(session, currentUserPtid),
        name: getFriendPeerName(session, currentUserPtid)
          || t('chat.social.detail.unknownMember'),
      }))
      .filter((candidate): candidate is { did: string; name: string } =>
        Boolean(candidate.did && !memberPtidSet.has(candidate.did)),
      ),
    [currentUserPtid, memberPtidSet, sessions, t],
  );
  const groupMemberCount = isGroup ? (activeConversation?.memberCount || activeGroup?.memberCount || members.length) : 0;
  const myMemberRole = activeGroup?.ownerPtid === currentUserPtid ? MemberRole.OWNER : Number(myGroupMember?.role ?? 0);
  const canManageGroupMembers = Boolean(
    activeGroup?.ownerPtid === currentUserPtid ||
    myMemberRole >= MemberRole.ADMIN,
  );
  const isGroupOwner = isGroup && myMemberRole === MemberRole.OWNER;
  const myMemberRoleLabel = groupRoleLabel(myMemberRole, t);
  const groupPermissionTitle = isGroupOwner
    ? t('chat.social.detail.permissionOwnerTitle')
    : myMemberRole >= MemberRole.ADMIN
      ? t('chat.social.detail.permissionAdminTitle')
      : t('chat.social.detail.permissionMemberTitle');
  const groupPermissionBody = isGroupOwner
    ? t('chat.social.detail.permissionOwnerBody')
    : myMemberRole >= MemberRole.ADMIN
      ? t('chat.social.detail.permissionAdminBody')
      : t('chat.social.detail.permissionMemberBody');
  const currentName = isGroup
    ? (activeConversation?.title || activeGroup?.name || t('chat.social.sessionList.unnamedGroup'))
    : directConversationDisplayName(
      activeConversation ?? { title: '' },
      t('chat.social.contacts.savedMessages'),
      getFriendPeerName(activeFriendSession, currentUserPtid),
    );
  const displayName = currentName || t('chat.social.sessionList.unknown');
  const peerAvatar = activeConversation?.avatar || getFriendPeerAvatar(activeFriendSession, currentUserPtid);
  const peerPresenceKnown = peerPtid ? peerPtid in peerOnline : false;
  const peerIsOnline = peerPtid in peerOnline ? peerOnline[peerPtid] : null;
  const localStateKey = activeUlid ? `${activeTab}:${activeUlid}` : '';
  const activeLocalState = localStateKey ? conversationLocalState[localStateKey] : undefined;
  const activeMessages = useMemo(
    () => (
      activeUlid
        ? projectDesktopIMMessages(activeTab, activeUlid, messages[activeUlid] ?? [])
        : []
    ),
    [activeTab, activeUlid, messages],
  );
  const { mediaAttachments, fileAttachments } = useMemo(() => {
    const attachments = getCurrentConversationAttachments(activeMessages);
    return {
      mediaAttachments: attachments.filter((item) => item.kind === 'media'),
      fileAttachments: attachments.filter((item) => item.kind === 'file'),
    };
  }, [activeMessages]);

  const runConversationAction = async (
    action: string,
    patch: Parameters<typeof updateConversationLocalState>[2],
  ): Promise<boolean> => {
    if (!activeUlid || conversationActionPending) return false;
    setConversationActionPending(action);
    try {
      await updateConversationLocalState(activeTab, activeUlid, patch);
      return true;
    } catch (error) {
      log.error('chat', 'conversation action failed', {
        action,
        kind: activeTab,
        ulid: activeUlid,
        error,
      });
      presentError(error, {
        mapper: mapChatError,
        context: { operation: 'conversationAction' },
      });
      return false;
    } finally {
      setConversationActionPending(null);
    }
  };

  const clearConversationData = async () => {
    if (!activeUlid) return;
    setHistoryActionPending(true);
    try {
      const result = await chatStorageProjectionRuntime.clearConversation(activeUlid);
      const projectionCommitted = isConversationClearProjectionCommitted(result);
      if (projectionCommitted) {
        clearConversationProjection(activeUlid);
        const refreshResults = await Promise.allSettled([
          loadMessages(activeUlid, activeTab),
          loadConversationPreviews(),
        ]);
        if (refreshResults.some((result) => result.status === 'rejected')) {
          log.warn('chat', 'conversation history committed; projection refresh deferred', {
            kind: activeTab,
            ulid: activeUlid,
          });
        }
      }
      if (
        !result
        || !projectionCommitted
        || result.error
        || result.operation?.state !== ChatStorageOperationState.SUCCEEDED
      ) {
        throw new Error(result?.error?.message || 'chat conversation cleanup did not complete');
      }
      notifySuccess(t('chat.social.detail.clearHistorySuccess', {
        bytes: formatReleasedBytes(chatStorageReleasedBytes(result) ?? 0n),
      }));
    } catch (error) {
      log.error('chat', 'conversation history action failed', {
        kind: activeTab,
        ulid: activeUlid,
        error,
      });
      presentError(error, {
        mapper: mapChatError,
        context: { operation: 'conversationAction' },
      });
    } finally {
      setHistoryActionPending(false);
    }
  };

  const handleSaveGroupName = async () => {
    // Closing the editor on blur/Escape must never hit the wire: compare
    // against the canonical server name (not a local remark), and cancel
    // silently when the value is empty or unchanged.
    const next = editNameValue.trim();
    setEditingName(false);
    if (!activeUlid || !next) return;
    if (next === (activeConversation?.canonicalName || currentName).trim()) return;
    try {
      await messagingCommands.updateConversation(activeUlid, {
        name: next,
      });
      await loadSessions();
      notifySuccess(t('chat.social.detail.groupNameUpdated'));
    } catch (error) {
      log.error('chat', 'update group name failed', { groupUlid: activeUlid, error });
      notifyError(t('chat.social.detail.groupNameUpdateFailed'));
    }
  };

  const handleSaveMyNickname = async () => {
    if (!activeUlid) {
      setEditingMyNickname(false);
      return;
    }
    const nextNickname = editMyNicknameValue.trim();
    setEditingMyNickname(false);
    // Unchanged open-and-close is a cancel, not a member-settings write.
    if (nextNickname === myGroupNickname) return;
    try {
      await messagingCommands.updateMemberSettings(activeUlid, {
        nickname: nextNickname,
      });
      await loadGroupMembers(activeUlid);
      notifySuccess(t('chat.social.detail.myNicknameUpdated'));
    } catch (error) {
      log.error('chat', 'update group nickname failed', { groupUlid: activeUlid, error });
      notifyError(t('chat.social.detail.myNicknameUpdateFailed'));
    }
  };

  const startDescriptionEdit = () => {
    setEditDescriptionValue(activeConversation?.description?.trim() || '');
    setEditingDescription(true);
  };

  const handleSaveDescription = async () => {
    const next = editDescriptionValue.trim();
    setEditingDescription(false);
    if (!activeUlid || !canManageGroupMembers) return;
    if (next === (activeConversation?.description || '').trim()) return;
    setDescriptionSaving(true);
    try {
      await messagingCommands.updateConversation(activeUlid, { description: next });
      await loadSessions();
      notifySuccess(t('chat.social.detail.groupDescriptionUpdated'));
    } catch (error) {
      log.error('chat', 'update group description failed', { groupUlid: activeUlid, error });
      notifyError(t('chat.social.detail.groupDescriptionUpdateFailed'));
    } finally {
      setDescriptionSaving(false);
    }
  };

  const startRemarkEdit = () => {
    setEditRemarkValue(activeLocalState?.remark?.trim() || '');
    setEditingRemark(true);
  };

  const handleSaveRemark = async () => {
    const next = editRemarkValue.trim();
    setEditingRemark(false);
    if (!activeUlid) return;
    if (next === (activeLocalState?.remark || '').trim()) return;
    try {
      await updateConversationLocalState(activeTab, activeUlid, {
        remark: next || undefined,
      });
    } catch (error) {
      log.error('chat', 'save group remark failed', { groupUlid: activeUlid, error });
      notifyError(t('chat.social.detail.groupRemarkUpdateFailed'));
    }
  };

  const handleGroupAvatarClick = async () => {
    if (!activeUlid || groupAvatarUploading) return;
    let filePath: string;
    try {
      filePath = await api.pickImageFile();
    } catch {
      return;
    }
    // Show the picked image immediately; upload and server commit continue
    // in the background, matching profile avatar/header behavior.
    const previewUrl = convertFileSrc(filePath);
    setGroupAvatarUploading(true);
    setConversationAvatarPreview('group', activeUlid, previewUrl);
    try {
      const uploaded = await api.ossUploadAttachmentSocial(filePath);
      const avatarPath = `/sub-oss/file?key=${encodeURIComponent(uploaded.key)}`;
      await messagingCommands.updateConversation(activeUlid, {
        avatarObjectId: avatarPath,
      });
      await loadSessions();
      // Warm the committed remote URL before dropping the local preview so
      // the swap does not flash to a cold download.
      await new Promise((resolve) => {
        const image = new Image();
        image.onload = resolve;
        image.onerror = resolve;
        image.src = avatarPath;
      });
      setConversationAvatarPreview('group', activeUlid, null);
      notifySuccess(t('chat.social.detail.groupAvatarUpdated'));
    } catch (error) {
      setConversationAvatarPreview('group', activeUlid, null);
      log.error('chat', 'update group avatar failed', { groupUlid: activeUlid, error });
      notifyError(t('chat.social.detail.groupAvatarUpdateFailed'));
    } finally {
      setGroupAvatarUploading(false);
    }
  };

  const handleUploadBackgroundImage = async (filePath: string, previewUrl: string) => {
    if (!activeUlid) return;
    if (conversationActionPending) return;
    setConversationBackgroundPreview(activeTab, activeUlid, previewUrl);
    setBackgroundRetryPath(filePath);
    setConversationActionPending('background-image');
    try {
      const uploaded = await api.ossUploadLocalFile({
        file_path: filePath,
        bucket: 'personal',
        visibility: 'private',
        chat_session_id: null,
      });
      setCachedOssAttachmentUrl(uploaded.cid, { src: previewUrl });
      await updateConversationLocalState(activeTab, activeUlid, { backgroundImage: uploaded.cid });
      setConversationBackgroundPreview(activeTab, activeUlid, null);
      setBackgroundRetryPath(null);
      setBackgroundModalOpen(false);
      notifySuccess(t('chat.social.detail.backgroundImageUpdated'));
    } catch (error) {
      setConversationBackgroundPreview(activeTab, activeUlid, null);
      log.error('chat', 'update chat background image failed', { kind: activeTab, ulid: activeUlid, error });
      presentError(error, {
        mapper: mapChatError,
        context: { operation: 'conversationAction' },
      });
    } finally {
      setConversationActionPending(null);
    }
  };

  const handleSelectBackgroundImage = async () => {
    if (conversationActionPending) return;
    let filePath: string;
    try {
      filePath = await api.pickImageFile();
    } catch {
      return;
    }
    const previewUrl = convertFileSrc(filePath);
    void handleUploadBackgroundImage(filePath, previewUrl);
  };

  const confirmClearHistory = async () => {
    const confirmed = await confirmRequest({
      title: t('chat.social.detail.clearHistoryConfirmTitle'),
      description: t('chat.social.detail.clearHistoryConfirmBody'),
      confirmLabel: t('chat.social.detail.clearHistory'),
      cancelLabel: t('chat.social.messageArea.cancel'),
      tone: 'danger',
    });
    if (confirmed) await clearConversationData();
  };

  const submitGroupInvites = async () => {
    if (!activeUlid || inviteDids.length === 0) return;
    setInviteSubmitting(true);
    const pendingDids = [...inviteDids];
    try {
      setGroupSecurityState(activeUlid, 'establishing');
      for (const did of pendingDids) {
        await messagingCommands.submitMembershipIntent({
          conversationId: activeUlid,
          action: 'add_actor',
          targetPtid: did,
        });
      }
      await loadSessions();
      setInviteDids([]);
      setInviteModalOpen(false);
      notifySuccess(t('chat.social.detail.addMemberSuccess'));
    } catch (error) {
      setGroupSecurityState(activeUlid, 'error');
      log.error('chat', 'invite group members failed', { groupUlid: activeUlid, inviteeCount: inviteDids.length, error });
      notifyError(t('chat.social.detail.addMemberFailed'));
      throw error;
    } finally {
      setInviteSubmitting(false);
    }
  };

  const confirmRemoveGroupMember = async (member: GroupMember) => {
    if (!activeUlid || !member.ptid) return;
    const memberName = getMemberDisplayName(member);
    const confirmed = await confirmRequest({
      title: t('chat.social.detail.removeMemberConfirmTitle'),
      description: t('chat.social.detail.removeMemberConfirmBody', { name: memberName }),
      confirmLabel: t('chat.social.detail.removeMember'),
      cancelLabel: t('chat.social.messageArea.cancel'),
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      setGroupSecurityState(activeUlid, 'establishing');
      await messagingCommands.submitMembershipIntent({
        conversationId: activeUlid,
        action: 'remove_actor',
        targetPtid: member.ptid,
      });
      await loadSessions();
      notifySuccess(t('chat.social.detail.removeMemberSuccess'));
    } catch (error) {
      setGroupSecurityState(activeUlid, 'error');
      log.error('chat', 'remove group member failed', { groupUlid: activeUlid, ptid: member.ptid, error });
      notifyError(t('chat.social.detail.removeMemberFailed'));
      throw error;
    }
  };

  const updateGroupMember = async (member: GroupMember, input: { role?: number; muted?: boolean }) => {
    if (!activeUlid || !member.ptid) return;
    try {
      await messagingCommands.updateMemberAuthority(activeUlid, member.ptid, input);
      await loadGroupMembers(activeUlid);
      notifySuccess(t('chat.social.detail.updateMemberSuccess'));
    } catch (error) {
      log.error('chat', 'update group member failed', { groupUlid: activeUlid, ptid: member.ptid, input, error });
      notifyError(t('chat.social.detail.updateMemberFailed'));
      throw error;
    }
  };

  const confirmUpdateGroupMemberRole = async (member: GroupMember, role: number) => {
    const memberName = getMemberDisplayName(member);
    const confirmed = await confirmRequest({
      title: role === MemberRole.ADMIN ? t('chat.social.detail.promoteAdminConfirmTitle') : t('chat.social.detail.demoteAdminConfirmTitle'),
      description: role === MemberRole.ADMIN
        ? t('chat.social.detail.promoteAdminConfirmBody', { name: memberName })
        : t('chat.social.detail.demoteAdminConfirmBody', { name: memberName }),
      confirmLabel: role === MemberRole.ADMIN ? t('chat.social.detail.promoteAdmin') : t('chat.social.detail.demoteAdmin'),
      cancelLabel: t('chat.social.messageArea.cancel'),
    });
    if (confirmed) await updateGroupMember(member, { role });
  };

  const toggleGroupMemberMuted = (member: GroupMember) => {
    void updateGroupMember(member, { muted: !member.muted });
  };

  const confirmTransferGroupOwnership = async (member: GroupMember) => {
    if (!activeUlid || !member.ptid) return;
    const memberName = getMemberDisplayName(member);
    const confirmed = await confirmRequest({
      title: t('chat.social.detail.transferOwnerConfirmTitle'),
      description: t('chat.social.detail.transferOwnerConfirmBody', { name: memberName }),
      confirmLabel: t('chat.social.detail.transferOwner'),
      cancelLabel: t('chat.social.messageArea.cancel'),
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await messagingCommands.transferOwnership(activeUlid, member.ptid);
      await Promise.allSettled([loadGroupMembers(activeUlid), loadSessions()]);
      notifySuccess(t('chat.social.detail.transferOwnerSuccess'));
    } catch (error) {
      log.error('chat', 'transfer group ownership failed', { groupUlid: activeUlid, nextOwnerPtid: member.ptid, error });
      notifyError(t('chat.social.detail.transferOwnerFailed'));
      throw error;
    }
  };

  const confirmLeaveGroup = async () => {
    if (!activeUlid) return;
    const confirmed = await confirmRequest({
      title: t('chat.social.detail.leaveGroupConfirmTitle'),
      description: t('chat.social.detail.leaveGroupConfirmBody'),
      confirmLabel: t('chat.social.detail.leaveGroup'),
      cancelLabel: t('chat.social.messageArea.cancel'),
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await messagingCommands.leaveConversation(activeUlid);
      setGroupSecurityState(activeUlid, 'establishing');
      setShowDetail(false);
    } catch (error) {
      log.error('chat', 'leave group failed', { groupUlid: activeUlid, error });
      notifyError(t('chat.social.detail.leaveGroupFailed'));
      throw error;
    }
  };

  const confirmDissolveGroup = async () => {
    if (!activeUlid) return;
    const confirmed = await confirmRequest({
      title: t('chat.social.detail.dissolveGroupConfirmTitle'),
      description: t('chat.social.detail.dissolveGroupConfirmBody'),
      confirmLabel: t('chat.social.detail.dissolveGroup'),
      cancelLabel: t('chat.social.messageArea.cancel'),
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await messagingCommands.dissolveConversation(activeUlid);
      await loadSessions();
      selectGroup('');
      setShowDetail(false);
      notifySuccess(t('chat.social.detail.dissolveGroupSuccess'));
    } catch (error) {
      log.error('chat', 'dissolve group failed', { groupUlid: activeUlid, error });
      notifyError(t('chat.social.detail.dissolveGroupFailed'));
      throw error;
    }
  };

  useEffect(() => {
    if (isGroup && activeUlid) {
      loadGroupMembers(activeUlid);
    }
  }, [isGroup, activeUlid, loadGroupMembers]);

  useEffect(() => {
    setShowAllMembers(false);
    setMemberManagerOpen(false);
    setInviteModalOpen(false);
    setBackgroundModalOpen(false);
    setInviteDids([]);
    setEditingName(false);
    setConversationActionPending(null);
    setBackgroundRetryPath(null);
    setEditingMyNickname(false);
    setEditingDescription(false);
    setDescriptionSaving(false);
    setEditingRemark(false);
  }, [activeUlid]);

  useEffect(() => {
    if (!isGroup && !isSelfDirect && peerPtid) {
      void loadPeerProfile(peerPtid);
    }
  }, [isGroup, isSelfDirect, peerPtid, loadPeerProfile]);

  const cachedPeerProfile = !isGroup && peerPtid ? peerProfiles[peerPtid] : undefined;

  return (
    <div
      className="sc-detail"
      data-chat-detail-panel="open"
      data-chat-detail-conversation={activeUlid}
      data-chat-detail-muted={activeLocalState?.muted ? 'true' : 'false'}
      data-chat-detail-pinned={activeLocalState?.sticky ? 'true' : 'false'}
      data-chat-detail-background={activeLocalState?.background || 'default'}
      data-chat-detail-background-image={activeLocalState?.backgroundImage || ''}
      data-chat-detail-action-pending={conversationActionPending || ''}
      data-chat-detail-background-retry={backgroundRetryPath ? 'true' : 'false'}
    >
      {/* Header — prototype .sk-side-head: title left, quiet search/background/
          close glyph actions right. Background and message search are header
          actions, not full setting rows. */}
      <header className="sc-detail__header" style={{ height: DETAIL_HEADER_HEIGHT }}>
        <strong>{t('chat.social.detail.title')}</strong>
        <span className="sc-detail__header-actions">
          <IconButton
            actionId="chat-detail-search"
            className="sc-detail__header-action"
            data-chat-detail-header-action="search"
            iconId="search"
            iconSize={16}
            emphasis="quiet"
            density="compact"
            label={t('chat.social.detail.searchMessages')}
            onActivate={() => window.dispatchEvent(new CustomEvent('peers-chat:open-search'))}
          />
          <IconButton
            actionId="chat-detail-background"
            className="sc-detail__header-action"
            data-chat-conversation-action="background"
            iconId="image"
            iconSize={16}
            emphasis="quiet"
            density="compact"
            availability={conversationActionPending
              ? { kind: 'disabled', reason: t('chat.social.detail.chatBackground') }
              : undefined}
            label={t('chat.social.detail.chatBackground')}
            onActivate={() => setBackgroundModalOpen(true)}
          />
          <IconButton
            actionId="chat-detail-close"
            className="sc-detail__close"
            data-chat-detail-header-action="close"
            iconId="close"
            iconSize={16}
            emphasis="quiet"
            density="compact"
            label={t('chat.social.detail.title')}
            onActivate={() => setShowDetail(false)}
          />
        </span>
      </header>

      {/* Scrollable content */}
      <div className="sc-detail__scroll">
        {/* Identity section */}
        {isGroup ? (
          <div className="sc-detail__group">
            {/* Banner: blurred group avatar over the north-star neutral ink
                wash (prototype .sk-banner grammar), not an off-palette hue. */}
            <div
              className="sc-detail__banner"
              aria-hidden="true"
              data-chat-group-banner
            >
              {groupAvatarUrl.startsWith('http') ? (
                <img src={groupAvatarUrl} alt="" />
              ) : null}
              <div className="sc-detail__banner-veil" />
            </div>
            <div className="sc-detail__group-avatar-row">
              {/* Avatar with edit overlay */}
              <div
                className="sc-detail__group-avatar"
                data-chat-group-avatar={groupAvatarUploading ? 'uploading' : 'idle'}
                onClick={() => {
                  if (!groupAvatarUploading) void handleGroupAvatarClick();
                }}
              >
                <div className="sc-detail__group-avatar-tile">
                  <GroupSquareAvatar
                    remoteUrl={groupAvatarUrl || undefined}
                    members={members.slice(0, 4).map((m) => {
                      const p = memberProfiles.get(m.ptid);
                      return {
                        ptid: m.ptid,
                        name: p?.name || m.nickname || '',
                        avatar: p?.avatar || '',
                      };
                    })}
                    name={displayName}
                    size={72}
                    radius={18}
                  />
                </div>
                <span className="sc-detail__group-avatar-edit">
                  {groupAvatarUploading ? <PtSpin size="small" /> : <Camera size={12} />}
                </span>
              </div>
            </div>
            {/* Editable group name */}
            <div className="sc-detail__group-name-row">
              {editingName ? (
                <PtTextField
                  className="sc-inline-edit sc-detail__group-name-editor"
                  autoFocus
                  value={editNameValue}
                  onValueChange={setEditNameValue}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditingName(false);
                  }}
                  onEnter={() => void handleSaveGroupName()}
                  onBlur={() => void handleSaveGroupName()}
                  data-chat-group-name-editor
                />
              ) : (
                <div className="sc-detail__group-name">
                  <strong>{displayName}</strong>
                  {canManageGroupMembers ? (
                    <PtTooltip label={t('chat.social.detail.editGroupName')}>
                      <PtButton
                        actionId="chat-detail-edit-group-name"
                        data-chat-group-name-edit
                        className="sc-detail__inline-edit"
                        emphasis="quiet"
                        density="compact"
                        leading={<Pencil size={13} />}
                        aria-label={t('chat.social.detail.editGroupName')}
                        onActivate={() => {
                          setEditNameValue(activeConversation?.canonicalName || currentName || '');
                          setEditingName(true);
                        }}
                      />
                    </PtTooltip>
                  ) : null}
                </div>
              )}
            </div>
            {/* When a local remark is set, keep the canonical name readable. */}
            {!editingName
              && (activeLocalState?.remark || '').trim()
              && (activeConversation?.canonicalName || '').trim()
              && (activeLocalState!.remark!.trim() !== activeConversation!.canonicalName!.trim()) ? (
              <span className="sc-detail__canonical-name">
                {t('chat.social.detail.canonicalGroupName', {
                  name: activeConversation!.canonicalName!,
                })}
              </span>
            ) : null}
            <div className="sc-detail__member-count">
              {t('chat.social.detail.membersCount', { count: groupMemberCount })}
            </div>
          </div>
        ) : (
          <div className="sc-detail__profile">
            <PublicProfileCard
              variant="sheet"
              profile={buildChatDetailProfile({
                isGroup,
                isSelfDirect,
                selfLabel: t('chat.social.contacts.savedMessages'),
                displayName,
                peerAvatar,
                peerPtid,
                activeGroup,
                groupMemberCount,
                peerPresenceKnown,
                peerIsOnline,
                isAutomatedConversation,
                encryptionEnabled,
                cachedPeerProfile,
                authorityStationId,
                authorityStationName,
                federationId: activeConversation?.federationId || '',
                t,
              })}
              actions={!isGroup && profileRelationshipKind && profileRelationshipKind !== 'friend' ? (
                <ProfilePrimaryAction actorPtid={peerPtid} />
              ) : undefined}
            />
          </div>
        )}

        {stationChip && (
          <div
            className="sc-detail__station"
            data-chat-station={isGroup ? 'local' : 'authority'}
            data-chat-station-id={stationChip.stationId}
            data-chat-station-name={stationChip.label}
            data-chat-station-state={stationChip.state}
          >
            {stationChip.state !== 'neutral' && (
              <span className="sc-detail__station-dot" aria-hidden="true" />
            )}
            <span className="sc-detail__station-label" title={stationChip.label}>
              {isGroup
                ? stationChip.label
                : t('chat.social.detail.authorityStation', { station: stationChip.label })}
            </span>
          </div>
        )}

        {isGroup ? (
          <DetailSection>
            {editingDescription ? (
              <div className="sc-detail__description-edit">
                <PtTextArea
                  autoFocus
                  framing="embedded"
                  className="sc-detail__description-input"
                  data-chat-group-description-editor
                  value={editDescriptionValue}
                  maxLength={300}
                  rows={3}
                  placeholder={t('chat.social.detail.groupDescriptionPlaceholder')}
                  onChange={(event) => setEditDescriptionValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      void handleSaveDescription();
                    }
                    if (event.key === 'Escape') setEditingDescription(false);
                  }}
                  onBlur={() => void handleSaveDescription()}
                />
                <span>{t('chat.social.detail.groupDescriptionHint')}</span>
              </div>
            ) : (
              <div className="sc-detail__description-row">
                <div className="sc-detail__description-text">
                  <FileText size={15} />
                  {activeConversation?.description?.trim() ? (
                    <span className="sc-detail__description-value">
                      {activeConversation.description.trim()}
                    </span>
                  ) : canManageGroupMembers ? (
                    <span
                      className="sc-detail__description-empty"
                      data-chat-group-description-empty
                    >
                      {descriptionSaving
                        ? t('chat.social.detail.groupDescriptionSaving')
                        : t('chat.social.detail.groupDescriptionAdd')}
                    </span>
                  ) : null}
                </div>
                {canManageGroupMembers && !descriptionSaving ? (
                  <PtTooltip label={t('chat.social.detail.groupDescriptionEdit')}>
                    <PtButton
                      actionId="chat-detail-edit-description"
                      className="sc-detail__inline-edit"
                      emphasis="quiet"
                      density="compact"
                      leading={<Pencil size={13} />}
                      aria-label={t('chat.social.detail.groupDescriptionEdit')}
                      onActivate={startDescriptionEdit}
                    />
                  </PtTooltip>
                ) : null}
              </div>
            )}
          </DetailSection>
        ) : null}

        {isGroup ? (
          <DetailSection title={t('chat.social.detail.permissionLabel')} relaxed>
            <div className="sc-detail__permission">
              <div className="sc-detail__permission-text">
                <strong>{groupPermissionTitle}</strong>
                <span>{groupPermissionBody}</span>
              </div>
              <PtTag tone={groupRoleTone(myMemberRole)}>{myMemberRoleLabel}</PtTag>
            </div>
          </DetailSection>
        ) : null}

        {/* Members section (group only): avatar grid with avatar-sized add/
            manage tiles inside the grid (north-star WeChat parity), never
            full-width text rows below the members. */}
        {isGroup && (
          <DetailSection title={t('chat.social.detail.membersLabel')}>
            {displayMembers.length > 0 || canManageGroupMembers ? (
              <div className="sc-detail__member-previews">
                {(showAllMembers ? displayMembers : displayMembers.slice(0, 8)).map((member) => (
                  <MemberPreviewCard key={member.ptid} member={member} />
                ))}
                {canManageGroupMembers ? (
                  <>
                    <span className="sc-detail-member__tile">
                      <IconButton
                        actionId="chat-detail-add-member-open"
                        className="sc-detail-member__tile-button sc-detail-member__tile-button--add"
                        data-chat-group-add-member-open
                        iconId="user-plus"
                        iconSize={18}
                        emphasis="quiet"
                        label={t('chat.social.detail.addMember')}
                        onActivate={() => setInviteModalOpen(true)}
                        availability={inviteCandidates.length === 0
                          ? { kind: 'disabled', reason: t('chat.social.detail.addMember') }
                          : undefined}
                      />
                    </span>
                    <span className="sc-detail-member__tile">
                      <IconButton
                        actionId="chat-detail-manage-members"
                        className="sc-detail-member__tile-button sc-detail-member__tile-button--manage"
                        data-chat-group-manage-members
                        iconId="settings"
                        iconSize={17}
                        emphasis="quiet"
                        label={t('chat.social.detail.manageMembers')}
                        onActivate={() => setMemberManagerOpen(true)}
                        availability={members.length === 0
                          ? { kind: 'disabled', reason: t('chat.social.detail.manageMembers') }
                          : undefined}
                      />
                    </span>
                  </>
                ) : null}
              </div>
            ) : (
              <span className="sc-detail__hint">{t('chat.social.detail.membersLoading')}</span>
            )}
            {displayMembers.length > 8 ? (
              <div className="sc-detail-member__see-all">
                <PtButton
                  actionId="chat-detail-toggle-members"
                  emphasis="quiet"
                  density="compact"
                  onActivate={() => setShowAllMembers((v) => !v)}
                >
                  {showAllMembers ? t('chat.social.detail.showLess') : t('chat.social.detail.seeAll')}
                </PtButton>
              </div>
            ) : null}
          </DetailSection>
        )}

        {/* Settings section */}
        <DetailSection title={t('chat.social.detail.settings')}>
          {isGroup ? (
            <div className="sc-detail__setting-row">
              <div className="sc-detail__setting-text">
                <Pencil size={15} />
                <div>
                  <strong>{t('chat.social.detail.groupRemark')}</strong>
                  {editingRemark ? (
                    <PtTextField
                      autoFocus
                      className="sc-inline-edit sc-detail__underline-editor"
                      data-chat-group-remark-editor
                      value={editRemarkValue}
                      maxLength={60}
                      placeholder={t('chat.social.detail.groupRemarkPlaceholder')}
                      onValueChange={setEditRemarkValue}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setEditingRemark(false);
                      }}
                      onEnter={() => void handleSaveRemark()}
                      onBlur={() => void handleSaveRemark()}
                    />
                  ) : (
                    <span className="sc-detail__setting-secondary">
                      {(activeLocalState?.remark || '').trim()
                        || t('chat.social.detail.groupRemarkUnset')}
                    </span>
                  )}
                  <span className="sc-detail__setting-hint">{t('chat.social.detail.groupRemarkHint')}</span>
                </div>
              </div>
              {!editingRemark ? (
                <PtButton
                  actionId="chat-detail-edit-remark"
                  emphasis="quiet"
                  density="compact"
                  onActivate={startRemarkEdit}
                >
                  {t('chat.social.detail.edit')}
                </PtButton>
              ) : null}
            </div>
          ) : null}
          {isGroup ? (
            <div className="sc-detail__setting-row">
              <div className="sc-detail__setting-text">
                <Users size={15} />
                <div>
                  <strong>{t('chat.social.detail.myGroupNickname')}</strong>
                  {editingMyNickname ? (
                    <PtTextField
                      autoFocus
                      className="sc-inline-edit sc-detail__underline-editor"
                      value={editMyNicknameValue}
                      placeholder={t('chat.social.detail.myGroupNicknamePlaceholder')}
                      onValueChange={setEditMyNicknameValue}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setEditingMyNickname(false);
                      }}
                      onEnter={() => void handleSaveMyNickname()}
                      onBlur={() => void handleSaveMyNickname()}
                    />
                  ) : (
                    <span className="sc-detail__setting-secondary">
                      {myGroupNickname || t('chat.social.detail.myGroupNicknameUnset')}
                    </span>
                  )}
                </div>
              </div>
              {!editingMyNickname ? (
                <PtButton
                  actionId="chat-detail-edit-nickname"
                  emphasis="quiet"
                  density="compact"
                  onActivate={() => {
                    setEditMyNicknameValue(myGroupNickname);
                    setEditingMyNickname(true);
                  }}
                >
                  {t('chat.social.detail.edit')}
                </PtButton>
              ) : null}
            </div>
          ) : null}
          <div className="sc-detail__setting-row">
            <div className="sc-detail__setting-inline">
              <BellOff size={15} />
              <strong>{t('chat.social.detail.muteNotifications')}</strong>
            </div>
            <Toggle
              action="mute"
              checked={Boolean(activeLocalState?.muted)}
              disabled={conversationActionPending === 'mute'}
              onChange={(v) => {
                void runConversationAction('mute', { muted: v });
              }}
            />
          </div>
          <div className="sc-detail__setting-row">
            <div className="sc-detail__setting-inline">
              <Pin size={15} />
              <strong>{t('chat.social.detail.pinConversation')}</strong>
            </div>
            <Toggle
              action="pin"
              checked={Boolean(activeLocalState?.sticky)}
              disabled={conversationActionPending === 'pin'}
              onChange={(v) => {
                void runConversationAction('pin', { sticky: v });
              }}
            />
          </div>
        </DetailSection>

        {/* Shared Content section */}
        <DetailSection title={t('chat.social.detail.sharedContent')}>
          <DetailAttachmentSection
            kind="media"
            title={t('chat.social.detail.mediaWithCount', { count: mediaAttachments.length })}
            emptyLabel={t('chat.social.detail.mediaEmpty')}
            items={mediaAttachments}
            limit={RECENT_MEDIA_LIMIT}
          />
          <DetailAttachmentSection
            kind="files"
            title={t('chat.social.detail.filesWithCount', { count: fileAttachments.length })}
            emptyLabel={t('chat.social.detail.filesEmpty')}
            items={fileAttachments}
            limit={RECENT_FILE_LIMIT}
          />
        </DetailSection>

        {/* Security section: safety numbers are a peer concept; self-direct
            carries no peer to verify. */}
        {encryptionEnabled && !isGroup && !isSelfDirect && (
          <DetailSection title={t('chat.social.encryption.title')}>
            <div className="sc-detail__encrypt-title">
              <Lock size={14} />
              <strong>{t('chat.social.encryption.title')}</strong>
            </div>
            <span className="sc-detail__hint">{t('chat.social.encryption.fingerprint')}</span>
            <code className="sc-detail__fingerprint">{ownFingerprint || '—'}</code>
            {!isGroup && peerPtid ? (
              <PtButton
                actionId="chat-detail-toggle-verify"
                emphasis={verifyOpen ? 'secondary' : 'primary'}
                density="compact"
                leading={<ShieldCheck size={14} />}
                onActivate={() => setVerifyOpen((v) => !v)}
              >
                {verifyOpen
                  ? t('chat.social.verify.hide')
                  : t('chat.social.verify.show')}
              </PtButton>
            ) : null}
            {!isGroup && peerPtid && verifyOpen && currentUserPtid ? (
              <SafetyVerificationPanel
                localActorPtid={currentUserPtid}
                localFingerprint={ownFingerprint || ''}
                peerPtid={peerPtid}
              />
            ) : null}
            {activeTab === 'friend' ? (
              <div className="sc-detail__encrypt-note">
                <span>{t('chat.social.encryption.upgradeBody.line3')}</span>
                <span>{t('chat.social.encryption.upgradeBlocked')}</span>
              </div>
            ) : null}
          </DetailSection>
        )}

        {/* Danger zone */}
        <DetailSection title={t('chat.social.detail.dangerZone')}>
          <PtButton
            actionId="chat-detail-clear-history"
            data-chat-history-action="clear"
            tone="danger"
            emphasis="quiet"
            fullWidth
            execution={historyActionPending ? 'pending' : 'idle'}
            leading={<Trash2 size={14} />}
            onActivate={confirmClearHistory}
            className="sc-detail__danger-btn"
          >
            {t('chat.social.detail.clearHistory')}
          </PtButton>
          {isGroup ? (
            <PtButton
              actionId="chat-detail-leave-or-dissolve"
              tone="danger"
              emphasis="quiet"
              fullWidth
              leading={isGroupOwner ? <Trash2 size={14} /> : <LogOut size={14} />}
              onActivate={isGroupOwner ? confirmDissolveGroup : confirmLeaveGroup}
              className="sc-detail__danger-btn"
            >
              {isGroupOwner ? t('chat.social.detail.dissolveGroup') : t('chat.social.detail.leaveGroup')}
            </PtButton>
          ) : null}
        </DetailSection>

        {/* Spacer for scroll padding */}
        <div className="sc-detail__scroll-spacer" />
      </div>

      {/* Chat background dialog */}
      <Dialog
        open={backgroundModalOpen}
        onDismiss={() => setBackgroundModalOpen(false)}
        title={t('chat.social.detail.chatBackground')}
        width={440}
        closeLabel={t('chat.social.messageArea.cancel')}
        footer={
          <PtButton
            actionId="chat-background-close"
            emphasis="quiet"
            onActivate={() => setBackgroundModalOpen(false)}
          >
            {t('chat.social.messageArea.cancel')}
          </PtButton>
        }
      >
        <div className="sc-detail__background-dialog">
          <span className="sc-detail__hint">{t('chat.social.detail.backgroundDesc')}</span>
          <div className="sc-bg-picker" data-bg-picker>
            {CHAT_BACKGROUND_OPTIONS.map((value) => (
              <PtToggle
                key={value}
                actionId={`chat-background-preset-${value}`}
                className={`sc-bg-swatch${value === 'default' ? ' sc-bg-swatch--default' : ''}`}
                selected={(activeLocalState?.background || 'default') === value}
                onSelectedChange={() => {
                  void runConversationAction('background', {
                    background: String(value) as typeof CHAT_BACKGROUND_OPTIONS[number],
                  });
                }}
                aria-label={t(`chat.social.background.${value}`)}
                data-bg-preset={value}
                label={t(`chat.social.background.${value}`)}
                availability={conversationActionPending
                  ? { kind: 'disabled', reason: t('chat.social.detail.backgroundDesc') }
                  : undefined}
              />
            ))}
          </div>
          <PtButton
            actionId="chat-background-upload"
            className="sc-bg-upload"
            data-chat-background-upload
            fullWidth
            emphasis="quiet"
            leading={<ImageIcon size={14} />}
            execution={conversationActionPending === 'background-image' ? 'pending' : 'idle'}
            onActivate={() => void handleSelectBackgroundImage()}
          >
            {t('chat.social.detail.uploadBackgroundImage')}
          </PtButton>
          {backgroundRetryPath ? (
            <PtButton
              actionId="chat-background-retry"
              data-chat-background-retry
              fullWidth
              execution={conversationActionPending === 'background-image' ? 'pending' : 'idle'}
              onActivate={() => {
                const retryPath = backgroundRetryPath;
                void handleUploadBackgroundImage(
                  retryPath,
                  convertFileSrc(retryPath),
                );
              }}
            >
              {t('chat.social.detail.retryBackgroundImage')}
            </PtButton>
          ) : null}
          {activeLocalState?.backgroundImage ? (
            <PtButton
              actionId="chat-background-clear"
              data-chat-background-clear
              fullWidth
              tone="danger"
              emphasis="quiet"
              execution={conversationActionPending === 'background-image-clear' ? 'pending' : 'idle'}
              onActivate={() => {
                void runConversationAction('background-image-clear', {
                  backgroundImage: '',
                });
              }}
            >
              {t('chat.social.detail.clearBackgroundImage')}
            </PtButton>
          ) : null}
        </div>
      </Dialog>

      {/* Member management dialog */}
      <Dialog
        open={memberManagerOpen}
        onDismiss={() => setMemberManagerOpen(false)}
        title={t('chat.social.detail.manageMembers')}
        width={520}
        closeLabel={t('chat.social.messageArea.cancel')}
      >
        <div className="sc-detail__member-manager">
          {displayMembers.map((member) => {
            const memberRole = Number(member.role ?? MemberRole.MEMBER);
            const targetIsSelf = member.ptid === currentUserPtid;
            const controlState = getGroupMemberControlState({
              canManageGroupMembers,
              isSelf: targetIsSelf,
              membersLoaded: members.length > 0,
              myMemberRole,
              targetRole: memberRole,
            });
            const managedMember = members.find((groupMember) => groupMember.ptid === member.ptid);
            const lockedReason = controlState.lockedReasonKey ? t(controlState.lockedReasonKey) : undefined;
            return (
              <MemberItem
                key={member.ptid}
                member={member}
                lockedReason={lockedReason}
                action={controlState.canManageTarget && managedMember ? (
                  <>
                    {myMemberRole === MemberRole.OWNER ? (
                      <>
                        <PtButton
                          actionId={`member-role-${member.ptid}`}
                          emphasis="quiet"
                          density="compact"
                          onActivate={() => confirmUpdateGroupMemberRole(
                            managedMember,
                            memberRole === MemberRole.ADMIN ? MemberRole.MEMBER : MemberRole.ADMIN,
                          )}
                        >
                          {memberRole === MemberRole.ADMIN
                            ? t('chat.social.detail.demoteAdmin')
                            : t('chat.social.detail.promoteAdmin')}
                        </PtButton>
                        <PtButton
                          actionId={`member-transfer-${member.ptid}`}
                          emphasis="quiet"
                          density="compact"
                          onActivate={() => confirmTransferGroupOwnership(managedMember)}
                        >
                          {t('chat.social.detail.transferOwner')}
                        </PtButton>
                      </>
                    ) : null}
                    <PtButton
                      actionId={`member-mute-${member.ptid}`}
                      emphasis="quiet"
                      density="compact"
                      onActivate={() => toggleGroupMemberMuted(managedMember)}
                    >
                      {member.muted ? t('chat.social.detail.unmuteMember') : t('chat.social.detail.muteMember')}
                    </PtButton>
                    <PtButton
                      actionId={`member-remove-${member.ptid}`}
                      data-chat-group-remove-member={member.ptid}
                      tone="danger"
                      emphasis="quiet"
                      density="compact"
                      onActivate={() => confirmRemoveGroupMember(managedMember)}
                    >
                      {t('chat.social.detail.removeMember')}
                    </PtButton>
                  </>
                ) : undefined}
              />
            );
          })}
        </div>
      </Dialog>

      {/* Invite dialog */}
      <Dialog
        open={inviteModalOpen}
        onDismiss={() => {
          setInviteModalOpen(false);
          setInviteDids([]);
        }}
        title={t('chat.social.detail.addMember')}
        width={480}
        closeLabel={t('chat.social.messageArea.cancel')}
        footer={
          <>
            <PtButton
              actionId="invite-members-cancel"
              emphasis="quiet"
              onActivate={() => {
                setInviteModalOpen(false);
                setInviteDids([]);
              }}
            >
              {t('chat.social.messageArea.cancel')}
            </PtButton>
            <PtButton
              actionId="invite-members-submit"
              data-chat-group-add-member-submit
              emphasis="primary"
              execution={inviteSubmitting ? 'pending' : 'idle'}
              onActivate={() => void submitGroupInvites()}
              availability={inviteDids.length === 0
                ? { kind: 'disabled', reason: t('chat.social.detail.addMemberPlaceholder') }
                : undefined}
            >
              {t('chat.social.detail.addMember')}
            </PtButton>
          </>
        }
      >
        <div className="sc-detail__invite">
          <span className="sc-detail__hint">{t('chat.social.detail.addMemberDesc')}</span>
          <PtSelect
            data-chat-group-add-member-select
            multiple
            searchable
            value={inviteDids}
            options={inviteCandidates.map((candidate) => ({
              label: candidate.name || candidate.did,
              value: candidate.did,
            }))}
            placeholder={t('chat.social.detail.addMemberPlaceholder')}
            onValueChange={(value) => setInviteDids(Array.isArray(value) ? value.map(String) : [])}
            className="sc-detail__member-select"
          />
        </div>
      </Dialog>
    </div>
  );
}

interface BuildChatDetailProfileArgs {
  isGroup: boolean;
  isSelfDirect: boolean;
  selfLabel: string;
  displayName: string;
  peerAvatar: string;
  peerPtid: string;
  activeGroup: Group | undefined;
  groupMemberCount: number;
  peerPresenceKnown: boolean;
  peerIsOnline: boolean | null | undefined;
  isAutomatedConversation: boolean;
  encryptionEnabled: boolean;
  cachedPeerProfile: AccountProfile | null | undefined;
  authorityStationId: string;
  authorityStationName: string;
  federationId: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

// Compose the profile data shown in the chat detail card from session-derived
// snapshots and the lazily-loaded Station profile. Station fields take
// precedence whenever present so freshly-edited bios/regions show through;
// the session row keeps the avatar/displayName/online state visible during
// the brief network round-trip.
function buildChatDetailProfile({
  isGroup,
  isSelfDirect,
  selfLabel,
  displayName,
  peerAvatar,
  peerPtid,
  activeGroup,
  groupMemberCount,
  peerPresenceKnown,
  peerIsOnline,
  isAutomatedConversation,
  encryptionEnabled,
  cachedPeerProfile,
  authorityStationId,
  authorityStationName,
  federationId,
  t,
}: BuildChatDetailProfileArgs): PublicProfileModel {
  // Bots have no presence concept and self-direct has no peer; show their
  // stable relation label instead of an "Offline" state.
  const presenceLabel = isGroup
    ? t('chat.social.detail.membersCount', { count: groupMemberCount })
    : isSelfDirect
      ? selfLabel
      : isAutomatedConversation
        ? t('chat.automation.stationManaged', { defaultValue: 'Automated service · Station resident' })
        : peerPresenceKnown
          ? peerIsOnline
            ? t('chat.social.detail.online')
            : t('chat.social.detail.offline')
          : t('chat.social.detail.presenceUnavailable');
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
          label: t('chat.social.detail.membersLabel'),
          value: groupMemberCount,
        },
      ],
    };
  }

  const stats: { label: string; value: number }[] = [];
  if (cachedPeerProfile) {
    if (typeof cachedPeerProfile.statuses_count === 'number') {
      stats.push({
        label: t('chat.social.detail.posts'),
        value: cachedPeerProfile.statuses_count,
      });
    }
    if (typeof cachedPeerProfile.followers_count === 'number') {
      stats.push({
        label: t('chat.social.detail.followers'),
        value: cachedPeerProfile.followers_count,
      });
    }
    if (typeof cachedPeerProfile.following_count === 'number') {
      stats.push({
        label: t('chat.social.detail.following'),
        value: cachedPeerProfile.following_count,
      });
    }
  }

  return {
    displayName: cachedPeerProfile?.display_name?.trim() || displayName,
    avatar: cachedPeerProfile?.avatar?.trim() || peerAvatar,
    header: cachedPeerProfile?.header?.trim() || undefined,
    username: cachedPeerProfile?.username?.trim() || undefined,
    homeStationDomain: cachedPeerProfile?.home_station_domain?.trim() || undefined,
    bio: cachedPeerProfile?.note?.trim() || undefined,
    did: cachedPeerProfile?.id?.trim() || peerPtid,
    joined: formatJoinedDate(
      cachedPeerProfile?.created_at,
      t('chat.social.profile.joined'),
    ),
    region: cachedPeerProfile?.region?.trim() || undefined,
    tags: (cachedPeerProfile?.tags ?? []).filter(Boolean),
    links: (cachedPeerProfile?.links ?? []).filter((l) => l && (l.label || l.url)),
    relationLabel: presenceLabel,
    relationTone: !isSelfDirect && peerIsOnline ? 'success' : 'default',
    identityMetadata: authorityStationName
      ? [t('chat.social.identity.station', { station: authorityStationName })]
      : undefined,
    technicalDetails: [
      {
        id: 'actor-ptid',
        label: t('chat.social.identity.details.actorPtid'),
        value: cachedPeerProfile?.id?.trim() || peerPtid,
      },
      {
        id: 'station-peer-id',
        label: t('chat.social.identity.details.stationPeerId'),
        value: authorityStationId,
      },
      {
        id: 'federation-id',
        label: t('chat.social.identity.details.federationId'),
        value: federationId,
      },
    ].filter((detail) => detail.value).map((detail) => ({
      ...detail,
      copyLabel: t('chat.social.identity.details.copy', { label: detail.label }),
      copiedLabel: t('chat.social.identity.details.copied', { label: detail.label }),
      copyFailedLabel: t('chat.social.identity.details.copyFailed', { label: detail.label }),
    })),
    technicalDetailsLabel: t('chat.social.identity.details.title'),
    badges: [encryptionBadge],
    stats: stats.length > 0 ? stats : undefined,
  };
}
