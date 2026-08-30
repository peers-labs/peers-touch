import { Avatar, Typography } from 'antd';
import {
  ArrowLeft, Ban, Calendar, Fingerprint, Mail as MailIcon,
  MessageCircle, Phone, Server, ShieldCheck, Trash2, Video,
} from 'lucide-react';
import type { Contact } from '../types';

const { Text } = Typography;

export function ContactDetailView({ contact, onBack, onMessage }: { contact: Contact; onBack: () => void; onMessage?: (contact: Contact) => void }) {
  return (
    <div className="mp-detail-page">
      <header className="mp-detail-header">
        <button type="button" className="mp-thread-back" onClick={onBack} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <h2 className="mp-detail-header-title">{contact.name}</h2>
      </header>

      <div className="mp-detail-hero">
        <Avatar size={80} style={{ background: contact.avatarGradient, borderRadius: 20 }}>{contact.avatar}</Avatar>
        <Text className="mp-detail-hero-name">{contact.name}</Text>
        <Text className="mp-detail-hero-sub">{contact.note}</Text>
        {contact.online
          ? <span className="mp-detail-online-badge">Online</span>
          : <span className="mp-detail-offline-badge">Offline</span>
        }
        <span className="mp-detail-station-tag"><Server size={11} /> local.station</span>
        <button type="button" className="mp-safety-number-btn">
          <Fingerprint size={14} />
          <span>Safety Number</span>
        </button>
      </div>

      <div className="mp-detail-actions">
        <button type="button" className="mp-detail-action-btn" onClick={() => onMessage?.(contact)}>
          <span className="mp-detail-action-icon"><MessageCircle size={22} /></span>
          <span className="mp-detail-action-label">Message</span>
        </button>
        <button type="button" className="mp-detail-action-btn" disabled>
          <span className="mp-detail-action-icon"><Phone size={22} /></span>
          <span className="mp-detail-action-label">Audio</span>
        </button>
        <button type="button" className="mp-detail-action-btn" disabled>
          <span className="mp-detail-action-icon"><Video size={22} /></span>
          <span className="mp-detail-action-label">Video</span>
        </button>
      </div>

      <div className="mp-detail-section">
        <div className="mp-detail-section-title">Info</div>
        <div className="mp-detail-row">
          <span className="mp-detail-row-icon" style={{ background: 'rgba(14,165,233,0.1)', color: '#0ea5e9' }}><MailIcon size={16} /></span>
          <div className="mp-detail-row-content">
            <span className="mp-detail-row-label">Email</span>
            <span className="mp-detail-row-value">{contact.key}@peers.social</span>
          </div>
        </div>
        <div className="mp-detail-row">
          <span className="mp-detail-row-icon" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}><Calendar size={16} /></span>
          <div className="mp-detail-row-content">
            <span className="mp-detail-row-label">Joined</span>
            <span className="mp-detail-row-value">March 2025</span>
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

      <div className="mp-detail-danger-zone">
        <button type="button" className="mp-detail-danger-btn"><Ban size={16} /> Block Contact</button>
        <button type="button" className="mp-detail-danger-btn"><Trash2 size={16} /> Remove Contact</button>
      </div>
    </div>
  );
}
