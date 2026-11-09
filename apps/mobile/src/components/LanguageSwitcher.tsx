import { Icon, Menu } from '@peers-touch/ui';

import { useMobileI18n } from '../app/mobileI18n';

export function LanguageSwitcher() {
  const { language, languages, setLanguage } = useMobileI18n();
  const current = languages.find((option) => option.code === language) ?? languages[0];

  return (
    <Menu
      label={current.nativeName}
      placement="bottom"
      actions={languages.map((option) => ({
        id: `language-${option.code}`,
        label: option.nativeName,
        iconId: option.code === language ? 'check' : undefined,
        onActivate: () => setLanguage(option.code),
      }))}
    >
      <button type="button" className="mobile-language-switcher" aria-label={current.nativeName}>
        <Icon iconId="globe" size={15} />
        <span>{current.shortName}</span>
      </button>
    </Menu>
  );
}
