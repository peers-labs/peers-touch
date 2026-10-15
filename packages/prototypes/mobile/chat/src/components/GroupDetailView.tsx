import { useMemo, useState } from 'react';
import { Input, Typography } from 'antd';
import {
  ArrowLeft,
  Calendar,
  Crown,
  LogOut,
  MessageCircle,
  Search,
  ShieldCheck,
  UserMinus,
  UserRoundCog,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { Contact, GroupItem } from '../types';
import { demoContacts } from '../data';
import copy from '../../../../../locales/en/common.json';
import type { PrototypeListMemory } from '../listPresentation';
import { PrototypeListWindow } from './PrototypeListWindow';
import { IdentityAvatar } from './IdentityAvatar';
import { AccessibleClearIcon } from './AccessibleClearIcon';
import { ConfirmationDialog } from './ConfirmationDialog';

const { Text } = Typography;
const defaultMembers = demoContacts.slice(0, 4);
const memberKey = (member: Contact) => member.key;

export function GroupDetailView({
  group, members = defaultMembers, listMemory, sampleOnly = false,
  onMemberClick, onOpenChat, onExit, onBack,
}: {
  group: GroupItem;
  members?: Contact[];
  listMemory: PrototypeListMemory;
  sampleOnly?: boolean;
  onMemberClick?: (member: Contact) => void;
  onOpenChat?: (group: GroupItem) => void;
  onExit?: (group: GroupItem) => void;
  onBack: () => void;
}) {
  const [isMuted, setIsMuted] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Contact | null>(null);
  const [moderationNotice, setModerationNotice] = useState('');
  const [managedMembers, setManagedMembers] = useState(members);
  const [memberStates, setMemberStates] = useState<Record<string, 'Admin' | 'Muted'>>({});
  const canModerate = Boolean(group.canModerate && !sampleOnly);
  const exitLabel = group.isOwner && !sampleOnly ? 'Dissolve Group' : copy['mobile.group.leaveGroup'];
  const queryKey = `members-query:${group.key}`;
  const [query, setQuery] = useState(() => listMemory.read(queryKey)?.query ?? '');
  const filteredMembers = useMemo(() => {
    const value = query.trim().toLowerCase();
    return managedMembers.filter((member) => member.name.toLowerCase().includes(value));
  }, [managedMembers, query]);

  return (
    <div className="mp-detail-page" data-prototype-page="group-detail">
      <header className="mp-detail-header">
        <button type="button" className="mp-thread-back" onClick={onBack} aria-label={copy['common.action.back']}>
          <ArrowLeft size={22} />
        </button>
        <h2 className="mp-detail-header-title">{group.name}</h2>
      </header>

      <div className="mp-detail-hero">
        <IdentityAvatar name={group.name} initials={group.avatar} kind="group" size={80} />
        <Text className="mp-detail-hero-name">{group.name}</Text>
        <Text className="mp-detail-hero-sub">{copy['mobile.group.memberCount'].replace('{{count}}', String(group.memberCount))}</Text>
      </div>

      <div className="mp-detail-actions">
        <button type="button" className="mp-detail-action-btn" disabled={sampleOnly || !onOpenChat}
          onClick={() => onOpenChat?.(group)}>
          <span className="mp-detail-action-icon"><MessageCircle size={22} /></span>
          <span className="mp-detail-action-label">{copy['mobile.contacts.openChat']}</span>
        </button>
        <button type="button" className="mp-detail-action-btn" disabled={sampleOnly} onClick={() => setIsMuted(!isMuted)}>
          <span className="mp-detail-action-icon">{isMuted ? <Volume2 size={22} /> : <VolumeX size={22} />}</span>
          <span className="mp-detail-action-label">{copy[isMuted ? 'mobile.group.unmuteMember' : 'mobile.chat.quickMute']}</span>
        </button>
        <button type="button" className="mp-detail-action-btn" disabled={sampleOnly} onClick={() => setShowLeaveConfirm(true)}>
          <span className="mp-detail-action-icon danger"><LogOut size={22} /></span>
          <span className="mp-detail-action-label">{exitLabel}</span>
        </button>
      </div>
      {sampleOnly && <div className="mp-direct-state" role="status">{copy['mobile.launch.unavailable']}</div>}

      {showLeaveConfirm && (
        <ConfirmationDialog
          title={group.isOwner && !sampleOnly ? 'Dissolve Group?' : 'Leave Group?'}
          description={group.isOwner && !sampleOnly
            ? `${group.name} will be removed for every member.`
            : `You will no longer receive messages from ${group.name}.`}
          confirmLabel={group.isOwner && !sampleOnly ? 'Dissolve' : 'Leave'}
          onCancel={() => setShowLeaveConfirm(false)}
          onConfirm={() => {
            setShowLeaveConfirm(false);
            onExit?.(group);
            onBack();
          }}
        />
      )}

      <div className="mp-member-list">
        <div className="mp-member-list-title">{copy['mobile.group.members']} ({group.memberCount})</div>
        {sampleOnly && (
          <div className="mp-search-bar">
            <Input prefix={<Search size={16} />}
              allowClear={{ clearIcon: <AccessibleClearIcon label="Clear member search" /> }}
              aria-label={copy['mobile.group.members']} placeholder={copy['common.action.search']}
              value={query} onChange={(event) => {
                setQuery(event.target.value);
                listMemory.save(queryKey, { query: event.target.value });
              }} />
          </div>
        )}
        <PrototypeListWindow items={filteredMembers} itemKey={memberKey}
          surfaceKey={`members:${group.key}:${query.trim().toLowerCase()}`} memory={listMemory}>
          {(window) => window.map((m) => (
          <div key={m.key} className="mp-member-item" data-scroll-anchor-id={m.key}
            role={onMemberClick || canModerate ? 'button' : undefined}
            tabIndex={onMemberClick || canModerate ? 0 : undefined}
            onClick={() => {
              if (canModerate) setSelectedMember(m);
              else onMemberClick?.(m);
            }} onKeyDown={(event) => {
              if ((onMemberClick || canModerate) && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                if (canModerate) setSelectedMember(m);
                else onMemberClick?.(m);
              }
            }}>
            <IdentityAvatar name={m.name} initials={m.avatar} src={m.avatarUrl}
              size={38} online={m.online} showPresence />
            <div className="mp-member-info">
              <Text strong style={{ fontSize: 14 }}>{m.name}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {m.note}{memberStates[m.key] ? ` · ${memberStates[m.key]}` : ''}
              </Text>
            </div>
          </div>
          ))}
        </PrototypeListWindow>
        {filteredMembers.length === 0 && (
          <div className="mp-details-empty" role="status">{copy['mobile.group.noMembers']}</div>
        )}
      </div>

      {canModerate && (
        <section className="mp-detail-section mp-group-admin">
          <div className="mp-detail-section-title">Group administration</div>
          <div className="mp-group-admin-copy">
            <Text strong>{selectedMember ? selectedMember.name : 'Select a member'}</Text>
            <Text type="secondary">
              {selectedMember
                ? 'Moderation actions apply to this group only.'
                : 'Tap a member above to manage their group role.'}
            </Text>
          </div>
          <div className="mp-group-admin-actions">
            <button type="button" disabled={!selectedMember} onClick={() => {
              if (!selectedMember) return;
              const wasMuted = memberStates[selectedMember.key] === 'Muted';
              setMemberStates((current) => {
                const next = { ...current };
                if (wasMuted) delete next[selectedMember.key];
                else next[selectedMember.key] = 'Muted';
                return next;
              });
              setModerationNotice(`${selectedMember.name} ${wasMuted ? 'unmuted' : 'muted'} in this group`);
              setSelectedMember(null);
            }}>
              {selectedMember && memberStates[selectedMember.key] === 'Muted' ? <Volume2 size={16} /> : <VolumeX size={16} />}
              {selectedMember && memberStates[selectedMember.key] === 'Muted' ? 'Unmute' : 'Mute'}
            </button>
            <button type="button" disabled={!selectedMember} onClick={() => {
              if (!selectedMember) return;
              const wasAdmin = memberStates[selectedMember.key] === 'Admin';
              setMemberStates((current) => {
                const next = { ...current };
                if (wasAdmin) delete next[selectedMember.key];
                else next[selectedMember.key] = 'Admin';
                return next;
              });
              setModerationNotice(`${selectedMember.name} ${wasAdmin ? 'is now a member' : 'promoted to admin'}`);
              setSelectedMember(null);
            }}>
              <UserRoundCog size={16} />
              {selectedMember && memberStates[selectedMember.key] === 'Admin' ? 'Demote' : 'Promote'}
            </button>
            <button type="button" className="danger" disabled={!selectedMember} onClick={() => {
              if (selectedMember) {
                setManagedMembers((current) => current.filter((member) => member.key !== selectedMember.key));
              }
              setModerationNotice(`${selectedMember?.name} removed from the group`);
              setSelectedMember(null);
            }}>
              <UserMinus size={16} /> Remove
            </button>
          </div>
          {group.isOwner && (
            <button type="button" className="mp-group-transfer" disabled={!selectedMember} onClick={() => {
              if (!selectedMember) return;
              setMemberStates((current) => ({ ...current, [selectedMember.key]: 'Admin' }));
              setModerationNotice(`Ownership transfer to ${selectedMember.name} is ready for confirmation`);
              setSelectedMember(null);
            }}>
              <Crown size={15} /> Transfer ownership
            </button>
          )}
          {moderationNotice && <div className="mp-group-admin-notice" role="status">{moderationNotice}</div>}
        </section>
      )}

      <div className="mp-detail-section">
        <div className="mp-detail-section-title">Group Info</div>
        <div className="mp-detail-row">
          <span className="mp-detail-row-icon tone-warning"><Calendar size={16} /></span>
          <div className="mp-detail-row-content">
            <span className="mp-detail-row-label">Created</span>
            <span className="mp-detail-row-value">January 2025</span>
          </div>
        </div>
        <div className="mp-detail-row">
          <span className="mp-detail-row-icon tone-success"><ShieldCheck size={16} /></span>
          <div className="mp-detail-row-content">
            <span className="mp-detail-row-label">Encryption</span>
            <span className="mp-detail-row-value">End-to-end encrypted</span>
          </div>
        </div>
      </div>
    </div>
  );
}
