/**
 * SettingsFeature — the settings surface inside the north-star frame.
 *
 * Frame counterpart of desktop pages/SettingsPage.tsx: group scope bar +
 * section sub-navigation (only when a group owns multiple sections) +
 * scrollable section content. AI and Federation groups do not exist here.
 * Increments 7–9 fill the sections; unbuilt sections show an honest Empty
 * state naming their increment instead of fake controls.
 */
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Database, LifeBuoy, Puzzle, Radio, SlidersHorizontal, Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Button, Empty, Select } from '@peers-touch/ui';
import { SettingsRow, SettingsSection } from './SettingsPrimitives';
import { AccountSection } from './sections/AccountSection';
import { SecuritySection } from './sections/SecuritySection';
import { HelpSection } from './sections/HelpSection';
import { DataSection } from './sections/DataSection';
import './settings.css';

export type SettingsGroup = 'general' | 'tools' | 'channels' | 'applets' | 'data' | 'help';
export type SectionKey =
  | 'account' | 'security' | 'general'
  | 'cron' | 'command-menu' | 'tools'
  | 'channels'
  | 'applets'
  | 'storage' | 'files' | 'logs'
  | 'help';

interface SectionDef { key: SectionKey; label: string; increment: number }
interface GroupDef { key: SettingsGroup; label: string; icon: LucideIcon; sections: SectionDef[] }

const GROUPS: GroupDef[] = [
  { key: 'general', label: '通用', icon: SlidersHorizontal, sections: [
    { key: 'account', label: '账号', increment: 7 },
    { key: 'security', label: '安全', increment: 7 },
    { key: 'general', label: '通用', increment: 6 },
  ] },
  { key: 'tools', label: '工具', icon: Wrench, sections: [
    { key: 'cron', label: '定时任务', increment: 9 },
    { key: 'command-menu', label: '命令面板', increment: 9 },
    { key: 'tools', label: '工具', increment: 9 },
  ] },
  { key: 'channels', label: '通道', icon: Radio, sections: [
    { key: 'channels', label: '通道', increment: 9 },
  ] },
  { key: 'applets', label: '小程序', icon: Puzzle, sections: [
    { key: 'applets', label: '小程序', increment: 9 },
  ] },
  { key: 'data', label: '数据', icon: Database, sections: [
    { key: 'storage', label: '聊天存储', increment: 8 },
    { key: 'files', label: '文件', increment: 8 },
    { key: 'logs', label: '日志', increment: 8 },
  ] },
  { key: 'help', label: '帮助', icon: LifeBuoy, sections: [
    { key: 'help', label: '帮助与反馈', increment: 7 },
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
    <SettingsRow label="聊天截图快捷键" description="在会话中按下组合键直接截取屏幕并作为附件发送">
      <div className="sk-shortcut-editor">
        <input className="sk-shortcut-input" readOnly value={recording ? '请按下快捷键…' : formatShortcut(shortcut)}
          data-shortcut={shortcut} data-recording={recording ? 'true' : 'false'}
          aria-label="聊天截图快捷键" onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => event.preventDefault()} />
        <Button actionId="settings.shortcut.record" emphasis="secondary" density="compact"
          label={recording ? '聆听中' : '录制'}
          onClick={event => { event.stopPropagation(); setRecording(value => !value); }} />
        <Button actionId="settings.shortcut.reset" emphasis="quiet" density="compact"
          label="重置" availability={shortcut === DEFAULT_SHORTCUT ? { kind: 'disabled', reason: '已是默认值' } : undefined}
          onActivate={() => setShortcut(DEFAULT_SHORTCUT)} />
      </div>
    </SettingsRow>
  );
}

function GeneralSection() {
  const [language, setLanguage] = useState<'zh-CN' | 'en'>('zh-CN');
  return (
    <SettingsSection icon={SlidersHorizontal} title="通用" subtitle="界面语言与聊天操作偏好">
      <SettingsRow label="界面语言" description="原型内为本地偏好，不影响其他视图">
        <Select<'zh-CN' | 'en'> aria-label="界面语言"
          options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }]}
          value={language} onValueChange={value => setLanguage((Array.isArray(value) ? value[0] : value) ?? 'zh-CN')} />
      </SettingsRow>
      <ShortcutSetting />
    </SettingsSection>
  );
}

export function SettingsFeature() {
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
    <div className="sk-settings">
      <div className="sk-settings-subbar">
        {/* Group scope uses quiet pills, never the desktop underline-tab hairline. */}
        <div className="sk-settings-groups" role="tablist" aria-label="设置分组">
          {GROUPS.map(entry => {
            const Icon = entry.icon;
            return (
              <button key={entry.key} type="button" role="tab" aria-selected={group === entry.key}
                className={`sk-settings-group${group === entry.key ? ' is-active' : ''}`}
                onClick={() => switchGroup(entry.key)}>
                <Icon size={14} strokeWidth={1.8} />
                {entry.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="sk-settings-body">
        {showSectionNav && (
          <nav className="sk-settings-nav" aria-label="设置分区">
            {activeGroup.sections.map(entry => (
              <button key={entry.key} type="button"
                className={`sk-settings-nav-item${activeSection.key === entry.key ? ' is-active' : ''}`}
                aria-current={activeSection.key === entry.key ? 'page' : undefined}
                onClick={() => setSection(entry.key)}>
                {entry.label}
              </button>
            ))}
          </nav>
        )}

        <div className="sk-settings-scroll">
          {activeSection.key === 'general' ? <GeneralSection />
            : activeSection.key === 'account' ? <AccountSection />
              : activeSection.key === 'security' ? <SecuritySection />
                : activeSection.key === 'help' ? (
                  <HelpSection onNavigate={(targetGroup, targetSection) => {
                    setGroup(targetGroup);
                    setSection(targetSection);
                  }} />
                ) : activeSection.key === 'storage' || activeSection.key === 'files' || activeSection.key === 'logs' ? (
                  <DataSection section={activeSection.key} />
                ) : (
                  <section className="sk-settings-section sk-settings-pending" aria-label={activeSection.label}>
                    <Empty className="sk-settings-empty"
                      description={`「${activeSection.label}」在增量 ${activeSection.increment} 迁入（peers-ui 组合，本地真实状态）`} />
                  </section>
                )}
        </div>
      </div>
    </div>
  );
}
