import { Button, Icon, Spin, Text } from '@peers-touch/ui';
import type { Contact } from '../types';
import copy from '../../../../../locales/en/common.json';
import { IdentityAvatar } from './IdentityAvatar';

export function ContactDetailView({
  contact, onBack, onMessage, directStatus, canMessage = true,
  messageUnavailableText = copy['mobile.contacts.federationRequired'],
}: {
  contact: Contact;
  onBack: () => void;
  onMessage?: (contact: Contact) => void;
  directStatus?: 'preparing' | 'failed' | 'ready';
  canMessage?: boolean;
  messageUnavailableText?: string;
}) {
  const preparing = directStatus === 'preparing';
  return (
    <div className="mp-detail-page">
      <header className="mp-detail-header">
        <button type="button" className="mp-thread-back" onClick={onBack} aria-label="Back">
          <Icon iconId="arrow-left" size={22} />
        </button>
        <h2 className="mp-detail-header-title">{contact.name}</h2>
      </header>

      <div className="mp-detail-hero">
        <IdentityAvatar name={contact.name} initials={contact.avatar}
          src={contact.avatarUrl} size={64} />
        <Text className="mp-detail-hero-name">{contact.name}</Text>
        <Text tone="secondary" className="mp-detail-hero-sub">{contact.note}</Text>
        {contact.online
          ? <span className="mp-detail-online-badge">Online</span>
          : <span className="mp-detail-offline-badge">Offline</span>}
        <span className="mp-detail-station-tag"><Icon iconId="server" size={11} /> local.station</span>
      </div>

      <div className="mp-detail-actions">
        <button type="button" className="mp-detail-action-btn"
          disabled={preparing || !canMessage} onClick={() => onMessage?.(contact)}>
          <span className="mp-detail-action-icon"><Icon iconId="message-circle" size={20} /></span>
          <span className="mp-detail-action-label">{copy['mobile.contacts.openChat']}</span>
        </button>
        <button type="button" className="mp-detail-action-btn" disabled>
          <span className="mp-detail-action-icon"><Icon iconId="phone" size={20} /></span>
          <span className="mp-detail-action-label">Audio</span>
        </button>
        <button type="button" className="mp-detail-action-btn" disabled>
          <span className="mp-detail-action-icon"><Icon iconId="video" size={20} /></span>
          <span className="mp-detail-action-label">Video</span>
        </button>
      </div>

      {(preparing || directStatus === 'failed' || !canMessage) && (
        <section className="mp-direct-state" role="status" aria-busy={preparing}
          data-demo-direct-status={directStatus ?? 'unavailable'}>
          {preparing && <Spin size="small" label={copy['common.state.loading']} />}
          <Text tone="secondary" className="mp-recovery-description">
            {!canMessage ? messageUnavailableText
              : copy[preparing ? 'mobile.contacts.conversationPreparing'
              : 'mobile.contacts.openChatFailed']}
          </Text>
          {directStatus === 'failed' && canMessage && (
            <Button actionId="contact-detail.retry" density="compact"
              onActivate={() => onMessage?.(contact)}>{copy['common.action.retry']}</Button>
          )}
        </section>
      )}

      <div className="mp-detail-section">
        <div className="mp-detail-section-title">Info</div>
        <div className="mp-detail-row">
          <span className="mp-detail-row-icon"><Icon iconId="mail" size={16} /></span>
          <div className="mp-detail-row-content">
            <span className="mp-detail-row-label">Email</span>
            <span className="mp-detail-row-value">{contact.key}@peers.social</span>
          </div>
        </div>
        <div className="mp-detail-row">
          <span className="mp-detail-row-icon"><Icon iconId="calendar" size={16} /></span>
          <div className="mp-detail-row-content">
            <span className="mp-detail-row-label">Joined</span>
            <span className="mp-detail-row-value">March 2025</span>
          </div>
        </div>
        <div className="mp-detail-row">
          <span className="mp-detail-row-icon"><Icon iconId="shield-check" size={16} /></span>
          <div className="mp-detail-row-content">
            <span className="mp-detail-row-label">Encryption</span>
            <span className="mp-detail-row-value">End-to-end encrypted</span>
          </div>
        </div>
      </div>

      <div className="mp-detail-danger-zone">
        <button type="button" className="mp-detail-danger-btn"><Icon iconId="ban" size={16} /> Block Contact</button>
      </div>
    </div>
  );
}
