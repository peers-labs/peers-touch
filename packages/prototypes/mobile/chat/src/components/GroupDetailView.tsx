import { useMemo, useState } from 'react';
import { Avatar, Input, Typography } from 'antd';
import { ArrowLeft, Calendar, LogOut, MessageCircle, Search, ShieldCheck, Volume2, VolumeX } from 'lucide-react';
import type { Contact, GroupItem } from '../types';
import { demoContacts } from '../data';
import copy from '../../../../../locales/en/common.json';
import type { PrototypeListMemory } from '../listPresentation';
import { PrototypeListWindow } from './PrototypeListWindow';

const { Text } = Typography;
const defaultMembers = demoContacts.slice(0, 4);
const memberKey = (member: Contact) => member.key;

export function GroupDetailView({
  group, members = defaultMembers, listMemory, sampleOnly = false, onMemberClick, onBack,
}: {
  group: GroupItem;
  members?: Contact[];
  listMemory: PrototypeListMemory;
  sampleOnly?: boolean;
  onMemberClick?: (member: Contact) => void;
  onBack: () => void;
}) {
  const [isMuted, setIsMuted] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const queryKey = `members-query:${group.key}`;
  const [query, setQuery] = useState(() => listMemory.read(queryKey)?.query ?? '');
  const filteredMembers = useMemo(() => {
    const value = query.trim().toLowerCase();
    return members.filter((member) => member.name.toLowerCase().includes(value));
  }, [members, query]);

  return (
    <div className="mp-detail-page" data-prototype-page="group-detail">
      <header className="mp-detail-header">
        <button type="button" className="mp-thread-back" onClick={onBack} aria-label={copy['common.action.back']}>
          <ArrowLeft size={22} />
        </button>
        <h2 className="mp-detail-header-title">{group.name}</h2>
      </header>

      <div className="mp-detail-hero">
        <Avatar size={80} style={{ background: group.avatarGradient, borderRadius: 20 }}>{group.avatar}</Avatar>
        <Text className="mp-detail-hero-name">{group.name}</Text>
        <Text className="mp-detail-hero-sub">{copy['mobile.group.memberCount'].replace('{{count}}', String(group.memberCount))}</Text>
      </div>

      <div className="mp-detail-actions">
        <button type="button" className="mp-detail-action-btn" disabled={sampleOnly}>
          <span className="mp-detail-action-icon"><MessageCircle size={22} /></span>
          <span className="mp-detail-action-label">{copy['mobile.contacts.openChat']}</span>
        </button>
        <button type="button" className="mp-detail-action-btn" disabled={sampleOnly} onClick={() => setIsMuted(!isMuted)}>
          <span className="mp-detail-action-icon">{isMuted ? <Volume2 size={22} /> : <VolumeX size={22} />}</span>
          <span className="mp-detail-action-label">{copy[isMuted ? 'mobile.group.unmuteMember' : 'mobile.chat.quickMute']}</span>
        </button>
        <button type="button" className="mp-detail-action-btn" disabled={sampleOnly} onClick={() => setShowLeaveConfirm(true)}>
          <span className="mp-detail-action-icon" style={{ background: '#ef4444', boxShadow: '0 4px 14px rgba(239,68,68,0.25)' }}><LogOut size={22} /></span>
          <span className="mp-detail-action-label">{copy['mobile.group.leaveGroup']}</span>
        </button>
      </div>
      {sampleOnly && <div className="mp-direct-state" role="status">{copy['mobile.launch.unavailable']}</div>}

      {showLeaveConfirm && (
        <div className="mp-confirm-backdrop" onClick={() => setShowLeaveConfirm(false)}>
          <div className="mp-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="mp-confirm-title">Leave Group?</div>
            <div className="mp-confirm-desc">You will no longer receive messages from {group.name}.</div>
            <div className="mp-confirm-actions">
              <button type="button" className="mp-confirm-btn" onClick={() => setShowLeaveConfirm(false)}>Cancel</button>
              <button type="button" className="mp-confirm-btn mp-confirm-btn--danger" onClick={() => { setShowLeaveConfirm(false); onBack(); }}>Leave</button>
            </div>
          </div>
        </div>
      )}

      <div className="mp-member-list">
        <div className="mp-member-list-title">{copy['mobile.group.members']} ({group.memberCount})</div>
        {sampleOnly && (
          <div className="mp-search-bar">
            <Input prefix={<Search size={16} />} allowClear
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
            role={onMemberClick ? 'button' : undefined} tabIndex={onMemberClick ? 0 : undefined}
            onClick={() => onMemberClick?.(m)} onKeyDown={(event) => {
              if (onMemberClick && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                onMemberClick(m);
              }
            }}>
            <span className="mp-avatar-frame">
              <Avatar size={38} style={{ background: m.avatarGradient, borderRadius: 12 }}>{m.avatar}</Avatar>
              {m.online && <span className="mp-online-dot" />}
            </span>
            <div className="mp-member-info">
              <Text strong style={{ fontSize: 14 }}>{m.name}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>{m.note}</Text>
            </div>
          </div>
          ))}
        </PrototypeListWindow>
        {filteredMembers.length === 0 && (
          <div className="mp-details-empty" role="status">{copy['mobile.group.noMembers']}</div>
        )}
      </div>

      <div className="mp-detail-section">
        <div className="mp-detail-section-title">Group Info</div>
        <div className="mp-detail-row">
          <span className="mp-detail-row-icon" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}><Calendar size={16} /></span>
          <div className="mp-detail-row-content">
            <span className="mp-detail-row-label">Created</span>
            <span className="mp-detail-row-value">January 2025</span>
          </div>
        </div>
        <div className="mp-detail-row">
          <span className="mp-detail-row-icon" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}><ShieldCheck size={16} /></span>
          <div className="mp-detail-row-content">
            <span className="mp-detail-row-label">Encryption</span>
            <span className="mp-detail-row-value">End-to-end encrypted</span>
          </div>
        </div>
      </div>
    </div>
  );
}
