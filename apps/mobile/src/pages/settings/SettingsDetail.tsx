import { Button, Card, Empty, Spin, Typography } from 'antd';
import { useMobileI18n } from '../../app/mobileI18n';
import { requestSettingsExit, type MobileSettingDetailId } from '../../app/navigation';
import type { MobileAuthSession } from '../../features/auth/authSession';
import { requestSocialCurrentUserProfile } from '../../features/social/socialRuntime';
import { useSocialStore } from '../../features/social/socialStore';
import { activeStationEntry, type StoredStationRegistry } from '../../features/station/stationRegistry';
import { stationDisplayName } from '../../features/station/stationDisplayName';
import {
  useBlockedUsersController, useNotificationPreferencesController, useSettingsController,
} from './useSettingsController';
import {
  BlockedUsersSection, DevicePrefsSection, LanguageSection, NotificationsSection,
  PermissionsSection, PrivacySection, ProfileSection, StationSection, StorageSection,
} from './SettingsSections';
import { SettingsExitBoundary, type SettingsDraftOwner } from './SettingsExitBoundary';
import { findSetting } from './settingsCatalog';

const { Text } = Typography;

export interface SettingsDetailProps {
  readonly stationRegistry: StoredStationRegistry;
  readonly authSession: MobileAuthSession | null;
  readonly settingId: MobileSettingDetailId;
  readonly onBack: () => void;
  readonly onChangeStation: () => Promise<void>;
  readonly onLogout: () => void;
  readonly loggingOut: boolean;
}

function ProfileUnavailable({ reason, onRetry }: { reason: string | null; onRetry: () => Promise<void> }) {
  const { t } = useMobileI18n();
  return <Card className="settings-section" variant="borderless" role="alert" data-product-surface="settings.detail-unavailable">
    <Text type="secondary">{t(reason ?? 'mobile.settings.profileUnavailable')}</Text>
    <Button block onClick={() => void onRetry()}>{t('common.action.retry')}</Button>
  </Card>;
}

function BlockedUsersDetail() {
  const controller = useBlockedUsersController();
  return <BlockedUsersSection users={controller.users} status={controller.status}
    errorKey={controller.errorKey} unblockingPtid={controller.unblockingPtid}
    onRetry={controller.reload} onUnblock={controller.unblock} />;
}

/** The selected setting is the mounting and subscription boundary. */
export function SettingsDetail({
  stationRegistry, authSession, settingId, onBack, onChangeStation, onLogout, loggingOut,
}: SettingsDetailProps) {
  const { t } = useMobileI18n();
  const currentUserProfile = useSocialStore((state) => state.currentUserProfile);
  const updateCurrentUserProfile = useSocialStore((state) => state.updateCurrentUserProfile);
  const controller = useSettingsController(
    authSession, currentUserProfile, updateCurrentUserProfile,
    () => requestSocialCurrentUserProfile(true),
    {
      profile: settingId === 'account-info' || settingId === 'privacy-security',
      device: settingId === 'chat-settings',
      permissions: settingId === 'privacy-security' || settingId === 'notifications',
      version: settingId === 'about',
    },
  );
  const notificationController = useNotificationPreferencesController(settingId === 'notifications');
  const notificationPermission = controller.permissions.find((permission) => permission.kind === 'notifications');
  const selectedOwner: SettingsDraftOwner | null = settingId === 'account-info' || settingId === 'privacy-security'
    ? {
      dirty: controller.profileDirty, conflict: controller.profileConflict,
      saveStatus: controller.profileSaveStatus, saveError: controller.profileSaveError,
      save: controller.saveProfile, discard: controller.discardProfile, reload: controller.reloadProfile,
    } : settingId === 'chat-settings' ? {
      dirty: controller.devicePreferencesDirty, conflict: controller.devicePreferencesConflict,
      saveStatus: controller.devicePreferencesSaveStatus, saveError: controller.devicePreferencesSaveError,
      save: controller.saveDevicePreferences, discard: controller.discardDevicePreferences, reload: controller.reloadDevicePreferences,
    } : settingId === 'notifications' ? notificationController : null;
  const activeStation = activeStationEntry(stationRegistry);
  const title = t(findSetting(settingId)?.labelKey ?? 'mobile.settings.title');
  let content;
  switch (settingId) {
    case 'account-info':
      content = controller.profileAvailable ? <ProfileSection profile={controller.draftProfile}
        actorIdentity={authSession?.actorRef.acct} disabled={false} onPatch={controller.patchProfile} />
        : <ProfileUnavailable reason={controller.profileUnavailableReason} onRetry={controller.retryProfile} />;
      break;
    case 'notifications':
      content = <NotificationsSection controller={notificationController} permission={notificationPermission}
        permissionLoading={controller.permissionsLoading} permissionUnavailable={controller.permissionsUnavailable}
        onRequestPermission={() => controller.requestPermission('notifications')} />;
      break;
    case 'privacy-security':
      content = <>
        {controller.profileAvailable ? <PrivacySection profile={controller.draftProfile} disabled={false} onPatch={controller.patchProfile} />
          : <ProfileUnavailable reason={controller.profileUnavailableReason} onRetry={controller.retryProfile} />}
        <PermissionsSection permissions={controller.permissions} loading={controller.permissionsLoading}
          unavailable={controller.permissionsUnavailable} onRefresh={controller.refreshPermissions} onRequest={controller.requestPermission} />
      </>;
      break;
    case 'blocked-users':
      content = <BlockedUsersDetail />;
      break;
    case 'chat-settings':
      content = <>
        <DevicePrefsSection prefs={controller.draftDevicePrefs} loading={controller.devicePreferencesLoading}
          unavailable={controller.devicePreferencesUnavailable} onPatch={controller.patchDevicePrefs} onRetry={controller.retryDevicePreferences} />
      </>;
      break;
    case 'storage':
      content = <StorageSection status={controller.cacheClearStatus} onClearCache={controller.clearCache} />;
      break;
    case 'station-connection':
      content = <StationSection stationLabel={activeStation ? stationDisplayName(
        activeStation.label, activeStation.url, t('common.stationPicker.fallbackLabel'),
      ) : t('mobile.settings.stationNotSelected')}
        stationUrl={activeStation?.url ?? ''} identityVerified={activeStation?.identityVerified === true}
        onChangeStation={async () => requestSettingsExit(onChangeStation)} onLogout={onLogout} loggingOut={loggingOut} />;
      break;
    case 'language':
      content = <LanguageSection />;
      break;
    case 'about':
      content = <Card className="settings-section" variant="borderless">
        <div className="settings-row"><Text>{title}</Text><Text type="secondary">{controller.appVersion ?? t('mobile.launch.unavailable')}</Text></div>
      </Card>;
      break;
    default:
      content = <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.launch.unavailable')} />;
  }
  return <SettingsExitBoundary title={title} settingId={settingId} owner={selectedOwner} onBack={onBack}>
    {controller.loading ? <Spin /> : content}
  </SettingsExitBoundary>;
}
