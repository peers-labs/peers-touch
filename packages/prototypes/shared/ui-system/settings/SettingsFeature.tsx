/**
 * SettingsFeature — the settings surface inside the north-star frame.
 *
 * Frame counterpart of desktop pages/SettingsPage.tsx: group scope bar +
 * section sub-navigation (only when a group owns multiple sections) +
 * scrollable section content. AI and Federation groups do not exist here.
 * Increments 7–9 fill the sections; unbuilt sections show an honest Empty
 * state naming their increment instead of fake controls.
 *
 * Preferences (language, message layout, notification switches) persist via
 * the shared prefs module so the same choices drive chat and settings.
 */
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Bell, Database, LifeBuoy, MessagesSquare, Puzzle, Radio, SlidersHorizontal, Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Button, Empty, Select, Segmented, Switch } from '@peers-touch/ui';
import {
  makeTranslate, setPrefs, usePrefs, useT,
  type MessageLayout, type NotificationPrefs, type Prefs, type StringKey,
} from '../prefs';
import { SettingsRow, SettingsSection } from './SettingsPrimitives';
import { AccountSection } from './sections/AccountSection';
import { SecuritySection } from './sections/SecuritySection';
import { HelpSection } from './sections/HelpSection';
import { DataSection } from './sections/DataSection';
import { ToolsSection, ChannelsSection, AppletsSection } from './sections/ToolsSections';
import './settings.css';

export type SettingsGroup = 'general' | 'tools' | 'channels' | 'applets' | 'data' | 'help';
export type SectionKey =
  | 'account' | 'messages' | 'notifications' | 'general' | 'security'
  | 'cron' | 'command-menu' | 'tools'
  | 'channels'
  | 'applets'
  | 'storage' | 'files' | 'logs'
  | 'help';

interface SectionDef { key: SectionKey; labelKey: StringKey; increment: number }
interface GroupDef { key: SettingsGroup; labelKey: StringKey; icon: LucideIcon; sections: SectionDef[] }

const GROUPS: GroupDef[] = [
  { key: 'general', labelKey: 'group.general', icon: SlidersHorizontal, sections: [
    { key: 'account', labelKey: 'sec.account', increment: 7 },
    { key: 'messages', labelKey: 'sec.messages', increment: 22 },
    { key: 'notifications', labelKey: 'sec.notifications', increment: 22 },
    { key: 'general', labelKey: 'sec.general', increment: 6 },
    { key: 'security', labelKey: 'sec.security', increment: 7 },
  ] },
  { key: 'tools', labelKey: 'group.tools', icon: Wrench, sections: [
    { key: 'cron', labelKey: 'sec.cron', increment: 9 },
    { key: 'command-menu', labelKey: 'sec.commandMenu', increment: 9 },
    { key: 'tools', labelKey: 'sec.tools', increment: 9 },
  ] },
  { key: 'channels', labelKey: 'group.channels', icon: Radio, sections: [
    { key: 'channels', labelKey: 'sec.channels', increment: 9 },
  ] },
  { key: 'applets', labelKey: 'group.applets', icon: Puzzle, sections: [
    { key: 'applets', labelKey: 'sec.applets', increment: 9 },
  ] },
  { key: 'data', labelKey: 'group.data', icon: Database, sections: [
    { key: 'storage', labelKey: 'sec.storage', increment: 8 },
    { key: 'files', labelKey: 'sec.files', increment: 8 },
    { key: 'logs', labelKey: 'sec.logs', increment: 8 },
  ] },
  { key: 'help', labelKey: 'group.help', icon: LifeBuoy, sections: [
    { key: 'help', labelKey: 'sec.help', increment: 7 },
  ] },
];

const DEFAULT_SHORTCUT = 'Mod+Shift+A';
const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Meta', 'Shift']);
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

function formatShortcut(spec: string): string {
  return spec.split('+').map(token => {
    switch (token) {
      case 'Mod': return isMac ? '⌘' : 'Ctrl';
      case 'Shift': return isMac ? '⇧' : 'Shift';
      case 'Alt': return isMac ? '⌥' : 'Alt';
      default: return token.length === 1 ? token.toUpperCase() : token;
    }
  }).join(isMac ? '' : '+');
}

