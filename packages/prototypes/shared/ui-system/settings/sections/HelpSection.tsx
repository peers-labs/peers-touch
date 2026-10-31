/**
 * HelpSection — prototype counterpart of desktop HelpTab: about card plus an
 * accordion of builtin command-palette functions. Every row navigates to its
 * real settings section (federation and AI agent entries are out of scope).
 */
import { Search, Sparkles } from 'lucide-react';
import { Accordion, Tag } from '@peers-touch/ui';
import { SettingsSection } from '../SettingsPrimitives';
import { useT, type StringKey } from '../../prefs';
import '../settings.css';
import type { SectionKey, SettingsGroup } from '../SettingsFeature';

interface HelpEntry {
  id: string;
  titleKey: StringKey;
  detailKey: StringKey;
  group: SettingsGroup;
  section: SectionKey;
}

const ENTRIES: HelpEntry[] = [
  { id: 'account', titleKey: 'help.entry.account.title', detailKey: 'help.entry.account.detail', group: 'general', section: 'account' },
  { id: 'security', titleKey: 'help.entry.security.title', detailKey: 'help.entry.security.detail', group: 'general', section: 'security' },
  { id: 'general', titleKey: 'help.entry.general.title', detailKey: 'help.entry.general.detail', group: 'general', section: 'general' },
  { id: 'storage', titleKey: 'help.entry.storage.title', detailKey: 'help.entry.storage.detail', group: 'data', section: 'storage' },
];

export function HelpSection({ onNavigate }: { onNavigate: (group: SettingsGroup, section: SectionKey) => void }) {
  const { t } = useT();
  return (
    <>
      <SettingsSection icon={Sparkles} title={t('help.aboutTitle')}
        subtitle={t('help.aboutSubtitle')}
        extra={<Tag>{t('help.aboutTag')}</Tag>}>
        <p className="sk-about-copy">
          {t('help.aboutCopy', { mod: '⌘/Ctrl', k: 'K' })}
        </p>
      </SettingsSection>

      <SettingsSection icon={Search} title={t('help.searchableTitle')}
        subtitle={t('help.searchableSubtitle')}>
        <Accordion
          className="sk-help-accordion"
          defaultExpanded={['search']}
          items={[{
            id: 'search',
            title: (
              <span className="sk-help-summary">
                <Search size={15} />
                <strong>{t('help.searchGroup')}</strong>
                <Tag>{ENTRIES.length}</Tag>
              </span>
            ),
            content: (
              <div className="sk-help-list">
                {ENTRIES.map(entry => (
                  <button key={entry.id} type="button" className="sk-help-item"
                    data-help-target={entry.id}
                    onClick={() => onNavigate(entry.group, entry.section)}>
                    <strong>{t(entry.titleKey)}</strong>
                    <span>{t(entry.detailKey)}</span>
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
