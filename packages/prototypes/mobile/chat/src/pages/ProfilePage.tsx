import { Avatar, Card, Typography } from 'antd';
import {
  Ban, Bell, ChevronRight, Fingerprint, Globe,
  Image as ImageIcon, MessageCircle, Server,
  Settings as SettingsIcon, Shield, ShieldCheck, User,
} from 'lucide-react';
import type { SettingEntry, SettingGroup } from '../types';
import { GRADIENTS } from '../types';

const { Text } = Typography;

export function ProfilePage({ onChangeStation, onSettingClick }: { onChangeStation: () => void; onSettingClick: (s: SettingEntry) => void }) {
  const settingGroups: SettingGroup[] = [
    {
      title: 'Account',
      items: [
        { label: 'Account Info', icon: User, tint: '#6366f1' },
        { label: 'Notifications', value: 'In-app', icon: Bell, tint: '#f59e0b' },
        { label: 'Privacy & Security', icon: Shield, tint: '#22c55e' },
        { label: 'Safety Number', icon: Fingerprint, tint: '#0ea5e9' },
        { label: 'Blocked Users', value: '2', icon: Ban, tint: '#ef4444' },
      ],
    },
    {
      title: 'Chat',
      items: [
        { label: 'Chat Settings', icon: MessageCircle, tint: '#6366f1' },
        { label: 'Chat Background', icon: ImageIcon, tint: '#ec4899' },
      ],
    },
    {
      title: 'Network',
      items: [
        { label: 'Station Connection', value: 'Local Station', icon: Server, tint: '#22c55e' },
        { label: 'Encryption', value: 'Active', icon: ShieldCheck, tint: '#6366f1' },
        { label: 'Language', value: 'English', icon: Globe, tint: '#0ea5e9' },
      ],
    },
    {
      title: 'About',
      items: [
        { label: 'About Peers Touch', value: 'v1.0.0', icon: ShieldCheck, tint: '#f59e0b' },
      ],
    },
  ];

  return (
    <div className="mp-page">
      <header className="mp-header">
        <h1 className="mp-header-title">Me</h1>
        <button type="button" className="mp-header-action" aria-label="Settings" onClick={() => onSettingClick({ label: 'Account Info', icon: User, tint: '#6366f1' })}>
          <SettingsIcon size={20} />
        </button>
      </header>

      <div className="mp-profile-body">
        <Card className="mp-profile-header-card" variant="borderless">
          <div className="mp-profile-header">
            <Avatar size={64} style={{ background: GRADIENTS[0], borderRadius: 16 }}>AC</Avatar>
            <div className="mp-profile-info">
              <Text strong className="mp-profile-name">Alice Chen</Text>
              <Text type="secondary" className="mp-profile-did">ptid:v1:actor:local:p:alice:a3f9...</Text>
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

        <button type="button" className="mp-sign-out" onClick={onChangeStation}>Sign Out</button>
      </div>
    </div>
  );
}
