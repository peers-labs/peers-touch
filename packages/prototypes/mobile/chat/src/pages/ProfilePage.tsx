import { useState } from 'react';
import { Typography } from 'antd';
import {
  Ban, Bell, ChevronRight, Fingerprint, Globe,
  Image as ImageIcon, MessageCircle, Server,
  Settings as SettingsIcon, Shield, ShieldCheck, User,
} from 'lucide-react';
import type { SettingEntry, SettingGroup } from '../types';
import copy from '../../../../../locales/en/common.json';
import type { AvatarRenderState } from '../types';
import { demoAvatarUrls } from '../data';
import { IdentityAvatar } from '../components/IdentityAvatar';

const { Text } = Typography;

export function ProfilePage({ avatarState, onChangeStation, onSettingClick }: {
  avatarState: AvatarRenderState;
  onChangeStation: () => void;
  onSettingClick: (s: SettingEntry) => void;
}) {
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const settingGroups: SettingGroup[] = [
    {
      title: 'Account',
      items: [
        { id: 'account-info', label: 'Account Info', icon: User, tint: 'primary' },
        { id: 'notifications', label: 'Notifications', value: 'In-app', icon: Bell, tint: 'warning' },
        { id: 'privacy-security', label: 'Privacy & Security', icon: Shield, tint: 'success' },
        { id: 'safety-number', label: 'Safety Number', value: 'Unavailable', icon: Fingerprint, tint: 'primary' },
        { id: 'blocked-users', label: 'Blocked Users', value: '2', icon: Ban, tint: 'danger' },
      ],
    },
    {
      title: 'Chat',
      items: [
        { id: 'chat-settings', label: 'Chat Settings', icon: MessageCircle, tint: 'primary' },
        { id: 'chat-background', label: 'Chat Background', value: 'Unavailable', icon: ImageIcon, tint: 'neutral' },
      ],
    },
    {
      title: 'Network',
      items: [
        { id: 'station-connection', label: 'Station Connection', value: 'Product Station', icon: Server, tint: 'success' },
        { id: 'encryption', label: 'Encryption', value: 'Active', icon: ShieldCheck, tint: 'primary' },
        { id: 'language', label: 'Language', value: 'English', icon: Globe, tint: 'neutral' },
      ],
    },
    {
      title: 'About',
      items: [
        { id: 'about', label: 'About Peers Touch', value: 'v1.0.0', icon: ShieldCheck, tint: 'neutral' },
      ],
    },
  ];

  return (
    <div className="mp-page">
      <header className="mp-header">
        <h1 className="mp-header-title">Me</h1>
        <button type="button" className="mp-header-action" aria-label="Settings" onClick={() => onSettingClick({ id: 'account-info', label: 'Account Info', icon: User, tint: 'primary' })}>
          <SettingsIcon size={20} />
        </button>
      </header>

      <div className="mp-profile-body">
        <button
          type="button"
          className="mp-profile-trigger"
          onClick={() => onSettingClick(settingGroups[0]!.items[0]!)}
        >
          <section className="mp-profile-header-card">
          <div className="mp-profile-header">
            <IdentityAvatar name="Alice Chen" initials="AC" src={demoAvatarUrls.alice}
              size={64} renderState={avatarState} />
            <div className="mp-profile-info">
              <Text strong className="mp-profile-name">Alice Chen</Text>
              <Text type="secondary" className="mp-profile-did">Local identity · Local Station</Text>
            </div>
            <ChevronRight size={20} className="mp-row-chevron" />
          </div>
          <div className="mp-profile-stats">
            <div className="mp-stat"><Text strong className="mp-stat-value">128</Text><Text type="secondary" className="mp-stat-label">Friends</Text></div>
            <div className="mp-stat-divider" />
            <div className="mp-stat"><Text strong className="mp-stat-value">12</Text><Text type="secondary" className="mp-stat-label">Groups</Text></div>
            <div className="mp-stat-divider" />
            <div className="mp-stat"><Text strong className="mp-stat-value">34</Text><Text type="secondary" className="mp-stat-label">Moments</Text></div>
          </div>
          </section>
        </button>

        {settingGroups.map((group) => (
          <div key={group.title} className="mp-settings-group">
            <div className="mp-settings-group-title">{group.title}</div>
            <div className="mp-settings-card">
              {group.items.map((item, idx) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    className={`mp-setting-row ${idx > 0 ? 'mp-setting-row--border' : ''}`}
                    onClick={() => onSettingClick(item)}
                  >
                    <span className={`mp-setting-icon tone-${item.tint}`}>
                      <Icon size={17} />
                    </span>
                    <Text className="mp-setting-label">{item.label}</Text>
                    {item.value && <Text type="secondary" className="mp-setting-value">{item.value}</Text>}
                    <ChevronRight size={17} className="mp-row-chevron" />
                  </button>
                );
              })}
            </div>
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
