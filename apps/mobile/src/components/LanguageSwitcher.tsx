import { Dropdown } from 'antd';
import { Globe } from 'lucide-react';

import { useMobileI18n } from '../app/mobileI18n';

export function LanguageSwitcher() {
  const { language, languages, setLanguage } = useMobileI18n();
  const current = languages.find((option) => option.code === language) ?? languages[0];

  return (
    <Dropdown
      menu={{
        items: languages.map((option) => ({
          key: option.code,
          label: option.nativeName,
        })),
        selectedKeys: [language],
        onClick: ({ key }) => setLanguage(key as typeof language),
      }}
      placement="bottomRight"
      trigger={['click']}
    >
      <button type="button" className="mobile-language-switcher" aria-label={current.nativeName}>
        <Globe size={15} />
        <span>{current.shortName}</span>
      </button>
    </Dropdown>
  );
}
