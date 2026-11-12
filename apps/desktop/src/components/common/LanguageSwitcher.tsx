import { useTranslation } from 'react-i18next';
import { Button, Icon, Popover, Select } from '@peers-touch/ui';
import { getAvailableLanguages, changeLanguage } from '../../i18n';

export function LanguageSwitcher({
  variant = 'menu',
  label,
}: {
  /**
   * `menu` is the compact corner popover used on login. `ghostSelect` is the
   * inline borderless settings-row control, matching the north-star settings
   * language row (Select appearance="ghost").
   */
  variant?: 'menu' | 'ghostSelect';
  label?: string;
}) {
  const { i18n } = useTranslation();
  const languages = getAvailableLanguages();

  if (languages.length < 2) return null;

  const current = languages.find((language) => language.code === i18n.language);
  const displayName = current?.native_name ?? current?.name ?? i18n.language;

  if (variant === 'ghostSelect') {
    return (
      <Select<string>
        appearance="ghost"
        aria-label={label ?? displayName}
        value={i18n.language}
        options={languages.map((language) => ({
          value: language.code,
          label: language.native_name ?? language.name ?? language.code,
        }))}
        onValueChange={(code) => {
          if (typeof code === 'string') void changeLanguage(code);
        }}
      />
    );
  }

  const panel = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 168 }}>
      {languages.map((language) => {
        const isActive = language.code === i18n.language;
        return (
          <Button
            key={language.code}
            actionId={`language.select.${language.code}`}
            fullWidth
            emphasis="quiet"
            aria-pressed={isActive}
            trailing={isActive ? <Icon iconId="check" size={14} /> : undefined}
            onActivate={() => void changeLanguage(language.code)}
          >
            <span style={{ flex: 1, textAlign: 'left' }}>
              {language.native_name ?? language.name ?? language.code}
            </span>
          </Button>
        );
      })}
    </div>
  );

  return (
    <Popover placement="bottom" label={displayName} content={panel}>
      <Button
        actionId="language.switch"
        emphasis="quiet"
        density="compact"
        aria-label={displayName}
        leading={<Icon iconId="globe" size={15} />}
        trailing={<Icon iconId="chevron-down" size={13} />}
      >
        {displayName}
      </Button>
    </Popover>
  );
}
