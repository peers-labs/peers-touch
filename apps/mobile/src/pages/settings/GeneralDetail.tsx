import { Button, Typography } from 'antd';
import { useMobileI18n } from '../../app/mobileI18n';
import type { MobileAuthSession } from '../../features/auth/authSession';
import { requestSocialCurrentUserProfile } from '../../features/social/socialRuntime';
import { useSocialStore } from '../../features/social/socialStore';
import { MobileNotice } from '../../components/MobileNotice';
import { SettingsExitBoundary, type SettingsDraftOwner } from './SettingsExitBoundary';
import { SettingsAgentScope } from './SettingsAgentScope';
import { SettingsChoiceField } from './SettingsChoiceField';
import { DevicePrefsSection, LanguageSection, NotificationsSection, VISIBILITY_OPTIONS } from './SettingsSections';
import { useSettingsController, useNotificationPreferencesController } from './useSettingsController';
import { useAgentDefaultsController } from './useAgentDefaultsController';
import './agent-settings.css';

/** Only General mounts its preference owners; Me remains a scalar projection. */
export function GeneralDetail({ session, onBack }: {
  readonly session: MobileAuthSession | null; readonly onBack: () => void;
}) {
  const { t } = useMobileI18n();
  const profile = useSocialStore((state) => state.currentUserProfile);
  const updateProfile = useSocialStore((state) => state.updateCurrentUserProfile);
  const settings = useSettingsController(session, profile, updateProfile,
    () => requestSocialCurrentUserProfile(true),
    { profile: true, device: true, permissions: true, version: false });
  const notifications = useNotificationPreferencesController();
  const agent = useAgentDefaultsController(session);
  const owners: readonly SettingsDraftOwner[] = [
    {
      dirty: settings.devicePreferencesDirty, conflict: settings.devicePreferencesConflict,
      saveStatus: settings.devicePreferencesSaveStatus, saveError: settings.devicePreferencesSaveError,
      save: settings.saveDevicePreferences, discard: settings.discardDevicePreferences,
      reload: settings.reloadDevicePreferences,
    },
    {
      dirty: settings.profileDirty, conflict: settings.profileConflict,
      saveStatus: settings.profileSaveStatus, saveError: settings.profileSaveError,
      save: settings.saveProfile, discard: settings.discardProfile, reload: settings.reloadProfile,
    },
    notifications, agent.owner,
  ];
  // Each domain commits and reads back independently. A failed owner retains its
  // draft; earlier successful owners remain committed and are not falsely rolled back.
  const owner: SettingsDraftOwner = {
    dirty: owners.some((entry) => entry.dirty), conflict: owners.some((entry) => entry.conflict),
    saveStatus: owners.some((entry) => entry.saveStatus === 'saving') ? 'saving'
      : owners.some((entry) => entry.saveStatus === 'error') ? 'error' : 'idle',
    saveError: owners.find((entry) => entry.saveError)?.saveError ?? null,
    save: async () => {
      for (const entry of owners) if (entry.dirty && !await entry.save()) return false;
      return true;
    },
    discard: () => owners.forEach((entry) => entry.discard()),
    reload: async () => { for (const entry of owners) await entry.reload(); },
  };
  const providers = [...new Map(agent.models.filter((model) => model.enabled)
    .map((model) => [model.providerId, { value: model.providerId, label: model.providerName || model.providerId }])).values()];
  const models = agent.models.filter((model) => model.enabled && model.providerId === agent.draft?.providerId);
  const permission = settings.permissions.find((entry) => entry.kind === 'notifications');
  return <SettingsExitBoundary title={t('mobile.settings.general.title')} settingId="general" owner={owner} onBack={onBack}>
    <LanguageSection />
    <DevicePrefsSection prefs={settings.draftDevicePrefs} loading={settings.devicePreferencesLoading}
      unavailable={settings.devicePreferencesUnavailable} onPatch={settings.patchDevicePrefs}
      onRetry={settings.retryDevicePreferences} />
    <NotificationsSection controller={notifications} permission={permission}
      permissionLoading={settings.permissionsLoading} permissionUnavailable={settings.permissionsUnavailable}
      onRequestPermission={() => settings.requestPermission('notifications')} />
    <section className="settings-agent-editor">
      <Typography.Text strong>{t('mobile.settings.general.social')}</Typography.Text>
      {settings.profileAvailable ? <SettingsChoiceField
        label={t('mobile.settings.privacy.defaultVisibility')} value={settings.draftProfile?.defaultVisibility ?? ''}
        field="default-visibility" disabled={settings.profileSaveStatus === 'saving'}
        options={VISIBILITY_OPTIONS.map(({ value, labelKey }) => ({
          value, label: t(labelKey),
        }))} onChange={(value) => settings.patchProfile({ defaultVisibility: value })} />
        : <Button block onClick={() => void settings.retryProfile()}>{t('common.action.retry')}</Button>}
    </section>
    <section className="settings-agent-editor">
      <Typography.Text strong>{t('mobile.settings.general.agent')}</Typography.Text>
      <SettingsAgentScope agents={agent.agents} agentId={agent.agentId} loading={agent.loading}
        disabled={agent.busy} onChange={agent.selectAgent} />
      {agent.error ? <MobileNotice>{t(agent.error)}</MobileNotice> : null}
      {agent.draft ? <>
        <SettingsChoiceField label={t('mobile.settings.general.provider')} value={agent.draft.providerId}
          field="default-provider" disabled={agent.busy} options={providers}
          onChange={(providerId) => agent.patch({ providerId, modelName: '' })} />
        <SettingsChoiceField label={t('mobile.settings.general.model')} value={agent.draft.modelName}
          field="default-model" disabled={agent.busy}
          options={models.map((model) => ({ value: model.id, label: model.displayName || model.id }))}
          onChange={(modelName) => agent.patch({ modelName })} />
        <SettingsChoiceField label={t('mobile.settings.general.effort')} value={agent.draft.effort || 'medium'}
          field="default-effort" disabled={agent.busy}
          options={['low', 'medium', 'high'].map((value) => ({ value, label: t(`mobile.settings.general.effort.${value}`) }))}
          onChange={(effort) => agent.patch({ effort })} />
      </> : null}
    </section>
  </SettingsExitBoundary>;
}
