import { useTranslation } from 'react-i18next';
import { Button, Icon } from '@peers-touch/ui';
import { useCommandMenuStore } from '../../store/commandMenu';
import { SettingsContainer, SettingsPanelHeader } from './SettingsLayout';

export function CommandPaletteSettings() {
  const { t } = useTranslation('settings');
  const openMenu = useCommandMenuStore((state) => state.openMenu);

  return (
    <SettingsContainer>
      <SettingsPanelHeader
        icon={<Icon iconId="command" size={20} />}
        title={t('settings.commandPalette.title')}
        actions={
          <Button
            actionId="settings-command-palette-open"
            data-pt-settings-command-palette-open
            leading={<Icon iconId="command" size={14} />}
            emphasis="primary"
            density="compact"
            label={t('settings.commandPalette.open')}
            onActivate={openMenu}
          />
        }
      />
    </SettingsContainer>
  );
}
