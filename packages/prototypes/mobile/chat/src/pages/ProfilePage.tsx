import { useState } from 'react';
import { Typography } from 'antd';
import { ChevronRight } from 'lucide-react';
import type { AvatarRenderState, SettingEntry } from '../types';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { IdentityAvatar } from '../components/IdentityAvatar';
import { accountSetting, mobileSettingGroups } from '../settingsModel';
import type { MobileSettingsState } from '../settingsState';
import type { DesignThemeMode } from '../../../../shared/design-tokens';

const { Text } = Typography;

export function ProfilePage({
  avatarState,
  settingsState,
  themeMode,
  onChangeStation,
  onSettingClick,
}: {
  avatarState: AvatarRenderState;
  settingsState: MobileSettingsState;
  themeMode: DesignThemeMode;
  onChangeStation: () => void;
  onSettingClick: (setting: SettingEntry) => void;
}) {
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const { profile, toggles } = settingsState;
  const storageGb = (
    settingsState.storage.messagesMb
    + settingsState.storage.mediaMb
    + settingsState.storage.cacheMb
    + settingsState.storage.systemMb
  ) / 1024;

  function valueForSetting(item: SettingEntry): string | undefined {
    switch (item.id) {
      case 'security': return toggles.pinLock ? 'PIN active' : 'No PIN';
      case 'general': return `${themeMode === 'dark' ? 'Dark' : 'Light'} · ${settingsState.language === 'en' ? 'English' : '简体中文'}`;
      case 'federation': return `${settingsState.federations.length} contexts`;
      case 'providers': return `${settingsState.providers.filter((provider) => provider.status === 'ready').length} ready`;
      case 'models': return settingsState.defaultModel;
      case 'memory': return settingsState.memory.enabled ? `${settingsState.memory.entries.length} saved` : 'Off';
      case 'skills': return `${settingsState.skills.filter((skill) => skill.enabled).length} enabled`;
      case 'mcp': return `${settingsState.mcpServers.filter((server) => server.status === 'connected').length} connected`;
      case 'tts': return settingsState.voice.voice;
      case 'cron': return `${settingsState.cronTasks.filter((task) => task.enabled).length} active`;
      case 'tools': return settingsState.primarySearchProvider;
      case 'channels': return `${settingsState.channels.filter((channel) => channel.enabled).length} enabled`;
      case 'applets': return `${settingsState.applets.filter((applet) => applet.enabled).length} enabled`;
      case 'storage': return `${storageGb.toFixed(1)} GB`;
      case 'oss': return `${settingsState.files.filter((file) => !file.deleted).length} files`;
      case 'logs': return `${settingsState.logs.length} entries`;
      case 'help': return 'v1.0.0';
      default: return item.value;
    }
  }

  return (
    <div className="mp-page" data-prototype-page="settings">
      <div className="mp-profile-body">
        <button
          type="button"
          className="mp-profile-header-card"
          aria-label="Edit profile"
          onClick={() => onSettingClick(accountSetting)}
        >
          <div
            className="mp-profile-cover"
            aria-hidden="true"
            style={profile.coverSrc ? { backgroundImage: `url("${profile.coverSrc}")` } : undefined}
          />
          <span className="mp-profile-page-title">Me</span>
          <div className="mp-profile-header">
            <IdentityAvatar
              name={profile.displayName}
              initials="AC"
              src={profile.avatarSrc}
              size={64}
              renderState={avatarState}
            />
            <div className="mp-profile-info">
              <Text strong className="mp-profile-name">{profile.displayName}</Text>
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
        </div>

        {mobileSettingGroups.map((group) => (
          <section key={group.title} className="mp-settings-group" data-settings-group={group.title.toLowerCase()}>
            <div className="mp-settings-group-title">{group.title}</div>
            <div className="mp-settings-card">
              {group.items.map((item, index) => {
                const Icon = item.icon;
                const value = valueForSetting(item);
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
                    {value && <Text type="secondary" className="mp-setting-value">{value}</Text>}
                    <ChevronRight size={17} className="mp-row-chevron" />
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        <button type="button" className="mp-sign-out" onClick={() => setSignOutConfirmOpen(true)}>
          Sign out and switch Station
        </button>
      </div>
      {signOutConfirmOpen && (
        <ConfirmationDialog
          title="Sign out and switch Station?"
          description="Local conversations stay on this device."
          confirmLabel="Sign out"
          onCancel={() => setSignOutConfirmOpen(false)}
          onConfirm={onChangeStation}
        />
      )}
    </div>
  );
}