function ShortcutSetting() {
  const { t } = useT();
  const [shortcut, setShortcut] = useState(DEFAULT_SHORTCUT);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (MODIFIER_KEYS.has(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const parts = [
        event.metaKey || event.ctrlKey ? 'Mod' : null,
        event.shiftKey ? 'Shift' : null,
        event.altKey ? 'Alt' : null,
        event.key.length === 1 ? event.key.toUpperCase() : event.key,
      ].filter((part): part is string => Boolean(part));
      if (parts.length >= 2) setShortcut(parts.join('+'));
      setRecording(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording]);

  return (
    <SettingsRow label={t('settings.shortcutLabel')} description={t('settings.shortcutDesc')}>
      <div className="sk-shortcut-editor">
        <input className="sk-shortcut-input" readOnly value={recording ? t('settings.shortcutRecording') : formatShortcut(shortcut)}
          data-shortcut={shortcut} data-recording={recording ? 'true' : 'false'}
          aria-label={t('settings.shortcutLabel')} onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => event.preventDefault()} />
        <Button actionId="settings.shortcut.record" emphasis="secondary" density="compact"
          label={recording ? t('settings.shortcutListening') : t('settings.shortcutRecord')}
          onClick={event => { event.stopPropagation(); setRecording(value => !value); }} />
        <Button actionId="settings.shortcut.reset" emphasis="quiet" density="compact"
          label={t('settings.shortcutReset')}
          availability={shortcut === DEFAULT_SHORTCUT ? { kind: 'disabled', reason: t('settings.shortcutDefaultReason') } : undefined}
          onActivate={() => setShortcut(DEFAULT_SHORTCUT)} />
      </div>
    </SettingsRow>
  );
}

/* ── General: language (persisted) + screenshot shortcut ─────────────── */

function GeneralSection() {
  const { t, prefs } = useGeneralPrefs();
  return (
    <SettingsSection icon={SlidersHorizontal} title={t('sec.general')} subtitle={t('settings.generalSubtitle')}>
      <SettingsRow label={t('settings.language')} description={t('settings.languageHint')}>
        <Select<'zh-CN' | 'en'> aria-label={t('settings.language')}
          options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }]}
          value={prefs.locale}
          onValueChange={value => setPrefs({ locale: (Array.isArray(value) ? value[0] : value) ?? 'zh-CN' })} />
      </SettingsRow>
      <ShortcutSetting />
    </SettingsSection>
  );
}

/* ── Messages: bubble alignment habit ────────────────────────────────── */

function MessagesSection() {
  const { t, prefs } = useGeneralPrefs();
  return (
    <SettingsSection icon={MessagesSquare} title={t('sec.messages')} subtitle={t('settings.messagesSubtitle')}>
      <SettingsRow label={t('settings.messageLayout')} description={t('settings.messageLayoutHint')}>
        <Segmented<MessageLayout>
          label={t('settings.messageLayout')}
          options={[
            { value: 'sides', label: t('settings.messageLayoutSides') },
            { value: 'left', label: t('settings.messageLayoutLeft') },
          ]}
          value={prefs.messageLayout}
          onValueChange={value => setPrefs({ messageLayout: value ?? 'sides' })} />
      </SettingsRow>
    </SettingsSection>
  );
}

/* ── Notifications: five event switches + two delivery switches
   (desktop NotificationsSettingsSection parity) ───────────────────────── */

const NOTIFICATION_ROWS: { key: keyof NotificationPrefs; labelKey: StringKey; descKey: StringKey }[] = [
  { key: 'mentions', labelKey: 'settings.n.mentions', descKey: 'settings.n.mentionsDesc' },
  { key: 'invites', labelKey: 'settings.n.invites', descKey: 'settings.n.invitesDesc' },
  { key: 'friendRequests', labelKey: 'settings.n.friendRequests', descKey: 'settings.n.friendRequestsDesc' },
  { key: 'reactions', labelKey: 'settings.n.reactions', descKey: 'settings.n.reactionsDesc' },
  { key: 'network', labelKey: 'settings.n.network', descKey: 'settings.n.networkDesc' },
];

