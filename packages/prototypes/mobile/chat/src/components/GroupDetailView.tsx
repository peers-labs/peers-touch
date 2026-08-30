import { useState } from 'react';
import { Avatar, Typography } from 'antd';
import { ArrowLeft, Calendar, LogOut, MessageCircle, ShieldCheck, Volume2, VolumeX } from 'lucide-react';
import type { GroupItem } from '../types';
import { demoContacts } from '../data';

const { Text } = Typography;

export function GroupDetailView({ group, onBack }: { group: GroupItem; onBack: () => void }) {
  const members = demoContacts.slice(0, 4);
  const [isMuted, setIsMuted] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  return (
    <div className="mp-detail-page">
      <header className="mp-detail-header">
        <button type="button" className="mp-thread-back" onClick={onBack} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <h2 className="mp-detail-header-title">{group.name}</h2>
      </header>

      <div className="mp-detail-hero">
        <Avatar size={80} style={{ background: group.avatarGradient, borderRadius: 20 }}>{group.avatar}</Avatar>
        <Text className="mp-detail-hero-name">{group.name}</Text>
        <Text className="mp-detail-hero-sub">{group.memberCount} members</Text>
      </div>

      <div className="mp-detail-actions">
        <button type="button" className="mp-detail-action-btn">
          <span className="mp-detail-action-icon"><MessageCircle size={22} /></span>
          <span className="mp-detail-action-label">Message</span>
        </button>
        <button type="button" className="mp-detail-action-btn" onClick={() => setIsMuted(!isMuted)}>
          <span className="mp-detail-action-icon">{isMuted ? <Volume2 size={22} /> : <VolumeX size={22} />}</span>
          <span className="mp-detail-action-label">{isMuted ? 'Unmute' : 'Mute'}</span>
        </button>
        <button type="button" className="mp-detail-action-btn" onClick={() => setShowLeaveConfirm(true)}>
          <span className="mp-detail-action-icon" style={{ background: '#ef4444', boxShadow: '0 4px 14px rgba(239,68,68,0.25)' }}><LogOut size={22} /></span>
          <span className="mp-detail-action-label">Leave</span>
        </button>
      </div>

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
        <div className="mp-member-list-title">Members ({group.memberCount})</div>
        {members.map((m) => (
          <div key={m.key} className="mp-member-item">
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
