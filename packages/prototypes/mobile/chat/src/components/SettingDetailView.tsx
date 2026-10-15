import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { Typography } from 'antd';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import type { DesignThemeMode } from '../../../../shared/design-tokens';
import type { SettingEntry, SettingId } from '../types';
import type { MobileSettingsState } from '../settingsState';
import {
  AccountSettingsSection,
  FederationSettingsSection,
  GeneralSettingsSection,
  SecuritySettingsSection,
} from './settings/CoreSettingsSections';
import {
  McpSettingsSection,
  MemorySettingsSection,
  ModelsSettingsSection,
  ProvidersSettingsSection,
  SkillsSettingsSection,
  VoiceSettingsSection,
} from './settings/AiSettingsSections';
import {
  AppletsSettingsSection,
  ChannelsSettingsSection,
  CommandPaletteSettingsSection,
  CronSettingsSection,
  HelpSettingsSection,
  ToolsSettingsSection,
} from './settings/ToolSettingsSections';
import {
  FilesSettingsSection,
  LogsSettingsSection,
  StorageSettingsSection,
} from './settings/DataSettingsSections';

const { Text } = Typography;

export function SettingDetailView({
  setting,
  settingsState,
  onSettingsStateChange,
  themeMode,
  onThemeModeChange,
  onCommand,
  onBack,
  onChangeStation,
}: {
  setting: SettingEntry;
  settingsState: MobileSettingsState;
  onSettingsStateChange: Dispatch<SetStateAction<MobileSettingsState>>;
  themeMode: DesignThemeMode;
  onThemeModeChange: (theme: DesignThemeMode) => void;
  onCommand: (command: 'Open Chats' | 'New Post' | 'Switch Station') => void;
  onBack: () => void;
  onChangeStation: () => void;
}) {
  const ownerProps = {
    state: settingsState,
    setState: onSettingsStateChange,
  };

  const settingContent: Record<SettingId, ReactNode> = {
    account: <AccountSettingsSection {...ownerProps} />,
    security: <SecuritySettingsSection {...ownerProps} />,
    general: (
      <GeneralSettingsSection
        {...ownerProps}
        themeMode={themeMode}
        onThemeModeChange={onThemeModeChange}
      />
    ),
    federation: (
      <FederationSettingsSection
        {...ownerProps}
        onChangeStation={onChangeStation}
      />
    ),
    providers: <ProvidersSettingsSection {...ownerProps} />,
    models: <ModelsSettingsSection {...ownerProps} />,
    memory: <MemorySettingsSection {...ownerProps} />,
    skills: <SkillsSettingsSection {...ownerProps} />,
    mcp: <McpSettingsSection {...ownerProps} />,
    tts: <VoiceSettingsSection {...ownerProps} />,
    cron: <CronSettingsSection {...ownerProps} />,
    'command-menu': <CommandPaletteSettingsSection onCommand={onCommand} />,
    tools: <ToolsSettingsSection {...ownerProps} />,
    channels: <ChannelsSettingsSection {...ownerProps} />,
    applets: <AppletsSettingsSection {...ownerProps} />,
    storage: <StorageSettingsSection {...ownerProps} />,
    oss: <FilesSettingsSection {...ownerProps} />,
    logs: <LogsSettingsSection {...ownerProps} />,
    help: <HelpSettingsSection onReset={onChangeStation} />,
  };
  const content = settingContent[setting.id];
  const Icon = setting.icon;

  return (
    <div
      className="mp-detail-page"
      data-prototype-page="setting-detail"
      data-setting-detail={setting.id}
      data-setting-capability-count={setting.capabilities.length}
    >
      <header className="mp-detail-header">
        <button type="button" className="mp-thread-back" onClick={onBack} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <span className={`mp-detail-title-icon tone-${setting.tint}`}><Icon size={17} /></span>
        <span className="mp-detail-heading-copy">
          <h2 className="mp-detail-header-title">{setting.label}</h2>
          <Text type="secondary">{setting.description}</Text>
        </span>
      </header>
      <div className="mp-setting-detail-content">
        {content ?? (
          <div className="mp-setting-empty">
            <CircleAlert size={18} />
            This setting is unavailable.
          </div>
        )}
      </div>
    </div>
  );
}