function NotificationsSection() {
  const { t, prefs } = useGeneralPrefs();
  const flip = (key: keyof NotificationPrefs) => {
    setPrefs({ notifications: { ...prefs.notifications, [key]: !prefs.notifications[key] } });
  };
  return (
    <>
      <SettingsSection icon={Bell} title={t('settings.notifyWhat')} subtitle={t('settings.notifyWhatSubtitle')}>
        {NOTIFICATION_ROWS.map(row => (
          <SettingsRow key={row.key} label={t(row.labelKey)} description={t(row.descKey)}>
            <Switch checked={prefs.notifications[row.key]} aria-label={t(row.labelKey)}
              data-notify={row.key} onCheckedChange={() => flip(row.key)} />
          </SettingsRow>
        ))}
      </SettingsSection>
      <SettingsSection icon={Bell} title={t('settings.notifyDelivery')} subtitle={t('settings.notifyDeliverySubtitle')}>
        <SettingsRow label={t('settings.n.inApp')} description={t('settings.n.inAppDesc')}>
          <Switch checked={prefs.notifications.inApp} aria-label={t('settings.n.inApp')}
            data-notify="inApp" onCheckedChange={() => flip('inApp')} />
        </SettingsRow>
        <SettingsRow label={t('settings.n.sound')} description={t('settings.n.soundDesc')}>
          <Switch checked={prefs.notifications.sound} aria-label={t('settings.n.sound')}
            data-notify="sound" onCheckedChange={() => flip('sound')} />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

/* General-group sections need t() plus the whole prefs object; keep one hook
   instead of subscribing twice. */
function useGeneralPrefs(): { t: ReturnType<typeof useT>['t']; prefs: Prefs } {
  const prefs = usePrefs();
  return { t: makeTranslate(prefs.locale), prefs };
}

export function SettingsFeature() {
  const { t, locale } = useT();
  const [group, setGroup] = useState<SettingsGroup>('general');
  const activeGroup = GROUPS.find(entry => entry.key === group) ?? GROUPS[0];
  const [section, setSection] = useState<SectionKey>('account');

  const activeSection = activeGroup.sections.find(entry => entry.key === section) ?? activeGroup.sections[0];
  const showSectionNav = activeGroup.sections.length > 1;

  const switchGroup = (next: SettingsGroup) => {
    setGroup(next);
    const target = GROUPS.find(entry => entry.key === next);
    if (target) setSection(target.sections[0].key);
  };

  return (
    <div className="sk-settings" data-ui-locale={locale}>
      <div className="sk-settings-subbar">
        {/* Group scope uses quiet pills, never the desktop underline-tab hairline. */}
        <div className="sk-settings-groups" role="tablist" aria-label={t('settings.groupsAria')}>
          {GROUPS.map(entry => {
            const Icon = entry.icon;
            return (
              <button key={entry.key} type="button" role="tab" aria-selected={group === entry.key}
                className={`sk-settings-group${group === entry.key ? ' is-active' : ''}`}
                onClick={() => switchGroup(entry.key)}>
                <Icon size={14} strokeWidth={1.8} />
                {t(entry.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="sk-settings-body">
        {showSectionNav && (
          <nav className="sk-settings-nav" aria-label={t('settings.sectionsAria')}>
            {activeGroup.sections.map(entry => (
              <button key={entry.key} type="button"
                className={`sk-settings-nav-item${activeSection.key === entry.key ? ' is-active' : ''}`}
                aria-current={activeSection.key === entry.key ? 'page' : undefined}
                onClick={() => setSection(entry.key)}>
                {t(entry.labelKey)}
              </button>
            ))}
          </nav>
        )}

        <div className="sk-settings-scroll">
          {activeSection.key === 'general' ? <GeneralSection />
            : activeSection.key === 'messages' ? <MessagesSection />
              : activeSection.key === 'notifications' ? <NotificationsSection />
                : activeSection.key === 'account' ? <AccountSection />
                  : activeSection.key === 'security' ? <SecuritySection />
                    : activeSection.key === 'help' ? (
                      <HelpSection onNavigate={(targetGroup, targetSection) => {
                        setGroup(targetGroup);
                        setSection(targetSection);
                      }} />
                    ) : activeSection.key === 'storage' || activeSection.key === 'files' || activeSection.key === 'logs' ? (
                      <DataSection section={activeSection.key} />
                    ) : activeSection.key === 'cron' || activeSection.key === 'command-menu' || activeSection.key === 'tools' ? (
                      <ToolsSection section={activeSection.key} />
                    ) : activeSection.key === 'channels' ? (
                      <ChannelsSection />
                    ) : activeSection.key === 'applets' ? (
                      <AppletsSection />
                    ) : (
                      <section className="sk-settings-section sk-settings-pending" aria-label={t(activeSection.labelKey)}>
                        <Empty className="sk-settings-empty"
                          description={t('settings.pending', { label: t(activeSection.labelKey), n: activeSection.increment })} />
                      </section>
                    )}
        </div>
      </div>
    </div>
  );
}
