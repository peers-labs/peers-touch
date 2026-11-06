/**
 * SettingsFeature — the settings surface inside the north-star frame.
 *
 * IA parity with desktop `shell/src/Settings.tsx` (FULL production structure):
 *   1. Top: horizontal group tabs — transparent text+icon buttons with a 2px
 *      primary bottom indicator on the active tab and one hairline under the
 *      whole bar (NOT SaaS pill chips).
 *   2. Left sidebar: plain section items with icon+label, active wash.
 *   3. Right: grouped white cards directly (no article page heading; the
 *      active rail item is the subject), composed with peers-ui only
 *      (ListSection inset wells / SettingsSection cards).
 *
 * Groups: General / Network / AI / Channels / Advanced. Applets were removed
 * by product decision. Preferences (language/layout/notifications/privacy/
 * appearance) persist via the shared prefs module.
 */
import { useEffect, useRef, useState } from 'react';
import {
  type LucideIcon,
  Bell as BellIcon, Bot as BotIcon, Brain, Clock3, Command as CommandIcon, Database,
  Globe, HardDrive, Info, Lock, MonitorSmartphone, Network, Plug, Radio,
  ScrollText, Search as SearchIcon, Send, Server, Settings as SettingsIcon, SlidersHorizontal,
  Sparkles, User, Wrench,
} from 'lucide-react';
import { Segmented } from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../prefs';
import type { StringKey } from '../prefs';
import { AccountSection } from './sections/AccountSection';
import { AppearanceSection, NotificationsSection, PrivacySection } from './sections/GeneralSections';
import { DiscoverySection, FederationSection, StationSection } from './sections/NetworkSections';
import {
  DiscoverSection as AiDiscoverSection, McpSection, MemorySection, ModelsSection,
  ProvidersSection, SkillsSection,
} from './sections/AiSections';
import { BotsSection, LarkSection } from './sections/ChannelsSections';
import {
  AboutSection, CommandPaletteSection, CronJobsSection, DataStorageSection,
  LogsSection, StatisticsSection,
} from './sections/AdvancedSections';
import './settings.css';

export type SettingsGroup = 'general' | 'network' | 'ai' | 'channels' | 'advanced';
export type SettingsSectionKey =
  | 'account' | 'notifications' | 'privacy' | 'appearance'
  | 'station' | 'discovery' | 'federation'
  | 'providers' | 'models' | 'discover' | 'memory' | 'skills' | 'mcp'
  | 'bots' | 'lark'
  | 'storage' | 'statistics' | 'logs' | 'cron' | 'command-menu' | 'about';

interface SectionDef { key: SettingsSectionKey; labelKey: StringKey; icon: LucideIcon }
interface GroupDef { key: SettingsGroup; labelKey: StringKey; icon: LucideIcon; sections: SectionDef[] }

const GROUPS: GroupDef[] = [
  {
    key: 'general', labelKey: 'group.general', icon: SettingsIcon,
    sections: [
      { key: 'account', labelKey: 'sec.account', icon: User },
      { key: 'notifications', labelKey: 'sec.notifications', icon: BellIcon },
      { key: 'privacy', labelKey: 'sec.privacy', icon: Lock },
      { key: 'appearance', labelKey: 'sec.appearance', icon: SlidersHorizontal },
    ],
  },
  {
    key: 'network', labelKey: 'group.network', icon: Globe,
    sections: [
      { key: 'station', labelKey: 'sec.station', icon: Server },
      { key: 'discovery', labelKey: 'sec.discovery', icon: Globe },
      { key: 'federation', labelKey: 'sec.federation', icon: Network },
    ],
  },
  {
    key: 'ai', labelKey: 'group.ai', icon: Sparkles,
    sections: [
      { key: 'providers', labelKey: 'sec.providers', icon: Server },
      { key: 'models', labelKey: 'sec.models', icon: Brain },
      { key: 'discover', labelKey: 'sec.discover', icon: SearchIcon },
      { key: 'memory', labelKey: 'sec.memory', icon: HardDrive },
      { key: 'skills', labelKey: 'sec.skills', icon: ScrollText },
      { key: 'mcp', labelKey: 'sec.mcp', icon: Plug },
      { key: 'cron', labelKey: 'sec.cron', icon: Clock3 },
    ],
  },
  {
    key: 'channels', labelKey: 'group.channels', icon: Send,
    sections: [
      { key: 'bots', labelKey: 'sec.bots', icon: BotIcon },
      { key: 'lark', labelKey: 'sec.lark', icon: Radio },
    ],
  },
  {
    key: 'advanced', labelKey: 'group.advanced', icon: Wrench,
    sections: [
      { key: 'storage', labelKey: 'sec.dataStorage', icon: Database },
      { key: 'statistics', labelKey: 'sec.statistics', icon: MonitorSmartphone },
      { key: 'logs', labelKey: 'sec.logs', icon: ScrollText },
      { key: 'command-menu', labelKey: 'sec.commandMenu', icon: CommandIcon },
      { key: 'about', labelKey: 'sec.about', icon: Info },
    ],
  },
];

