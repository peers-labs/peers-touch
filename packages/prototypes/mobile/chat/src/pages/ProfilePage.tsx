import { useState } from 'react';
import { Card, Typography } from 'antd';
import {
  Ban, Bell, ChevronRight, Fingerprint, Globe,
  Image as ImageIcon, MessageCircle, Server,
  Settings as SettingsIcon, Shield, ShieldCheck, User,
} from 'lucide-react';
import type { SettingEntry, SettingGroup } from '../types';
import { GRADIENTS } from '../types';
import { PersonAvatar } from '../components/PersonAvatar';
import copy from '../../../../../locales/en/common.json';

const { Text } = Typography;

export function ProfilePage({ onChangeStation, onSettingClick }: { onChangeStation: () => void; onSettingClick: (s: SettingEntry) => void }) {
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const settingGroups: SettingGroup[] = [
    {
      title: 'Account',
      items: [
        { id: 'account-info', label: 'Account Info', icon: User, tint: '#6366f1' },
        { id: 'notifications', label: 'Notifications', value: 'Allowed', icon: Bell, tint: '#f59e0b' },
        { id: 'privacy-security', label: 'Privacy & Security', icon: Shield, tint: '#22c55e' },
        { id: 'safety-number', label: 'Safety Number', value: 'Unavailable', icon: Fingerprint, tint: '#0ea5e9' },
        { id: 'blocked-users', label: 'Blocked Users', value: '2', icon: Ban, tint: '#ef4444' },
      ],
    },
    {
      title: 'Chat',
      items: [
        { id: 'chat-settings', label: 'Chat Settings', icon: MessageCircle, tint: '#6366f1' },
        { id: 'chat-background', label: 'Chat Background', value: 'Unavailable', icon: ImageIcon, tint: '#ec4899' },
      ],
    },
    {
      title: 'Network',
      items: [
        { id: 'station-connection', label: 'Station Connection', value: 'Product Station', icon: Server, tint: '#22c55e' },
        { id: 'encryption', label: 'Encryption', value: 'Unavailable', icon: ShieldCheck, tint: '#6366f1' },
        { id: 'language', label: 'Language', value: 'English', icon: Globe, tint: '#0ea5e9' },
      ],
    },
    {
      title: 'About',
      items: [
        { id: 'about', label: 'About Peers Touch', value: 'v1.0.0', icon: ShieldCheck, tint: '#f59e0b' },
      ],
    },
  ];

  return (
    <div className="mp-page">
      <header className="mp-header">
        <h1 className="mp-header-title">Me</h1>
        <button type="button" className="mp-header-action" aria-label="Settings" onClick={() => onSettingClick({ id: 'account-info', label: 'Account Info', icon: User, tint: '#6366f1' })}>
          <SettingsIcon size={20} />
        </button>
      </header>

      <div className="mp-profile-body">
        <button
          type="button"
          className="mp-profile-trigger"
          onClick={() => onSettingClick(settingGroups[0]!.items[0]!)}
        >
          <Card className="mp-profile-header-card" variant="borderless">
            <div className="mp-profile-header">
              <PersonAvatar background={GRADIENTS[0]} name="Alice Chen" size={64} />
              <div className="mp-profile-info">
                <Text strong className="mp-profile-name">Alice Chen</Text>
                <Text type="secondary" className="mp-profile-subtitle">Connected to Product Station</Text>
              </div>
              <ChevronRight size={20} color="#9ca0ab" />
            </div>
            <div className="mp-profile-stats">
              <div className="mp-stat"><Text strong className="mp-stat-value">128</Text><Text type="secondary" className="mp-stat-label">Friends</Text></div>
              <div className="mp-stat-divider" />
              <div className="mp-stat"><Text strong className="mp-stat-value">12</Text><Text type="secondary" className="mp-stat-label">Groups</Text></div>
              <div className="mp-stat-divider" />
              <div className="mp-stat"><Text strong className="mp-stat-value">34</Text><Text type="secondary" className="mp-stat-label">Moments</Text></div>
            </div>
          </Card>
        </button>

        {settingGroups.map((group) => (
          <div key={group.title} className="mp-settings-group">
            <div className="mp-settings-group-title">{group.title}</div>
            <Card className="mp-settings-card" variant="borderless">
              {group.items.map((item, idx) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    className={`mp-setting-row ${idx > 0 ? 'mp-setting-row--border' : ''}`}
                    onClick={() => onSettingClick(item)}
                  >
                    <span className="mp-setting-icon" style={{ backgroundColor: `${item.tint}14`, color: item.tint }}>
                      <Icon size={17} />
                    </span>
                    <Text className="mp-setting-label">{item.label}</Text>
                    {item.value && <Text type="secondary" className="mp-setting-value">{item.value}</Text>}
                    <ChevronRight size={17} color="#c1c4cc" />
                  </button>
                );
              })}
            </Card>
          </div>
        ))}

        <button type="button" className="mp-sign-out" onClick={() => setLogoutConfirmOpen(true)}>Sign Out</button>
      </div>
      {logoutConfirmOpen ? (
        <div className="mp-confirm-backdrop" onClick={() => setLogoutConfirmOpen(false)}>
          <section
            className="mp-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-logout-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="mp-confirm-title" id="profile-logout-title">
              {copy['mobile.settings.station.logoutConfirmTitle']}
            </h2>
            <p className="mp-confirm-desc">
              {copy['mobile.settings.station.logoutConfirmBody']}
            </p>
            <div className="mp-confirm-actions">
              <button type="button" className="mp-confirm-btn" onClick={() => setLogoutConfirmOpen(false)}>
                {copy['common.action.cancel']}
              </button>
              <button type="button" className="mp-confirm-btn mp-confirm-btn--danger" onClick={onChangeStation}>
                {copy['mobile.settings.logout']}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
