import { Icon } from '@peers-touch/ui';

export function LanguageSwitcher() {
  return (
    <button type="button" className="mp-language-switcher" aria-label="Language">
      <Icon iconId="languages" size={14} />
      <span>EN</span>
    </button>
  );
}
