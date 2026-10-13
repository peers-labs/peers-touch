import { Typography } from 'antd';
import { ChevronRight, Settings as SettingsIcon } from 'lucide-react';
import type { AvatarRenderState, SettingEntry } from '../types';
import { demoAvatarUrls } from '../data';
import { IdentityAvatar } from '../components/IdentityAvatar';
import { accountSetting, mobileSettingGroups } from '../settingsModel';

const { Text } = Typography;

export function ProfilePage({
  avatarState,
  onChangeStation,
  onSettingClick,
}: {
  avatarState: AvatarRenderState;
  onChangeStation: () => void;
  onSettingClick: (setting: SettingEntry) => void;
}) {
  return (
    <div className="mp-page" data-prototype-page="settings">
      <header className="mp-header">
        <h1 className="mp-header-title">Me</h1>
        <button
          type="button"
          className="mp-header-action"
          aria-label="Open account settings"
          onClick={() => onSettingClick(accountSetting)}
        >
          <SettingsIcon size={20} />
        </button>
      </header>

      <div className="mp-profile-body">
        <button
          type="button"
          className="mp-profile-header-card"
          onClick={() => onSettingClick(accountSetting)}
        >
          <div className="mp-profile-cover" aria-hidden="true" />
          <div className="mp-profile-header">
            <IdentityAvatar
              name="Alice Chen"
              initials="AC"
              src={demoAvatarUrls.alice}
              size={64}
              renderState={avatarState}
            />
            <div className="mp-profile-info">
              <Text strong className="mp-profile-name">Alice Chen</Text>
              <Text type="secondary" className="mp-profile-handle">@alice@alpha.peers.social</Text>
              <Text type="secondary" className="mp-profile-did">Local Station · 3 federations</Text>
            </div>
            <ChevronRight size={20} className="mp-row-chevron" />
          </div>
          <div className="mp-profile-stats">
            <div className="mp-stat"><Text strong className="mp-stat-value">34</Text><Text type="secondary" className="mp-stat-label">Posts</Text></div>
            <div className="mp-stat-divider" />
            <div className="mp-stat"><Text strong className="mp-stat-value">128</Text><Text type="secondary" className="mp-stat-label">Followers</Text></div>
            <div className="mp-stat-divider" />
            <div className="mp-stat"><Text strong className="mp-stat-value">96</Text><Text type="secondary" className="mp-stat-label">Following</Text></div>
          </div>
        </button>

        <div className="mp-settings-intro">
          <Text strong>Settings</Text>
          <Text type="secondary">Account, network, AI, and device controls</Text>
        </div>

        {mobileSettingGroups.map((group) => (
          <section key={group.title} className="mp-settings-group" data-settings-group={group.title.toLowerCase()}>
            <div className="mp-settings-group-title">{group.title}</div>
            <div className="mp-settings-card">
              {group.items.map((item, index) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`mp-setting-row ${index > 0 ? 'mp-setting-row--border' : ''}`}
                    data-setting-id={item.id}
                    onClick={() => onSettingClick(item)}
                  >
                    <span className={`mp-setting-icon tone-${item.tint}`}>
                      <Icon size={17} />
                    </span>
                    <span className="mp-setting-copy">
                      <Text className="mp-setting-label">{item.label}</Text>
                      <Text type="secondary" className="mp-setting-description">{item.description}</Text>
                    </span>
                    {item.value && <Text type="secondary" className="mp-setting-value">{item.value}</Text>}
                    <ChevronRight size={17} className="mp-row-chevron" />
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        <button type="button" className="mp-sign-out" onClick={onChangeStation}>
          Sign out and switch Station
        </button>
      </div>
    </div>
  );
}
