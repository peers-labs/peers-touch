import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Alert, Spin, Switch, Typography, message, theme } from 'antd';
import {
  Bell,
  ListTodo,
  MessageCircle,
  ShieldAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { NotificationCategory } from '../../gen/proto/domain/notification/notification_pb';
import type {
  NotificationPreferenceData,
  NotificationPreferencePatchInput,
} from '../../services/desktop_api';
import { useActiveSettingsSlice } from './useActiveSettingsStores';
import { NotificationPushDevices } from './NotificationPushDevices';
import {
  SettingsContainer,
  SettingsRow,
  SettingsSection,
} from './SettingsLayout';

const { Text } = Typography;

const CATEGORY_DEFINITIONS: ReadonlyArray<{
  category: NotificationCategory;
  icon: LucideIcon;
  localeKey: 'social' | 'chat' | 'system' | 'task';
}> = [
  {
    category: NotificationCategory.SOCIAL,
    icon: Users,
    localeKey: 'social',
  },
  {
    category: NotificationCategory.CHAT,
    icon: MessageCircle,
    localeKey: 'chat',
  },
  {
    category: NotificationCategory.SYSTEM,
    icon: ShieldAlert,
    localeKey: 'system',
  },
  {
    category: NotificationCategory.TASK,
    icon: ListTodo,
    localeKey: 'task',
  },
];

type PreferencePatch = Omit<NotificationPreferencePatchInput, 'category'>;

function preferencePatch(
  preference: NotificationPreferenceData,
  field: keyof PreferencePatch,
  value: boolean,
): PreferencePatch {
  return {
    enabled: preference.enabled,
    pushEnabled: preference.pushEnabled,
    soundEnabled: preference.soundEnabled,
    [field]: value,
  };
}

export function NotificationSettings() {
  const { t } = useTranslation('settings');
  const { token } = theme.useToken();
  const {
    preferences,
    loading,
    error,
    savingCategory,
    updatePreference,
  } = useActiveSettingsSlice((state) => ({
    preferences: state.notificationPreferences,
    loading: state.notificationPreferencesLoading,
    error: state.notificationPreferencesError,
    savingCategory: state.notificationPreferenceSavingCategory,
    updatePreference: state.updateNotificationPreference,
  }));

  const save = async (
    preference: NotificationPreferenceData,
    field: keyof PreferencePatch,
    value: boolean,
  ) => {
    try {
      await updatePreference(
        preference.category,
        preferencePatch(preference, field, value),
      );
    } catch (saveError) {
      if (
        saveError instanceof Error
        && saveError.message === 'notification.preferences.conflict'
      ) {
        message.warning(t('settings.notifications.conflict'));
        return;
      }
      message.error(t('settings.notifications.saveFailed'));
    }
  };

  return (
    <SettingsContainer>
      <SettingsSection
        icon={<Bell size={18} />}
        title={t('settings.notifications.title')}
        subtitle={t('settings.notifications.subtitle')}
      >
        {error ? (
          <Alert
            type="warning"
            showIcon
            message={t('settings.notifications.loadFailed')}
            description={error}
          />
        ) : null}

        {loading && preferences.length === 0 ? (
          <Flexbox horizontal align="center" gap={8}>
            <Spin size="small" />
            <Text type="secondary">{t('settings.notifications.loading')}</Text>
          </Flexbox>
        ) : (
          <Flexbox gap={0}>
            {CATEGORY_DEFINITIONS.map((definition, index) => {
              const preference = preferences.find(
                (item) => item.category === definition.category,
              );
              const CategoryIcon = definition.icon;
              const saving = savingCategory === definition.category;
              return (
                <Flexbox
                  key={definition.category}
                  gap={12}
                  data-notification-category={definition.localeKey}
                  style={{
                    borderTop: index === 0
                      ? undefined
                      : `1px solid ${token.colorBorderSecondary}`,
                    paddingBlock: 14,
                  }}
                >
                  <Flexbox horizontal align="center" gap={8}>
                    <CategoryIcon size={16} color={token.colorTextSecondary} />
                    <Flexbox gap={1}>
                      <Text strong>
                        {t(`settings.notifications.category.${definition.localeKey}.title`)}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {t(`settings.notifications.category.${definition.localeKey}.description`)}
                      </Text>
                    </Flexbox>
                  </Flexbox>

                  {preference ? (
                    <Flexbox gap={12}>
                      <SettingsRow
                        label={t('settings.notifications.enabled')}
                        description={t('settings.notifications.enabledDescription')}
                      >
                        <Switch
                          checked={preference.enabled}
                          loading={saving}
                          disabled={savingCategory !== null}
                          onChange={(checked) => save(preference, 'enabled', checked)}
                          aria-label={t('settings.notifications.enabled')}
                        />
                      </SettingsRow>
                      <SettingsRow
                        label={t('settings.notifications.push')}
                        description={t('settings.notifications.pushDescription')}
                      >
                        <Switch
                          checked={preference.pushEnabled}
                          loading={saving}
                          disabled={!preference.enabled || savingCategory !== null}
                          onChange={(checked) => save(preference, 'pushEnabled', checked)}
                          aria-label={t('settings.notifications.push')}
                        />
                      </SettingsRow>
                      <SettingsRow
                        label={t('settings.notifications.sound')}
                        description={t('settings.notifications.soundDescription')}
                      >
                        <Switch
                          checked={preference.soundEnabled}
                          loading={saving}
                          disabled={!preference.enabled || savingCategory !== null}
                          onChange={(checked) => save(preference, 'soundEnabled', checked)}
                          aria-label={t('settings.notifications.sound')}
                        />
                      </SettingsRow>
                    </Flexbox>
                  ) : (
                    <Text type="secondary">
                      {t('settings.notifications.categoryUnavailable')}
                    </Text>
                  )}
                </Flexbox>
              );
            })}
          </Flexbox>
        )}
      </SettingsSection>
      <NotificationPushDevices />
    </SettingsContainer>
  );
}
