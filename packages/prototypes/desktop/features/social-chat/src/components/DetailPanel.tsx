import { useEffect, useMemo, useState } from 'react';
import {
  X,
  Camera,
  Edit3,
  Bell,
  BellOff,
  Pin,
  Image,
  Trash2,
  LogOut,
  Users,
  ChevronRight,
  Crown,
  ShieldCheck,
  UserMinus,
  Volume2,
  VolumeX,
  UserCog,
  Upload,
  Search,
  UserPlus,
  ChevronDown,
  FileText,
  Paperclip,
  Globe,
  Check,
} from 'lucide-react';
import { T } from '../theme';
import { Avatar } from './Avatar';
import { GroupAvatar, type GroupAvatarTile } from './GroupAvatar';
import {
  USERS,
  type MockConversation,
  type MockGroupMember,
  type MockGroupRole,
  type MockMessage,
  type MockUser,
} from '../mock';

interface DetailPanelProps {
  conversation: MockConversation;
  currentUserId: string;
  groupMembers: MockGroupMember[];
  messages: MockMessage[];
  onClose: () => void;
  onDeleteConversation: (conversationId: string) => void;
  onClearHistory: (conversationId: string) => void;
  onSelectBackgroundImage: (conversationId: string, file: File) => void;
  onRemoveMember: (conversationId: string, userId: string) => void;
  onAddMembers: (conversationId: string, userIds: string[]) => void;
  onRenameGroup: (conversationId: string, name: string) => void;
  onSetMemberRole: (conversationId: string, userId: string, role: MockGroupRole) => void;
  onToggleMemberMute: (conversationId: string, userId: string) => void;
  onTransferOwnership: (conversationId: string, nextOwnerId: string) => void;
  onSearchMessages: () => void;
}

/**
 * DetailSection — unified section container component.
 * Establishes consistent spacing, radius, and visual rhythm.
 */
