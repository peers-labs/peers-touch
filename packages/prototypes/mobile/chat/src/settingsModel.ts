import {
  AppWindow,
  Brain,
  CircleHelp,
  Clock3,
  Command,
  Database,
  FolderOpen,
  Globe2,
  HardDrive,
  Plug,
  Radio,
  ScrollText,
  Send,
  Server,
  Settings2,
  ShieldCheck,
  UserRound,
  Volume2,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import catalog from './settingsCapabilities.json';
import type { SettingEntry, SettingGroup, SettingId } from './types';

const icons: Record<SettingId, LucideIcon> = {
  account: UserRound,
  security: ShieldCheck,
  general: Settings2,
  federation: Globe2,
  providers: Server,
  models: Brain,
  memory: HardDrive,
  skills: ScrollText,
  mcp: Plug,
  tts: Volume2,
  cron: Clock3,
  'command-menu': Command,
  tools: Wrench,
  channels: Send,
  applets: AppWindow,
  storage: Database,
  oss: FolderOpen,
  logs: Radio,
  help: CircleHelp,
};

const tints: Record<SettingId, SettingEntry['tint']> = {
  account: 'primary',
  security: 'success',
  general: 'neutral',
  federation: 'primary',
  providers: 'primary',
  models: 'primary',
  memory: 'success',
  skills: 'warning',
  mcp: 'neutral',
  tts: 'primary',
  cron: 'primary',
  'command-menu': 'neutral',
  tools: 'warning',
  channels: 'success',
  applets: 'primary',
  storage: 'primary',
  oss: 'success',
  logs: 'warning',
  help: 'neutral',
};

export const mobileSettingGroups: SettingGroup[] = catalog.groups.map((group) => ({
  title: group.label,
  items: group.sections.map((section) => {
    const id = section.id as SettingId;
    return {
      id,
      label: section.label,
      description: section.description,
      capabilities: section.capabilities,
      icon: icons[id],
      tint: tints[id],
    };
  }),
}));

export const accountSetting = mobileSettingGroups[0].items[0];

export const settingCapabilityCatalog = catalog;

export const settingGroupIcons: Record<string, LucideIcon> = {
  General: Settings2,
  Federation: Globe2,
  AI: Brain,
  Tools: Wrench,
  Channels: Send,
  Applets: AppWindow,
  Data: Database,
  Help: CircleHelp,
};
