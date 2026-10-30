/**
 * HelpSection — prototype counterpart of desktop HelpTab: about card plus an
 * accordion of builtin command-palette functions. Every row navigates to its
 * real settings section (federation and AI agent entries are out of scope).
 */
import { Search, Sparkles } from 'lucide-react';
import { Accordion, Tag } from '@peers-touch/ui';
import { SettingsSection } from '../SettingsPrimitives';
import '../settings.css';
import type { SectionKey, SettingsGroup } from '../SettingsFeature';

interface HelpEntry {
  id: string;
  title: string;
  detail: string;
  group: SettingsGroup;
  section: SectionKey;
}

const ENTRIES: HelpEntry[] = [
  { id: 'account', title: '账号与身份', detail: '头像、资料、PTID、设备关联', group: 'general', section: 'account' },
  { id: 'security', title: '安全与恢复', detail: '恢复密钥、备份、助记词恢复', group: 'general', section: 'security' },
  { id: 'general', title: '通用偏好', detail: '界面语言、截图快捷键', group: 'general', section: 'general' },
  { id: 'storage', title: '聊天存储', detail: '消息留存、清缓存、批量删除', group: 'data', section: 'storage' },
];

export function HelpSection({ onNavigate }: { onNavigate: (group: SettingsGroup, section: SectionKey) => void }) {
  return (
    <>
      <SettingsSection icon={Sparkles} title="关于 Peers Touch"
        subtitle="去中心化的邻里社交原型 · 北极星桌面框架"
        extra={<Tag>draft</Tag>}>
        <p className="sk-about-copy">
          所有功能均为本地原型状态。命令面板：<kbd>⌘/Ctrl</kbd> + <kbd>K</kbd>，方向键选择，
          Enter 打开，Esc 关闭。
        </p>
      </SettingsSection>

      <SettingsSection icon={Search} title="可搜索功能"
        subtitle="命令面板中可用的内置入口，点击直接跳转到对应分区">
        <Accordion
          className="sk-help-accordion"
          defaultExpanded={['search']}
          items={[{
            id: 'search',
            title: (
              <span className="sk-help-summary">
                <Search size={15} />
                <strong>搜索功能</strong>
                <Tag>{ENTRIES.length}</Tag>
              </span>
            ),
            content: (
              <div className="sk-help-list">
                {ENTRIES.map(entry => (
                  <button key={entry.id} type="button" className="sk-help-item"
                    data-help-target={entry.id}
                    onClick={() => onNavigate(entry.group, entry.section)}>
                    <strong>{entry.title}</strong>
                    <span>{entry.detail}</span>
                  </button>
                ))}
              </div>
            ),
          }]}
        />
      </SettingsSection>
    </>
  );
}