function DetailSection({ children, title, bare }: { children: React.ReactNode; title?: string; bare?: boolean }) {
  return (
    <div style={{ padding: `0 ${T.space4}px`, marginBottom: T.space3 }}>
      {title && (
        <div style={{ fontSize: T.fontSm, fontWeight: 500, color: T.textTertiary, marginBottom: T.space2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {title}
        </div>
      )}
      {bare ? (
        children
      ) : (
        <div
          style={{
            background: T.bgSubtle,
            borderRadius: T.radiusLg,
            overflow: 'hidden',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// Quiet empty-state line: plain muted text aligned with section content — no
// nested dashed box (a box-in-box crowds the section edge and reads as noise).
function EmptyDetailHint({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '2px 2px',
        color: T.textTertiary,
        fontSize: T.fontSm,
      }}
    >
      <span style={{ display: 'inline-flex', flexShrink: 0 }}>{icon}</span>
      {text}
    </div>
  );
}

function DetailActionRow({
  icon,
  label,
  danger,
  trailing,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: T.space3,
        padding: `${T.space3}px ${T.space4}px`,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.1s',
        color: danger ? T.textDanger : T.text,
      }}
      onMouseEnter={(e) => { if (onClick) e.currentTarget.style.background = T.bgHover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ display: 'flex', width: 20, height: 20, color: danger ? T.textDanger : T.textSecondary }}>
        {icon}
      </span>
      <span style={{ flex: 1, fontSize: T.fontBase }}>{label}</span>
      {trailing && <span style={{ color: T.textTertiary }}>{trailing}</span>}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      style={{
        width: 36,
        height: 20,
        borderRadius: T.radiusFull,
        background: checked ? T.primary : T.bgActive,
        cursor: 'pointer',
        padding: 2,
        transition: 'background 0.2s',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: T.radiusFull,
          background: T.bg,
          boxShadow: T.shadowSm,
          transition: 'transform 0.2s',
          transform: checked ? 'translateX(16px)' : 'translateX(0)',
        }}
      />
    </div>
  );
}

function roleLabel(role: MockGroupRole) {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  return 'Member';
}

function roleColor(role: MockGroupRole) {
  if (role === 'owner') return T.warning;
  if (role === 'admin') return T.primary;
  return T.textTertiary;
}

function roleRank(role: MockGroupRole) {
  if (role === 'owner') return 0;
  if (role === 'admin') return 1;
  return 2;
}

function ConfirmSheet({
  title,
  body,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.18)',
        display: 'flex',
        alignItems: 'flex-end',
        zIndex: 20,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          width: '100%',
          background: T.bg,
          borderTopLeftRadius: T.radiusXl,
          borderTopRightRadius: T.radiusXl,
          padding: T.space5,
          boxShadow: T.shadowLg,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: T.fontXl, fontWeight: 700, color: T.text, marginBottom: T.space2 }}>
          {title}
        </div>
        <div style={{ fontSize: T.fontBase, color: T.textSecondary, lineHeight: 1.5, marginBottom: T.space5 }}>
          {body}
        </div>
        <div style={{ display: 'flex', gap: T.space2 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              height: 40,
              border: `1px solid ${T.border}`,
              borderRadius: T.radiusMd,
              background: T.bg,
              color: T.text,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 1,
              height: 40,
              border: 'none',
              borderRadius: T.radiusMd,
              background: danger ? T.danger : T.primary,
              color: T.textOnPrimary,
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Bounded inline previews; the rest opens the browser which loads incrementally,
// so the panel stays light even with 100/1000+ attachments.
const MEDIA_PREVIEW_COUNT = 6;
const FILE_PREVIEW_COUNT = 3;
const BROWSE_MEDIA_STEP = 60;
const BROWSE_FILES_STEP = 40;

export function DetailPanel({
  conversation,
  currentUserId,
  groupMembers,
  messages,
  onClose,
  onDeleteConversation,
  onClearHistory,
  onSelectBackgroundImage,
  onRemoveMember,
  onAddMembers,
  onRenameGroup,
  onSetMemberRole,
  onToggleMemberMute,
  onTransferOwnership,
  onSearchMessages,
}: DetailPanelProps) {
  const [muted, setMuted] = useState(conversation.muted);
  const [pinned, setPinned] = useState(conversation.pinned);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [safetyVerified, setSafetyVerified] = useState(conversation.trustTone === 'verified');
  useEffect(() => {
    setSafetyVerified(conversation.trustTone === 'verified');
    setSafetyOpen(false);
  }, [conversation.id, conversation.trustTone]);
  const mediaAttachments = useMemo(
    () => messages.filter((message) => message.type === 'image'),
    [messages],
  );
  const fileAttachments = useMemo(
    () => messages.filter((message) => message.type === 'file'),
    [messages],
  );
  const [editingName, setEditingName] = useState(false);
  const [groupName, setGroupName] = useState(conversation.name);
  const [memberManagerOpen, setMemberManagerOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | {
    title: string;
    body: string;
    confirmLabel: string;
    danger?: boolean;
    run: () => void;
  }>(null);
  const [backgroundFileName, setBackgroundFileName] = useState('');
  const [avatarFileName, setAvatarFileName] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  // Media/files browser. Inline previews stay bounded; the full browser renders
  // incrementally so a conversation with hundreds/thousands of attachments does
  // not dump the whole set into the DOM at once.
  const [browse, setBrowse] = useState<null | 'media' | 'files'>(null);
  const [mediaVisible, setMediaVisible] = useState(BROWSE_MEDIA_STEP);
  const [filesVisible, setFilesVisible] = useState(BROWSE_FILES_STEP);

  useEffect(() => {
    setMuted(conversation.muted);
    setPinned(conversation.pinned);
    setEditingName(false);
    setGroupName(conversation.name);
    setMemberManagerOpen(false);
    setConfirmAction(null);
    setTechnicalOpen(false);
    setBackgroundFileName('');
    setAvatarFileName('');
    setMemberSearch('');
    setBrowse(null);
    setMediaVisible(BROWSE_MEDIA_STEP);
    setFilesVisible(BROWSE_FILES_STEP);
    setJustAdded(new Set());
  }, [conversation.id, conversation.muted, conversation.name, conversation.pinned]);

  const isGroup = conversation.type === 'group';
  const currentMember = groupMembers.find((member) => member.userId === currentUserId);
  const currentRole = currentMember?.role ?? 'member';
  const isOwner = currentRole === 'owner';
  const isAdmin = currentRole === 'admin';
  const canManageMembers = isOwner || isAdmin;
  const canEditGroupProfile = isOwner || isAdmin;
  const members = useMemo(
    () => groupMembers
      .map((member) => ({ member, user: USERS[member.userId] }))
      .filter((entry): entry is { member: MockGroupMember; user: MockUser } => Boolean(entry.user))
      // Owner pinned first, then admins, then members; ties by join time.
      .sort((a, b) => roleRank(a.member.role) - roleRank(b.member.role) || a.member.joinedAt - b.member.joinedAt),
    [groupMembers],
  );
  // Local people who can be invited. Federated contacts are excluded here:
  // cross-station peers can't join an encrypted group in this prototype.
  const inviteCandidates = useMemo(() => {
    const inGroup = new Set(groupMembers.map((member) => member.userId));
    return Object.values(USERS)
      .filter((user) => user.id !== currentUserId && !inGroup.has(user.id) && !user.federated);
  }, [groupMembers, currentUserId]);
  const [justAdded, setJustAdded] = useState<Set<string>>(() => new Set());
  const addMember = (userId: string) => {
    onAddMembers(conversation.id, [userId]);
    setJustAdded((prev) => new Set(prev).add(userId));
  };
  const filteredMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    if (!query) return members;
    return members.filter(({ member, user }) =>
      user.name.toLowerCase().includes(query)
      || member.userId.toLowerCase().includes(query)
      || member.role.toLowerCase().includes(query),
    );
  }, [memberSearch, members]);
  const canManageTarget = (target: MockGroupMember) => {
    if (target.userId === currentUserId) return false;
    if (target.role === 'owner') return false;
    if (isOwner) return true;
    return isAdmin && target.role === 'member';
  };
  const ownerTransferCandidates = members.filter(({ member }) => canManageTarget(member));

  const commitRename = () => {
    const nextName = groupName.trim();
    if (nextName) {
      setGroupName(nextName);
      onRenameGroup(conversation.id, nextName);
    } else {
      setGroupName(conversation.name);
    }
    setEditingName(false);
  };

  const requestConfirm = (action: NonNullable<typeof confirmAction>) => {
    setConfirmAction(action);
  };

  const runConfirmedAction = () => {
    confirmAction?.run();
    setConfirmAction(null);
  };

  return (
    <div
      data-chat-detail-panel="open"
      data-chat-detail-conversation={conversation.id}
      data-chat-detail-muted={muted ? 'true' : 'false'}
      data-chat-detail-pinned={pinned ? 'true' : 'false'}
      data-chat-detail-background={conversation.background ?? 'default'}
      style={{
        width: T.detailPanelWidth,
        height: '100%',
        borderLeft: `1px solid ${T.border}`,
        display: 'flex',
        flexDirection: 'column',
        background: T.bg,
        flexShrink: 0,
        position: 'relative',
        minWidth: 0,
        overflowX: 'hidden',
      }}
    >
      {/* Header — SAME height as chat area header */}
      <div
        style={{
          height: T.headerHeight,
          padding: `0 ${T.space4}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: T.fontLg, fontWeight: 600, color: T.text }}>Details</span>
        <button
          type="button"
          title="Close details"
          aria-label="Close details"
          onClick={onClose}
          style={{
            width: 28, height: 28, border: 'none', background: 'transparent',
            borderRadius: T.radiusMd, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textSecondary,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = T.bgHover)}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <X size={18} />
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingTop: T.space5 }}>
        {/* === Identity Section === */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: T.space6, padding: `0 ${T.space4}px` }}>
          {/* Avatar with edit overlay */}
          <div style={{ position: 'relative', marginBottom: T.space3 }}>
            {isGroup ? (
              <GroupAvatar
                size={72}
                members={members.slice(0, 9).map(({ member, user }) => ({
                  key: member.userId,
                  name: user.name,
                  src: user.avatar || undefined,
                }))}
              />
            ) : (
              <Avatar name={conversation.name} size={72} />
            )}
            {isGroup && canEditGroupProfile && (
              <label title="Upload local avatar">
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => setAvatarFileName(e.currentTarget.files?.[0]?.name ?? '')}
                />
                <span
                  style={{
                    position: 'absolute', bottom: 0, right: 0,
                    width: 24, height: 24, borderRadius: T.radiusFull,
                    background: T.primary, border: `2px solid ${T.bg}`,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: T.textOnPrimary,
                  }}
                >
                  <Camera size={12} />
                </span>
              </label>
            )}
          </div>

          {/* Editable name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: T.space2 }}>
            {editingName ? (
              <input
                autoFocus
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') {
                    setGroupName(conversation.name);
                    setEditingName(false);
                  }
                }}
                style={{
                  fontSize: T.fontHeading, fontWeight: 600, color: T.text,
                  border: 'none', borderBottom: `2px solid ${T.primary}`,
                  outline: 'none', textAlign: 'center', background: 'transparent',
                  padding: `${T.space1}px ${T.space2}px`,
                }}
              />
            ) : (
              <>
                <span style={{ fontSize: T.fontHeading, fontWeight: 600, color: T.text }}>{groupName}</span>
                {isGroup && canEditGroupProfile && (
                  <button
                    onClick={() => setEditingName(true)}
                    style={{
                      width: 20, height: 20, border: 'none', background: 'transparent',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: T.textTertiary, borderRadius: T.radiusSm,
                    }}
                    title="Rename group"
                  >
                    <Edit3 size={13} />
                  </button>
                )}
              </>
            )}
          </div>
          {isGroup && (
            <span style={{ fontSize: T.fontSm, color: T.textTertiary, marginTop: T.space1 }}>
              {members.length} members · You are {roleLabel(currentRole).toLowerCase()}
            </span>
          )}
          {avatarFileName && (
            <span style={{ fontSize: T.fontXs, color: T.primary, marginTop: T.space1 }}>
              Local avatar selected: {avatarFileName}
            </span>
          )}
          {!isGroup && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginTop: T.space2, width: '100%' }}>
              {conversation.federated ? (
                <span
                  data-chat-federation-cue
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: T.fontSm,
                    fontWeight: 600,
                    color: T.federated,
                  }}
                >
                  <Globe size={13} />
                  From another network
                </span>
              ) : null}
              <span
                style={{
                  fontSize: T.fontSm, fontWeight: 700,
                  color: conversation.online === false ? T.warning : T.success,
                  marginTop: 2,
                }}
              >
                {conversation.online === undefined
                  ? 'Presence unavailable'
                  : conversation.online ? 'Online' : 'Offline'}
              </span>
              <span style={{ fontSize: T.fontSm, fontWeight: 700, color: '#b7791f' }}>
                {conversation.chatKindLabel ?? 'Standard chat'}
              </span>
              {conversation.stats ? (
                <div style={{ display: 'flex', gap: T.space5, marginTop: T.space2 }}>
                  {([
                    ['Posts', conversation.stats.posts],
                    ['Followers', conversation.stats.followers],
                    ['Following', conversation.stats.following],
                  ] as const).map(([label, value]) => (
                    <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 48 }}>
                      <strong style={{ fontSize: T.fontBase, color: T.text }}>{value}</strong>
                      <span style={{ fontSize: T.fontXs, color: T.textTertiary }}>{label}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* === Members Section (group only): owner pinned first with a badge === */}
        {isGroup && (
          <DetailSection title="Members">
            <div style={{ padding: `${T.space2}px ${T.space3}px` }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: T.space2 }}>
                {members.slice(0, 8).map(({ member, user }) => (
                  <div key={user.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 52 }}>
                    <div style={{ position: 'relative' }}>
                      <Avatar name={user.name} size={36} online={user.online} />
                      {member.role !== 'member' && (
                        <span
                          style={{
                            position: 'absolute',
                            right: -2,
                            top: -2,
                            width: 16,
                            height: 16,
                            borderRadius: T.radiusFull,
                            background: roleColor(member.role),
                            color: T.textOnPrimary,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: `2px solid ${T.bg}`,
                          }}
                        >
                          {member.role === 'owner' ? <Crown size={9} /> : <ShieldCheck size={9} />}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: T.fontXs, color: T.textTertiary, marginTop: 2, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                      {user.name.split(' ')[0]}
                    </span>
                    {member.role !== 'member' ? (
                      <span style={{ fontSize: 9, fontWeight: 800, lineHeight: 1.2, color: roleColor(member.role) }}>
                        {roleLabel(member.role)}
                      </span>
                    ) : null}
                  </div>
                ))}
                {canManageMembers ? (
                  <button
                    type="button"
                    data-chat-add-member-tile
                    aria-label="Add member"
                    onClick={() => setMemberManagerOpen(true)}
                    style={{
                      width: 36, height: 36, borderRadius: T.radiusLg,
                      border: `1.5px dashed ${T.textQuaternary}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: T.textTertiary,
                      cursor: 'pointer',
                      background: 'transparent',
                      alignSelf: 'flex-start',
                    }}
                    title="Add member"
                  >
                    <UserPlus size={16} />
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setMemberManagerOpen(true)}
                style={{
                  width: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  padding: `${T.space2}px 0`, marginTop: T.space2,
                  fontSize: T.fontSm, color: T.primary, cursor: 'pointer',
                  border: 'none', background: 'transparent',
                }}
              >
                {canManageMembers ? 'Manage' : 'View'} all {members.length} members <ChevronRight size={14} />
              </button>
            </div>
          </DetailSection>
        )}

        {/* === Settings Section === */}
        <DetailSection title="Settings">
          <DetailActionRow
            icon={muted ? <BellOff size={18} /> : <Bell size={18} />}
            label="Mute notifications"
            trailing={<Toggle checked={muted} onChange={() => setMuted(!muted)} />}
          />
          <DetailActionRow
            icon={<Pin size={18} />}
            label="Pin conversation"
            trailing={<Toggle checked={pinned} onChange={() => setPinned(!pinned)} />}
          />
          <DetailActionRow
            icon={<Image size={18} />}
            label={backgroundFileName ? `Background: ${backgroundFileName}` : `Chat background · ${conversation.background ?? 'Default'}`}
            trailing={<Upload size={16} />}
            onClick={() => document.getElementById('prototype-background-upload')?.click()}
          />
          <DetailActionRow
            icon={<Search size={18} />}
            label="Search messages"
            trailing={<ChevronRight size={16} />}
            onClick={onSearchMessages}
          />
          <input
            id="prototype-background-upload"
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              setBackgroundFileName(file?.name ?? '');
              if (file) onSelectBackgroundImage(conversation.id, file);
            }}
          />
        </DetailSection>

        {/* === Shared Content === */}
        <DetailSection title={`Media (${mediaAttachments.length})`} bare>
          {mediaAttachments.length === 0 ? (
            <EmptyDetailHint icon={<Image size={14} />} text="No shared media yet." />
          ) : (
            <div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: 6,
                }}
              >
                {mediaAttachments
                  .slice(0, mediaAttachments.length > MEDIA_PREVIEW_COUNT ? MEDIA_PREVIEW_COUNT - 1 : MEDIA_PREVIEW_COUNT)
                  .map((message) => (
                    <button
                      type="button"
                      key={message.id}
                      data-chat-detail-media={message.id}
                      title={message.attachmentName ?? 'media'}
                      onClick={() => setBrowse('media')}
                      style={{
                        aspectRatio: '1 / 1', borderRadius: T.radiusMd,
                        border: `1px solid ${T.border}`,
                        background: T.bg, cursor: 'pointer', padding: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: T.textTertiary,
                      }}
                    >
                      <Image size={18} />
                    </button>
                  ))}
                {mediaAttachments.length > MEDIA_PREVIEW_COUNT ? (
                  <button
                    type="button"
                    data-chat-detail-media-overflow
                    aria-label={`View all ${mediaAttachments.length} media items`}
                    onClick={() => setBrowse('media')}
                    style={{
                      aspectRatio: '1 / 1', borderRadius: T.radiusMd,
                      border: `1px solid ${T.border}`, background: T.bgSubtle,
                      cursor: 'pointer', color: T.textSecondary, padding: 0,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center', gap: 2,
                      fontSize: 14, fontWeight: 700,
                    }}
                  >
                    +{mediaAttachments.length - (MEDIA_PREVIEW_COUNT - 1)}
                    <span style={{ fontSize: 9, fontWeight: 500, color: T.textTertiary }}>View all</span>
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </DetailSection>

        <DetailSection title={`Files (${fileAttachments.length})`} bare>
          {fileAttachments.length === 0 ? (
            <EmptyDetailHint icon={<Paperclip size={14} />} text="No shared files yet." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {fileAttachments.slice(0, FILE_PREVIEW_COUNT).map((message) => (
                <button
                  type="button"
                  key={message.id}
                  data-chat-detail-file={message.id}
                  onClick={() => setBrowse('files')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9,
                    padding: '7px 9px', borderRadius: T.radiusMd,
                    border: `1px solid ${T.border}`, background: T.bg,
                    cursor: 'pointer', textAlign: 'left', width: '100%',
                  }}
                >
                  <span
                    style={{
                      width: 30, height: 30, flexShrink: 0, borderRadius: 9,
                      background: T.bgMuted, color: T.primary,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <FileText size={15} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: 12, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {message.attachmentName ?? 'file'}
                    </strong>
                    <span style={{ fontSize: 11, color: T.textTertiary }}>
                      {message.attachmentMeta ?? 'File'}
                    </span>
                  </span>
                </button>
              ))}
              {fileAttachments.length > FILE_PREVIEW_COUNT ? (
                <button
                  type="button"
                  data-chat-detail-files-view-all
                  onClick={() => setBrowse('files')}
                  style={{
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    color: T.primary, fontSize: T.fontSm, fontWeight: 600,
                    padding: `${T.space1}px 0`, textAlign: 'left',
                  }}
                >
                  View all {fileAttachments.length} files
                </button>
              ) : null}
            </div>
          )}
        </DetailSection>

        {/* === Identity & trust: technical, low-frequency, sits after shared content === */}
        {!isGroup ? (
          <DetailSection title="Identity & trust">
            <div style={{ padding: `${T.space2}px 0` }}>
              <DetailActionRow
                icon={<ShieldCheck size={18} color={conversation.trustTone === 'attention' ? T.warning : T.success} />}
                label={conversation.trustLabel}
              />
              <DetailActionRow
                icon={<ShieldCheck size={18} color={T.success} />}
                label="End-to-end encrypted"
                trailing={(
                  <button
                    type="button"
                    data-chat-open-safety
                    onClick={() => setSafetyOpen(true)}
                    style={{
                      border: 'none', background: 'transparent', cursor: 'pointer',
                      color: T.primary, fontSize: T.fontSm, fontWeight: 600, padding: `${T.space1}px ${T.space2}px`,
                    }}
                  >
                    {conversation.trustTone === 'attention' ? 'Verify' : 'Safety number'}
                  </button>
                )}
              />
              {(conversation.handle || conversation.station || conversation.peerPtid || conversation.federationId) ? (
                <DetailActionRow
                  icon={<Globe size={18} />}
                  label="Network details"
                  trailing={(
                    <button
                      type="button"
                      aria-expanded={technicalOpen}
                      data-chat-network-details-toggle
                      onClick={() => setTechnicalOpen((value) => !value)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 2,
                        border: 'none', background: 'transparent', cursor: 'pointer',
                        color: T.textSecondary, fontSize: T.fontSm, fontWeight: 600,
                        padding: `${T.space1}px ${T.space2}px`,
                      }}
                    >
                      <ChevronDown
                        size={14}
                        style={{ transform: technicalOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
                      />
                    </button>
                  )}
                />
              ) : null}
              {technicalOpen ? (
                <div
                  data-chat-network-details
                  style={{
                    margin: `${T.space1}px ${T.space4}px 0`, padding: T.space3,
                    border: `1px solid ${T.borderSubtle}`, borderRadius: T.radiusMd,
                    background: T.bgSubtle,
                    display: 'flex', flexDirection: 'column', gap: 6,
                    fontSize: T.fontXs, color: T.textSecondary,
                  }}
                >
                  {conversation.handle ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: T.textTertiary }}>Federated handle</span>
                      <span style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{conversation.handle}</span>
                    </div>
                  ) : null}
                  {conversation.station ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: T.textTertiary }}>Home station</span>
                      <span style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{conversation.station}</span>
                    </div>
                  ) : null}
                  {conversation.peerPtid ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: T.textTertiary }}>Actor PTID</span>
                      <span style={{ fontFamily: 'monospace', textAlign: 'right', overflowWrap: 'anywhere' }}>{conversation.peerPtid}</span>
                    </div>
                  ) : null}
                  {conversation.federationId ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: T.textTertiary }}>Federation</span>
                      <span style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{conversation.federationId}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </DetailSection>
        ) : null}

        {/* === Danger Section === */}
        <DetailSection title="Danger zone">
          <DetailActionRow
            icon={<Trash2 size={18} />}
            label="Clear local chat data"
            danger
            trailing={(
              <button
                type="button"
                data-chat-clear-local
                aria-label="Clear local chat data"
                onClick={() => requestConfirm({
                  title: 'Clear local chat data?',
                  body: 'This permanently removes local messages, search entries, and unreferenced media from this device. Other devices and participants are not affected.',
                  confirmLabel: 'Clear local data',
                  danger: true,
                  run: () => onClearHistory(conversation.id),
                })}
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  color: T.textDanger, fontSize: T.fontSm, fontWeight: 700,
                  padding: `${T.space1}px ${T.space2}px`,
                }}
              >
                Clear
              </button>
            )}
          />
          {isGroup ? (
            <DetailActionRow
              icon={isOwner ? <Trash2 size={18} /> : <LogOut size={18} />}
              label={isOwner ? 'Dissolve group' : 'Leave group'}
              danger
              onClick={() => requestConfirm({
                title: isOwner ? 'Dissolve this group?' : 'Leave this group?',
                body: isOwner
                  ? 'Owner-only destructive action. The group disappears for everyone and cannot be recovered.'
                  : 'You will stop receiving messages. Your message history stays visible until cleared.',
                confirmLabel: isOwner ? 'Dissolve' : 'Leave',
                danger: true,
                run: () => onDeleteConversation(conversation.id),
              })}
            />
          ) : (
            <DetailActionRow
              icon={<Trash2 size={18} />}
              label="Delete conversation"
              danger
              onClick={() => requestConfirm({
                title: 'Delete this conversation?',
                body: 'The conversation will be removed from the list. Use Clear history when you only want to hide messages temporarily.',
                confirmLabel: 'Delete',
                danger: true,
                run: () => onDeleteConversation(conversation.id),
              })}
            />
          )}
        </DetailSection>
      </div>
      {memberManagerOpen && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: T.bg,
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              minHeight: 72,
              padding: `${T.space3}px ${T.space4}px`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: `1px solid ${T.border}`,
              gap: T.space3,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: T.fontLg, fontWeight: 800, color: T.text, lineHeight: 1.2 }}>Manage Members</div>
              <div style={{ fontSize: T.fontXs, color: T.textTertiary }}>
                {members.length} members
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: T.space2 }}>
              <button
                title="Close member manager"
                onClick={() => setMemberManagerOpen(false)}
                style={{
                  width: 34,
                  height: 34,
                  border: `1px solid ${T.border}`,
                  borderRadius: T.radiusMd,
                  background: T.bg,
                  cursor: 'pointer',
                  color: T.textSecondary,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <div style={{ padding: T.space4, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: T.space2 }}>
            {canManageMembers ? (
              <div
                style={{
                  border: `1px solid ${T.borderSubtle}`,
                  borderRadius: T.radiusLg,
                  background: T.bgSubtle,
                  padding: T.space3,
                }}
              >
                <div style={{ fontSize: T.fontXs, fontWeight: 800, color: T.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: T.space2 }}>
                  Add members
                </div>
                {inviteCandidates.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {inviteCandidates.map((user) => {
                    const added = justAdded.has(user.id);
                    return (
                      <div
                        key={user.id}
                        data-chat-invite-candidate={user.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '34px minmax(0, 1fr) auto',
                          alignItems: 'center',
                          gap: T.space2,
                          padding: `3px ${T.space2}px`,
                          borderRadius: T.radiusMd,
                        }}
                      >
                        <Avatar name={user.name} size={34} online={user.online} />
                        <span style={{ fontSize: T.fontSm, fontWeight: 700, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {user.name}
                        </span>
                        <button
                          type="button"
                          disabled={added}
                          aria-label={added ? `${user.name} added` : `Add ${user.name}`}
                          onClick={() => addMember(user.id)}
                          style={{
                            width: 30, height: 30, borderRadius: T.radiusMd,
                            border: added ? 'none' : `1px solid ${T.border}`,
                            background: added ? T.success : T.bg,
                            color: added ? T.textOnPrimary : T.primary,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: added ? 'default' : 'pointer', flexShrink: 0,
                          }}
                        >
                          {added ? <Check size={15} /> : <UserPlus size={14} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
                ) : (
                  <div style={{ fontSize: T.fontSm, color: T.textTertiary, padding: `${T.space1}px 0` }}>
                    Everyone you can invite is already in this group.
                  </div>
                )}
              </div>
            ) : null}
            <div
              style={{
                border: `1px solid ${T.borderSubtle}`,
                borderRadius: T.radiusLg,
                background: T.bgSubtle,
                padding: T.space3,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: T.space2, marginBottom: T.space2 }}>
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: T.radiusFull,
                    background: canManageMembers ? 'rgba(107,91,214,0.12)' : T.bgMuted,
                    color: roleColor(currentRole),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {isOwner ? <Crown size={13} /> : isAdmin ? <ShieldCheck size={13} /> : <Users size={13} />}
                </span>
                <span style={{ fontSize: T.fontSm, fontWeight: 800, color: T.text }}>
                  You are {roleLabel(currentRole).toLowerCase()}
                </span>
              </div>
              <div
                style={{
                  height: 34,
                  borderRadius: T.radiusMd,
                  background: T.bg,
                  border: `1px solid ${T.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: T.space2,
                  padding: `0 ${T.space3}px`,
                  color: T.textTertiary,
                }}
              >
                <Search size={14} />
                <input
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="Search members, roles, or ids"
                  style={{
                    flex: 1,
                    border: 'none',
                    background: 'transparent',
                    outline: 'none',
                    color: T.text,
                    fontSize: T.fontSm,
                  }}
                />
              </div>
            </div>
            {filteredMembers.length === 0 && (
              <div
                style={{
                  border: `1px dashed ${T.border}`,
                  borderRadius: T.radiusLg,
                  padding: T.space5,
                  color: T.textTertiary,
                  textAlign: 'center',
                  fontSize: T.fontSm,
                }}
              >
                No members match "{memberSearch}".
              </div>
            )}
            {filteredMembers.map(({ member, user }) => {
              const targetManageable = canManageTarget(member);
              return (
                <div
                  key={member.userId}
                  style={{
                    border: `1px solid ${T.borderSubtle}`,
                    borderRadius: T.radiusMd,
                    padding: `${T.space2}px ${T.space3}px`,
                    background: T.bgSubtle,
                    display: 'grid',
                    gridTemplateColumns: '40px minmax(0, 1fr) auto',
                    alignItems: 'center',
                    gap: T.space3,
                  }}
                >
                  <Avatar name={user.name} size={40} online={user.online} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: T.space2, minWidth: 0 }}>
                      <span style={{ fontSize: T.fontBase, fontWeight: 800, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</span>
                      <span style={{ fontSize: T.fontXs, color: roleColor(member.role), fontWeight: 800, flexShrink: 0 }}>
                        {roleLabel(member.role)}
                      </span>
                      {member.muted && (
                        <span style={{ fontSize: T.fontXs, color: T.warning, fontWeight: 800, flexShrink: 0 }}>Muted</span>
                      )}
                    </div>
                    <div style={{ fontSize: T.fontXs, color: T.textTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {member.userId === currentUserId ? 'You' : `Joined ${Math.round((Date.now() - member.joinedAt) / 3_600_000)}h ago`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: T.space1, justifyContent: 'flex-end', alignItems: 'center' }}>
                    {targetManageable ? (
                      <>
                        <button
                          title={member.muted ? 'Unmute member' : 'Mute member'}
                          onClick={() => onToggleMemberMute(conversation.id, member.userId)}
                          style={managerIconButtonStyle()}
                        >
                          {member.muted ? <Volume2 size={15} /> : <VolumeX size={15} />}
                        </button>
                        {isOwner && (
                          <button
                            title={member.role === 'admin' ? 'Remove admin' : 'Make admin'}
                            onClick={() => onSetMemberRole(
                              conversation.id,
                              member.userId,
                              member.role === 'admin' ? 'member' : 'admin',
                            )}
                            style={managerIconButtonStyle()}
                          >
                            <UserCog size={15} />
                          </button>
                        )}
                        <button
                          title="Kick out"
                          onClick={() => requestConfirm({
                            title: `Remove ${user.name}?`,
                            body: 'This member will lose access to new group messages. Existing local history remains on their device.',
                            confirmLabel: 'Remove',
                            danger: true,
                            run: () => onRemoveMember(conversation.id, member.userId),
                          })}
                          style={managerIconButtonStyle(true)}
                        >
                          <UserMinus size={15} />
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {isOwner && ownerTransferCandidates.length > 0 && (
              <div
                style={{
                  marginTop: T.space2,
                  border: `1px solid ${T.border}`,
                  borderRadius: T.radiusLg,
                  background: T.bg,
                  padding: T.space3,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: T.space2, marginBottom: T.space2 }}>
                  <Crown size={15} color={T.warning} />
                  <div>
                    <div style={{ fontSize: T.fontSm, fontWeight: 800, color: T.text }}>Transfer ownership</div>
                    <div style={{ fontSize: T.fontXs, color: T.textTertiary }}>Owner-only action lives here, not on every member row.</div>
                  </div>
                </div>
                <div style={{ display: 'grid', gap: T.space1 }}>
                  {ownerTransferCandidates.map(({ member, user }) => (
                    <button
                      key={member.userId}
                      title={`Transfer ownership to ${user.name}`}
                      onClick={() => requestConfirm({
                        title: `Transfer ownership to ${user.name}?`,
                        body: 'You will become an admin. Only the new owner can dissolve the group or transfer ownership again.',
                        confirmLabel: 'Transfer',
                        run: () => onTransferOwnership(conversation.id, member.userId),
                      })}
                      style={{
                        height: 34,
                        border: `1px solid ${T.borderSubtle}`,
                        borderRadius: T.radiusMd,
                        background: T.bgSubtle,
                        color: T.text,
                        cursor: 'pointer',
                        display: 'grid',
                        gridTemplateColumns: '1fr auto',
                        alignItems: 'center',
                        gap: T.space2,
                        padding: `0 ${T.space3}px`,
                        textAlign: 'left',
                        fontSize: T.fontSm,
                        fontWeight: 700,
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</span>
                      <Crown size={14} color={T.warning} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {browse && (
        <div
          data-chat-attachment-browser={browse}
          style={{
            position: 'absolute',
            inset: 0,
            background: T.bg,
            zIndex: 12,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              minHeight: T.headerHeight,
              padding: `0 ${T.space4}px`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: `1px solid ${T.border}`,
              gap: T.space3,
              flexShrink: 0,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: T.fontLg, fontWeight: 800, color: T.text, lineHeight: 1.2 }}>
                {browse === 'media' ? 'Shared media' : 'Shared files'}
              </div>
              <div style={{ fontSize: T.fontXs, color: T.textTertiary }}>
                {browse === 'media' ? mediaAttachments.length : fileAttachments.length}
                {' '}item{browse === 'media' && mediaAttachments.length === 1
                  ? ''
                  : browse === 'files' && fileAttachments.length === 1
                    ? ''
                    : 's'}
              </div>
            </div>
            <button
              type="button"
              aria-label="Close attachment browser"
              onClick={() => setBrowse(null)}
              style={{
                width: 34, height: 34,
                border: `1px solid ${T.border}`, borderRadius: T.radiusMd,
                background: T.bg, cursor: 'pointer', color: T.textSecondary,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <X size={18} />
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: T.space4 }}>
            {browse === 'media' ? (
              <>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))',
                    gap: 8,
                  }}
                >
                  {mediaAttachments.slice(0, mediaVisible).map((message) => (
                    <button
                      type="button"
                      key={message.id}
                      data-chat-browser-media={message.id}
                      title={message.attachmentName ?? 'media'}
                      style={{
                        aspectRatio: '1 / 1', borderRadius: T.radiusMd,
                        border: `1px solid ${T.border}`, background: T.bg,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: T.textTertiary, cursor: 'pointer', padding: 0,
                      }}
                    >
                      <Image size={20} />
                    </button>
                  ))}
                </div>
                {mediaVisible < mediaAttachments.length ? (
                  <button
                    type="button"
                    data-chat-browser-load-more="media"
                    onClick={() => setMediaVisible((value) => value + BROWSE_MEDIA_STEP)}
                    style={{
                      width: '100%', marginTop: T.space3, height: 36,
                      border: `1px solid ${T.border}`, borderRadius: T.radiusMd,
                      background: T.bgSubtle, color: T.textSecondary,
                      cursor: 'pointer', fontSize: T.fontSm, fontWeight: 600,
                    }}
                  >
                    Load more ({Math.min(BROWSE_MEDIA_STEP, mediaAttachments.length - mediaVisible)} of{' '}
                    {mediaAttachments.length - mediaVisible})
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {fileAttachments.slice(0, filesVisible).map((message) => (
                    <div
                      key={message.id}
                      data-chat-browser-file={message.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 10px', borderRadius: T.radiusMd,
                        border: `1px solid ${T.border}`, background: T.bg,
                      }}
                    >
                      <span
                        style={{
                          width: 34, height: 34, flexShrink: 0, borderRadius: 9,
                          background: T.bgMuted, color: T.primary,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <FileText size={16} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <strong style={{ display: 'block', fontSize: 13, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {message.attachmentName ?? 'file'}
                        </strong>
                        <span style={{ fontSize: 11, color: T.textTertiary }}>
                          {message.attachmentMeta ?? 'File'}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
                {filesVisible < fileAttachments.length ? (
                  <button
                    type="button"
                    data-chat-browser-load-more="files"
                    onClick={() => setFilesVisible((value) => value + BROWSE_FILES_STEP)}
                    style={{
                      width: '100%', marginTop: T.space3, height: 36,
                      border: `1px solid ${T.border}`, borderRadius: T.radiusMd,
                      background: T.bgSubtle, color: T.textSecondary,
                      cursor: 'pointer', fontSize: T.fontSm, fontWeight: 600,
                    }}
                  >
                    Load more ({Math.min(BROWSE_FILES_STEP, fileAttachments.length - filesVisible)} of{' '}
                    {fileAttachments.length - filesVisible})
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
      {confirmAction && (
        <ConfirmSheet
          title={confirmAction.title}
          body={confirmAction.body}
          confirmLabel={confirmAction.confirmLabel}
          danger={confirmAction.danger}
          onCancel={() => setConfirmAction(null)}
          onConfirm={runConfirmedAction}
        />
      )}
      {safetyOpen && (
        <div
          role="presentation"
          onClick={() => setSafetyOpen(false)}
          style={{
            position: 'absolute', inset: 0, zIndex: 40,
            background: 'rgba(15,23,42,0.34)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Safety number"
            data-chat-safety-dialog
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 320, maxWidth: '100%',
              background: T.bg, borderRadius: 14, border: `1px solid ${T.border}`,
              boxShadow: '0 20px 52px rgba(15,23,42,0.28)', padding: 20,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <strong style={{ fontSize: 15, color: T.text }}>Verify safety number</strong>
              <button
                type="button"
                aria-label="Close safety number"
                onClick={() => setSafetyOpen(false)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: T.textTertiary }}
              >
                <X size={16} />
              </button>
            </div>
            <div
              aria-label="Safety QR code"
              style={{
                width: 132, height: 132, margin: '0 auto 12px', borderRadius: 12,
                border: `1px solid ${T.border}`, background: T.bgSubtle,
                display: 'grid', gridTemplateColumns: 'repeat(10,1fr)', gap: 2, padding: 10,
              }}
            >
              {Array.from({ length: 64 }).map((_, index) => (
                <span
                  key={index}
                  style={{
                    borderRadius: 2,
                    background: (index * 7 + conversation.id.length * 3 + (index % 5)) % 3 === 0 ? T.text : 'transparent',
                  }}
                />
              ))}
            </div>
            <div style={{ fontSize: 11, color: T.textSecondary, lineHeight: 1.6, marginBottom: 10, textAlign: 'center' }}>
              Compare this code and QR with {conversation.name} on another trusted channel. If they match, your messages are end-to-end encrypted.
            </div>
            <code
              style={{
                display: 'block', fontSize: 11, fontFamily: 'monospace', color: T.text,
                background: T.bgSubtle, borderRadius: 8, padding: '8px 10px', marginBottom: 14,
                wordBreak: 'break-all', lineHeight: 1.7,
              }}
            >
              44 812 · 73 009 · 58 441 · 02 917 · 31 660 · 19 284 · 70 552 · 06 138
            </code>
            <button
              type="button"
              data-chat-safety-toggle

              onClick={() => setSafetyVerified((value) => !value)}
              style={{
                width: '100%', height: 38, borderRadius: 10, cursor: 'pointer',
                border: 'none', font: 'inherit', fontSize: 13, fontWeight: 700,
                background: safetyVerified ? T.success : T.primary, color: '#fff',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <ShieldCheck size={15} />
              {safetyVerified ? 'Marked as verified' : 'Mark as verified'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function managerButtonStyle(danger?: boolean): React.CSSProperties {
  return {
    height: 30,
    border: `1px solid ${danger ? 'rgba(229,62,62,0.22)' : T.border}`,
    borderRadius: T.radiusMd,
    background: danger ? T.dangerBg : T.bg,
    color: danger ? T.textDanger : T.text,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: T.space1,
    padding: `0 ${T.space2}px`,
    fontSize: T.fontXs,
    fontWeight: 700,
  };
}

function managerIconButtonStyle(danger?: boolean): React.CSSProperties {
  return {
    width: 30,
    height: 30,
    border: `1px solid ${danger ? 'rgba(229,62,62,0.22)' : T.border}`,
    borderRadius: T.radiusMd,
    background: danger ? T.dangerBg : T.bg,
    color: danger ? T.textDanger : T.textSecondary,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  };
}
