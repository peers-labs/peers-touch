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
  Shield,
  Crown,
  ShieldCheck,
  UserMinus,
  VolumeX,
  Volume2,
  UserCog,
  Upload,
  Search,
  UserPlus,
} from 'lucide-react';
import { T } from '../theme';
import { Avatar } from './Avatar';
import { USERS, type MockConversation, type MockGroupMember, type MockGroupRole, type MockUser } from '../mock';

interface DetailPanelProps {
  conversation: MockConversation;
  currentUserId: string;
  groupMembers: MockGroupMember[];
  onClose: () => void;
  onDeleteConversation: (conversationId: string) => void;
  onClearHistory: (conversationId: string) => void;
  onSelectBackgroundImage: (conversationId: string, file: File) => void;
  onRemoveMember: (conversationId: string, userId: string) => void;
  onRenameGroup: (conversationId: string, name: string) => void;
  onSetMemberRole: (conversationId: string, userId: string, role: MockGroupRole) => void;
  onToggleMemberMute: (conversationId: string, userId: string) => void;
  onTransferOwnership: (conversationId: string, nextOwnerId: string) => void;
}

/**
 * DetailSection — unified section container component.
 * Establishes consistent spacing, radius, and visual rhythm.
 */
function DetailSection({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div style={{ padding: `0 ${T.space4}px`, marginBottom: T.space3 }}>
      {title && (
        <div style={{ fontSize: T.fontSm, fontWeight: 500, color: T.textTertiary, marginBottom: T.space2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {title}
        </div>
      )}
      <div
        style={{
          background: T.bgSubtle,
          borderRadius: T.radiusLg,
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function DetailActionRow({
  icon,
  label,
  trailing,
  danger,
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

function permissionSummary(role: MockGroupRole) {
  if (role === 'owner') {
    return 'Owner can rename the group, update avatar, mute members, set admins, transfer ownership, kick members, and dissolve the group.';
  }
  if (role === 'admin') {
    return 'Admin can update group profile/avatar, mute ordinary members, and kick ordinary members. Admin cannot manage owner/admin roles.';
  }
  return 'Member can view group info, set personal chat background, and leave the group. Member cannot edit group profile or manage other members.';
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

export function DetailPanel({
  conversation,
  currentUserId,
  groupMembers,
  onClose,
  onDeleteConversation,
  onClearHistory,
  onSelectBackgroundImage,
  onRemoveMember,
  onRenameGroup,
  onSetMemberRole,
  onToggleMemberMute,
  onTransferOwnership,
}: DetailPanelProps) {
  const [muted, setMuted] = useState(conversation.muted);
  const [pinned, setPinned] = useState(conversation.pinned);
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

  useEffect(() => {
    setMuted(conversation.muted);
    setPinned(conversation.pinned);
    setEditingName(false);
    setGroupName(conversation.name);
    setMemberManagerOpen(false);
    setConfirmAction(null);
    setBackgroundFileName('');
    setAvatarFileName('');
    setMemberSearch('');
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
      .filter((entry): entry is { member: MockGroupMember; user: MockUser } => Boolean(entry.user)),
    [groupMembers],
  );
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
            <Avatar name={conversation.name} size={72} groupIcon={isGroup} />
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
            <span
              style={{
                fontSize: T.fontSm,
                color: conversation.online === true ? T.success : T.textTertiary,
                marginTop: T.space1,
              }}
            >
              {conversation.online === undefined
                ? 'Presence unavailable'
                : conversation.online ? 'Online' : 'Offline'}
            </span>
          )}
        </div>

        {!isGroup && (
          <DetailSection title="Private chat">
            <div style={{ padding: T.space4, display: 'flex', flexDirection: 'column', gap: T.space3 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: T.space3 }}>
                <ShieldCheck size={18} color={conversation.trustTone === 'attention' ? T.warning : T.success} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: T.fontBase, fontWeight: 700, color: T.text }}>{conversation.trustLabel}</div>
                  <div style={{ fontSize: T.fontSm, color: T.textSecondary, lineHeight: 1.5 }}>
                    Safety details are shown only for direct chats where identity verification changes trust.
                  </div>
                </div>
              </div>
              <button style={managerButtonStyle()}>
                <Shield size={13} />
                {conversation.trustTone === 'attention' ? 'Verify identity' : 'View safety number'}
              </button>
            </div>
          </DetailSection>
        )}

        {/* === Members Section (group only) === */}
        {isGroup && (
          <DetailSection title="Permission">
            <div style={{ padding: T.space4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: T.space2, marginBottom: T.space2 }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: T.space1,
                    padding: `${T.space1}px ${T.space2}px`,
                    borderRadius: T.radiusFull,
                    background: canManageMembers ? 'rgba(107,91,214,0.1)' : T.bg,
                    color: roleColor(currentRole),
                    fontSize: T.fontXs,
                    fontWeight: 800,
                  }}
                >
                  {isOwner ? <Crown size={12} /> : isAdmin ? <ShieldCheck size={12} /> : <Users size={12} />}
                  You are {roleLabel(currentRole)}
                </span>
                <span style={{ fontSize: T.fontXs, color: T.textTertiary }}>
                  Try Engineering Team = owner, Design Review = admin, Peers Touch = member.
                </span>
              </div>
              <div style={{ fontSize: T.fontSm, color: T.textSecondary, lineHeight: 1.5 }}>
                {permissionSummary(currentRole)}
              </div>
            </div>
          </DetailSection>
        )}

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
                            border: `2px solid ${T.bgSubtle}`,
                          }}
                        >
                          {member.role === 'owner' ? <Crown size={9} /> : <ShieldCheck size={9} />}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: T.fontXs, color: T.textTertiary, marginTop: 2, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                      {user.name.split(' ')[0]}
                    </span>
                  </div>
                ))}
                {/* Add member button */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 48 }}>
                  <button
                    type="button"
                    disabled={!canManageMembers}
                    onClick={() => {
                      if (canManageMembers) setMemberManagerOpen(true);
                    }}
                    aria-label={canManageMembers ? 'Invite member' : 'Only owner or admin can invite members'}
                    style={{
                      width: 36, height: 36, borderRadius: T.radiusFull,
                      border: `1.5px dashed ${canManageMembers ? T.textQuaternary : T.border}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: canManageMembers ? T.textTertiary : T.textQuaternary,
                      cursor: canManageMembers ? 'pointer' : 'not-allowed',
                      background: canManageMembers ? 'transparent' : T.bgMuted,
                    }}
                    title={canManageMembers ? 'Invite member' : 'Only owner/admin can invite members'}
                  >
                    <UserPlus size={16} />
                  </button>
                  <span style={{ fontSize: T.fontXs, color: T.textTertiary, marginTop: 2 }}>
                    {canManageMembers ? 'Add' : 'Locked'}
                  </span>
                </div>
              </div>
              <div
                onClick={() => setMemberManagerOpen(true)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: `${T.space2}px 0`, marginTop: T.space2,
                  fontSize: T.fontSm, color: T.primary, cursor: 'pointer',
                }}
              >
                {canManageMembers ? 'Manage' : 'View'} all {members.length} members <ChevronRight size={14} />
              </div>
              {members.length > 8 && (
                <div
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: `${T.space2}px 0`, marginTop: T.space2,
                    fontSize: T.fontSm, color: T.primary, cursor: 'pointer',
                  }}
                >
                  View compact grid <ChevronRight size={14} />
                </div>
              )}
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

        {/* === Security Section === */}
        {!isGroup && (
          <DetailSection title="Security">
            <DetailActionRow
              icon={<Shield size={18} />}
              label="End-to-end encrypted"
              trailing={<span style={{ fontSize: T.fontSm, color: T.success }}>Active</span>}
            />
          </DetailSection>
        )}

        {/* === Danger Section === */}
        <DetailSection title="Danger zone">
          <div style={{ padding: T.space4, borderBottom: `1px solid ${T.borderSubtle}` }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: T.space3 }}>
              <span style={{ display: 'flex', color: T.textDanger, marginTop: 2 }}>
                <Trash2 size={18} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: T.fontBase, fontWeight: 700, color: T.text }}>
                  Clear local chat data
                </div>
                <div style={{ fontSize: T.fontSm, color: T.textSecondary, lineHeight: 1.5, marginTop: T.space1 }}>
                  Permanently removes local messages, search entries, and unreferenced media from this device.
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: T.space2, marginTop: T.space3 }}>
              <button
                onClick={() => requestConfirm({
                  title: 'Clear local chat data?',
                  body: 'This permanently removes local data from this device. Other devices and participants are not affected.',
                  confirmLabel: 'Clear local data',
                  danger: true,
                  run: () => onClearHistory(conversation.id),
                })}
                style={historyActionButtonStyle(true)}
              >
                <Trash2 size={13} />
                Clear
              </button>
            </div>
          </div>
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
                {roleLabel(currentRole)} permissions · {members.length} members
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: T.space2 }}>
              {canManageMembers && (
                <button
                  title="Invite members"
                  onClick={() => requestConfirm({
                    title: 'Invite members?',
                    body: 'Production should open a contact picker, then show selected people and role impact before sending invites.',
                    confirmLabel: 'Open picker',
                    run: () => {},
                  })}
                  style={managerToolbarButtonStyle()}
                >
                  <UserPlus size={15} />
                  Invite
                </button>
              )}
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
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: T.fontSm, fontWeight: 800, color: T.text }}>
                    {canManageMembers ? 'Management mode' : 'View-only mode'}
                  </div>
                  <div style={{ fontSize: T.fontXs, color: T.textSecondary, lineHeight: 1.45 }}>
                    {permissionSummary(currentRole)}
                  </div>
                </div>
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
                    ) : (
                      <span style={{ fontSize: T.fontXs, color: T.textTertiary }}>
                        {member.userId === currentUserId
                          ? 'Self actions live in Danger Zone.'
                          : canManageMembers
                            ? 'Higher role; no management action.'
                            : 'View only. Ask an owner/admin to manage members.'}
                      </span>
                    )}
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

function managerToolbarButtonStyle(): React.CSSProperties {
  return {
    height: 34,
    border: `1px solid ${T.border}`,
    borderRadius: T.radiusMd,
    background: T.bg,
    color: T.text,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: T.space1,
    padding: `0 ${T.space3}px`,
    fontSize: T.fontSm,
    fontWeight: 800,
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

function historyActionButtonStyle(danger?: boolean): React.CSSProperties {
  return {
    height: 30,
    border: `1px solid ${danger ? 'rgba(229,62,62,0.22)' : T.border}`,
    borderRadius: T.radiusMd,
    background: danger ? T.dangerBg : T.bg,
    color: danger ? T.textDanger : T.text,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: T.space1,
    padding: `0 ${T.space3}px`,
    fontSize: T.fontXs,
    fontWeight: 800,
  };
}
