import { useTranslation } from 'react-i18next';
import { Button } from '@lobehub/ui';
import { Command } from 'lucide-react';

import { useCommandMenuStore } from '../../store/commandMenu';
import { SettingsContainer, SettingsPanelHeader } from './SettingsLayout';

export function CommandPaletteSettings() {
  const { t } = useTranslation('settings');
  const openMenu = useCommandMenuStore((state) => state.openMenu);

  return (
    <SettingsContainer>
      <SettingsPanelHeader
        icon={<Command size={20} />}
        title={t('settings.commandPalette.title')}
        actions={
          <Button
            data-pt-settings-command-palette-open
            icon={<Command size={14} />}
            onClick={openMenu}
            type="primary"
          >
            {t('settings.commandPalette.open')}
          </Button>
        }
      />
    </SettingsContainer>
  );
}
