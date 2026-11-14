import { ListRow, ListSection, Switch, Text } from '@peers-touch/ui';
import { useMobileI18n } from '../../app/mobileI18n';
import type { NotificationPreferencesController } from './useSettingsController';

export function MePreferencesSection({ controller }: {
  readonly controller: Pick<NotificationPreferencesController, 'preferences' | 'loading' | 'unavailable' | 'saveStatus' | 'patch'>;
}) {
  const { t } = useMobileI18n();
  return <ListSection inset title={t('mobile.settings.group.preferences')}
    description={t('mobile.settings.preferencesHint')}>
    {([['enabled', 'mobile.settings.notifications.enabled'], ['soundEnabled', 'mobile.settings.notifications.sound']] as const).map(([field, label]) => {
      const count = controller.preferences.filter(preference => preference[field]).length;
      const mixed = count > 0 && count < controller.preferences.length;
      return <ListRow key={field} label={t(label)}
        description={mixed ? t('mobile.settings.notifications.mixed') : undefined}
        control={<Switch checked={count > 0} aria-label={t(label)}
          availability={controller.unavailable || controller.loading
            ? { kind: 'disabled', reason: t('mobile.settings.notifications.unavailable') }
            : controller.saveStatus === 'saving'
              ? { kind: 'disabled', reason: t('mobile.settings.dirty.saving') } : undefined}
          onCheckedChange={value => controller.patch(field, value)} />} />;
    })}
    {controller.saveStatus === 'saving' ? <Text role="status">{t('mobile.settings.dirty.saving')}</Text> : null}
  </ListSection>;
}
