import { useMemo, useState } from 'react';
import { useT } from '../i18n';
import { Icon, Text, TextField } from '@peers-touch/ui';
import type { Contact, GroupItem } from '../types';
import { demoContacts } from '../data';
import type { PrototypeListMemory } from '../listPresentation';
import { PrototypeListWindow } from './PrototypeListWindow';
import { IdentityAvatar } from './IdentityAvatar';

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
  const t = useT();
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
        <button type="button" className="mp-thread-back" onClick={onBack} aria-label={t('common.action.back')}>
          <Icon iconId="arrow-left" size={22} />
        </button>
        <h2 className="mp-detail-header-title">{group.name}</h2>
      </header>

      <div className="mp-detail-hero">
        <IdentityAvatar name={group.name} initials={group.avatar} kind="group" size={64} />
        <Text className="mp-detail-hero-name">{group.name}</Text>
        <Text tone="secondary" className="mp-detail-hero-sub">
          {t('mobile.group.memberCount').replace('{{count}}', String(group.memberCount))}
        </Text>
      </div>

      <div className="mp-detail-actions">
        <button type="button" className="mp-detail-action-btn" disabled={sampleOnly}>
          <span className="mp-detail-action-icon"><Icon iconId="message-circle" size={20} /></span>
          <span className="mp-detail-action-label">{t('mobile.contacts.openChat')}</span>
        </button>
        <button type="button" className="mp-detail-action-btn" disabled={sampleOnly} onClick={() => setIsMuted(!isMuted)}>
          <span className="mp-detail-action-icon"><Icon iconId={isMuted ? 'bell' : 'bell-off'} size={20} /></span>
          <span className="mp-detail-action-label">
            {t(isMuted ? 'mobile.group.unmuteMember' : 'mobile.chat.quickMute')}
          </span>
        </button>
        <button type="button" className="mp-detail-action-btn" disabled={sampleOnly} onClick={() => setShowLeaveConfirm(true)}>
          <span className="mp-detail-action-icon" style={{ color: 'var(--pt-danger)' }}>
            <Icon iconId="log-out" size={20} />
          </span>
          <span className="mp-detail-action-label">{t('mobile.group.leaveGroup')}</span>
        </button>
      </div>
      {sampleOnly && <div className="mp-direct-state" role="status">{t('mobile.launch.unavailable')}</div>}

      {showLeaveConfirm && (
        <div className="mp-confirm-backdrop" onClick={() => setShowLeaveConfirm(false)}>
          <div className="mp-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="mp-confirm-title">{t('mobile.group.leaveTitle')}</div>
            <div className="mp-confirm-desc">You will no longer receive messages from {group.name}.</div>
            <div className="mp-confirm-actions">
              <button type="button" className="mp-confirm-btn" onClick={() => setShowLeaveConfirm(false)}>{t('mobile.chat.cancel')}</button>
              <button type="button" className="mp-confirm-btn mp-confirm-btn--danger" onClick={() => { setShowLeaveConfirm(false); onBack(); }}>{t('mobile.group.leave')}</button>
            </div>
          </div>
        </div>
      )}

      <div className="mp-member-list">
        <div className="mp-member-list-title">
          {t('mobile.group.members')} ({group.memberCount})
        </div>
        {sampleOnly && (
          <div className="mp-search-well">
            <TextField
              aria-label={t('mobile.group.members')}
              placeholder={t('common.action.search')}
              value={query}
              clearable
              onClear={() => {
                setQuery('');
                listMemory.save(queryKey, { query: '' });
              }}
              leading={<Icon iconId="search" size={16} />}
              onValueChange={(value) => {
                setQuery(value);
                listMemory.save(queryKey, { query: value });
              }}
            />
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
              <IdentityAvatar name={m.name} initials={m.avatar} src={m.avatarUrl}
                size={38} online={m.online} showPresence />
              <div className="mp-member-info">
                <Text strong style={{ fontSize: 14 }}>{m.name}</Text>
                <Text tone="secondary" style={{ fontSize: 12 }}>{m.note}</Text>
              </div>
            </div>
          ))}
        </PrototypeListWindow>
        {filteredMembers.length === 0 && (
          <div className="mp-details-empty" role="status">{t('mobile.group.noMembers')}</div>
        )}
      </div>

      <div className="mp-detail-section">
        <div className="mp-detail-section-title">{t('mobile.group.info')}</div>
        <div className="mp-detail-row">
          <span className="mp-detail-row-icon"><Icon iconId="calendar" size={16} /></span>
          <div className="mp-detail-row-content">
            <span className="mp-detail-row-label">{t('mobile.group.created')}</span>
            <span className="mp-detail-row-value">January 2025</span>
          </div>
        </div>
        <div className="mp-detail-row">
          <span className="mp-detail-row-icon"><Icon iconId="shield-check" size={16} /></span>
          <div className="mp-detail-row-content">
            <span className="mp-detail-row-label">{t('mobile.contact.encryption')}</span>
            <span className="mp-detail-row-value">End-to-end encrypted</span>
          </div>
        </div>
      </div>
    </div>
  );
}
