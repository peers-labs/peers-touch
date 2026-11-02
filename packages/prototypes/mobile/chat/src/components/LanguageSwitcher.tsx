import { Icon } from '@peers-touch/ui';
import { getLocale, toggleLocale, useLocale } from '../i18n';

/**
 * Live interface-language switch. Toggles the i18n runtime (which rewrites
 * `?lang` and notifies subscribers); every surface using useT/useLocale
 * re-renders without a reload.
 */
export function LanguageSwitcher() {
  const locale = useLocale();
  return (
    <button
      type="button"
      className="mp-language-switcher"
      aria-label={locale === 'zh' ? 'Switch to English' : '切换为中文'}
      data-locale-toggle
      onClick={() => toggleLocale()}
    >
      <Icon iconId="languages" size={14} />
      <span>{getLocale() === 'zh' ? '中' : 'EN'}</span>
    </button>
  );
}