function renderSection(section: SettingsSectionKey) {
  switch (section) {
    case 'account': return <AccountSection />;
    case 'notifications': return <NotificationsSection />;
    case 'privacy': return <PrivacySection />;
    case 'appearance': return <AppearanceSection />;
    case 'station': return <StationSection />;
    case 'discovery': return <DiscoverySection />;
    case 'federation': return <FederationSection />;
    case 'providers': return <ProvidersSection />;
    case 'models': return <ModelsSection />;
    case 'discover': return <AiDiscoverSection />;
    case 'memory': return <MemorySection />;
    case 'skills': return <SkillsSection />;
    case 'mcp': return <McpSection />;
    case 'bots': return <BotsSection />;
    case 'lark': return <LarkSection />;
    case 'storage': return <DataStorageSection />;
    case 'statistics': return <StatisticsSection />;
    case 'logs': return <LogsSection />;
    case 'cron': return <CronJobsSection />;
    case 'command-menu': return <CommandPaletteSection />;
    case 'about': return <AboutSection />;
    default: {
      const exhaustive: never = section;
      return exhaustive;
    }
  }
}

export type SettingsNavigationRequest = {
  nonce: number;
  group: SettingsGroup;
  section: SettingsSectionKey;
};

export function SettingsFeature({ navigation }: { navigation?: SettingsNavigationRequest | null }) {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const locale = prefs.locale;
  const [group, setGroup] = useState<SettingsGroup>('general');
  const [section, setSection] = useState<SettingsSectionKey>('account');

  // External navigation (global search function result).
  const lastNavNonce = useRef(0);
  useEffect(() => {
    if (!navigation || navigation.nonce === lastNavNonce.current) return;
    lastNavNonce.current = navigation.nonce;
    setGroup(navigation.group);
    setSection(navigation.section);
  }, [navigation]);

  const activeGroup = GROUPS.find(entry => entry.key === group) ?? GROUPS[0];
  const activeSection = activeGroup.sections.find(entry => entry.key === section) ?? activeGroup.sections[0];

  const switchGroup = (next: SettingsGroup) => {
    setGroup(next);
    const target = GROUPS.find(entry => entry.key === next) ?? GROUPS[0];
    setSection(target.sections[0].key);
  };

  return (
    <div className="sk-settings" data-ui-locale={locale}>
      {/* Level-2 surface partition — the SAME segmented-island grammar as
          moments 动态/圈友 and chat 消息/联系人 (one component, one geometry
          across modules; see ui-identity components.md §5/§9). Settings keeps
          an extra level below it (the plain section sidebar). */}
      <div className="sk-settings-subbar">
        <Segmented<SettingsGroup> className="sk-settings-groups" density="compact" aria-label={t('settings.groupsAria')}
          value={group} onValueChange={value => switchGroup((value ?? 'general') as SettingsGroup)}
          options={GROUPS.map(entry => {
            const Icon = entry.icon;
            return {
              value: entry.key,
              label: t(entry.labelKey),
              leading: <Icon size={13} />,
              attributes: { 'data-settings-group': entry.key } as Record<string, string>,
            };
          })} />
      </div>

      {/* Section sidebar + content */}
      <div className="sk-settings-body">
        <nav className="sk-settings-sidebar" aria-label={t('settings.sectionsAria')}>
          {activeGroup.sections.map(entry => {
            const Icon = entry.icon;
            const active = entry.key === activeSection.key;
            return (
              <button key={entry.key} type="button"
                className={`sk-settings-side${active ? ' is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
                data-settings-section={entry.key}
                onClick={() => setSection(entry.key)}>
                <Icon size={15} />
                <span>{t(entry.labelKey)}</span>
              </button>
            );
          })}
        </nav>

        {/* No article-style page heading: the active item in the section rail
            already identifies the surface; content opens straight into its
            grouped cards. */}
        <div className="sk-settings-scroll">
          {renderSection(activeSection.key)}
        </div>
      </div>
    </div>
  );
}
