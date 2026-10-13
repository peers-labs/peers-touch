import { Typography } from 'antd';
import {
  Ban, Bell, ChevronRight, Fingerprint, Globe,
  Image as ImageIcon, MessageCircle, Server,
  Settings as SettingsIcon, Shield, ShieldCheck, User,
} from 'lucide-react';
import type { SettingEntry, SettingGroup } from '../types';
import type { AvatarRenderState } from '../types';
import { demoAvatarUrls } from '../data';
import { IdentityAvatar } from '../components/IdentityAvatar';

const { Text } = Typography;

export function ProfilePage({ avatarState, onChangeStation, onSettingClick }: {
  avatarState: AvatarRenderState;
  onChangeStation: () => void;
  onSettingClick: (s: SettingEntry) => void;
}) {
  const settingGroups: SettingGroup[] = [
    {
      title: 'Account',
      items: [
        { label: 'Account Info', icon: User, tint: 'primary' },
        { label: 'Notifications', value: 'In-app', icon: Bell, tint: 'warning' },
        { label: 'Privacy & Security', icon: Shield, tint: 'success' },
        { label: 'Safety Number', icon: Fingerprint, tint: 'primary' },
        { label: 'Blocked Users', value: '2', icon: Ban, tint: 'danger' },
      ],
    },
    {
      title: 'Chat',
      items: [
        { label: 'Chat Settings', icon: MessageCircle, tint: 'primary' },
        { label: 'Chat Background', icon: ImageIcon, tint: 'neutral' },
      ],
    },
    {
      title: 'Network',
      items: [
        { label: 'Station Connection', value: 'Local Station', icon: Server, tint: 'success' },
        { label: 'Encryption', value: 'Active', icon: ShieldCheck, tint: 'primary' },
        { label: 'Language', value: 'English', icon: Globe, tint: 'neutral' },
      ],
    },
    {
      title: 'About',
      items: [
        { label: 'About Peers Touch', value: 'v1.0.0', icon: ShieldCheck, tint: 'neutral' },
      ],
    },
  ];

  return (
    <div className="mp-page">
      <header className="mp-header">
        <h1 className="mp-header-title">Me</h1>
        <button type="button" className="mp-header-action" aria-label="Settings" onClick={() => onSettingClick({ label: 'Account Info', icon: User, tint: 'primary' })}>
          <SettingsIcon size={20} />
        </button>
      </header>

      <div className="mp-profile-body">
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

        <button type="button" className="mp-sign-out" onClick={onChangeStation}>Sign Out</button>
      </div>
    </div>
  );
}
