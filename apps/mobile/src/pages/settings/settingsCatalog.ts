import {
  Ban, Bell, Blocks, Bot, Brain, Globe, HardDrive, MessageCircle, Plug, Server, Settings, Shield, ShieldCheck, Sparkles, User,
  type LucideIcon,
} from 'lucide-react';
import type { MobileSettingDetailId } from '../../app/navigation';

export interface SettingEntry {
  readonly id: MobileSettingDetailId;
  readonly labelKey: string;
  readonly icon: LucideIcon;
  readonly availability?: 'pending';
}

export const settingGroups: readonly {
  readonly titleKey: string;
  readonly items: readonly SettingEntry[];
}[] = [
  {
    titleKey: 'mobile.settings.group.account',
    items: [
      { id: 'account-info', labelKey: 'mobile.settings.accountInfo', icon: User },
      { id: 'security', labelKey: 'mobile.settings.security.title', icon: ShieldCheck },
      { id: 'general', labelKey: 'mobile.settings.general.title', icon: Settings },
      { id: 'notifications', labelKey: 'mobile.settings.section.notifications', icon: Bell },
      { id: 'privacy-security', labelKey: 'mobile.settings.privacySecurity', icon: Shield },
      { id: 'blocked-users', labelKey: 'mobile.settings.blockedUsers', icon: Ban },
    ],
  },
  {
    titleKey: 'mobile.settings.group.chat',
    items: [{ id: 'chat-settings', labelKey: 'mobile.settings.chatSettings', icon: MessageCircle }],
  },
  {
    titleKey: 'mobile.settings.group.federation',
    items: [{ id: 'federation', labelKey: 'mobile.settings.federation.title', icon: Globe }],
  },
  {
    titleKey: 'mobile.settings.agent.group',
    items: [
      { id: 'providers', labelKey: 'mobile.settings.agent.providers', icon: Bot, availability: 'pending' },
      { id: 'models', labelKey: 'mobile.settings.agent.models', icon: Blocks, availability: 'pending' },
      { id: 'memory', labelKey: 'mobile.settings.memory.title', icon: Brain, availability: 'pending' },
      { id: 'skills', labelKey: 'mobile.settings.skills.title', icon: Sparkles, availability: 'pending' },
      { id: 'mcp', labelKey: 'mobile.settings.mcp.title', icon: Plug, availability: 'pending' },
    ],
  },
  {
    titleKey: 'mobile.settings.group.network',
    items: [
      { id: 'station-connection', labelKey: 'mobile.settings.stationConnection', icon: Server },
      { id: 'language', labelKey: 'mobile.settings.section.language', icon: Globe },
    ],
  },
  {
    titleKey: 'mobile.settings.group.data',
    items: [{ id: 'storage', labelKey: 'mobile.settings.section.storage', icon: HardDrive }],
  },
  {
    titleKey: 'mobile.settings.group.about',
    items: [{ id: 'about', labelKey: 'mobile.settings.aboutApp', icon: ShieldCheck }],
  },
];

export function findSetting(id: MobileSettingDetailId): SettingEntry | undefined {
  return settingGroups.flatMap((group) => group.items).find((entry) => entry.id === id);
}
