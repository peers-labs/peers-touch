/**
 * SettingsPage.tsx — Pure renderer for the Settings / "Me" tab.
 *
 * Visual hierarchy aligned with the prototype ProfilePage:
 * - Header: "Me" title + Settings gear button
 * - Profile header card: Avatar 64px + name + PTID + chevron,
 *   stats row (Friends / Groups / Moments)
 * - Setting groups: Account, Chat, Network, About
 *   Each row: colored icon in tinted bg + label + optional value + chevron
 * - Sign Out button at bottom
 *
 * This page is a pure renderer. All data comes from:
 *   - useSettingsController (dirty/save/discard/conflict lifecycle)
 *   - profile projection (W5, via controller)
 *   - social store (blocked users)
 *   - station registry (station card)
 *
 * The page never fetches or persists data directly.
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, Dialog, Empty, Icon, Spin, Text, type IconId } from '@peers-touch/ui';

import { confirmDestructive } from '../app/feedback/mobileFeedback';
import { useMobileI18n } from '../app/mobileI18n';
import {
  registerSettingsExitGuard,
  type MobileSettingDetailId,
  type SettingsExitAction,
} from '../app/navigation';
import type { MobileAuthSession } from '../features/auth/authSession';
import { requestSocialCurrentUserProfile } from '../features/social/socialRuntime';
import { projectAcceptedContacts } from '../features/social/socialProjection';
import { useSocialStore } from '../features/social/socialStore';
import {
  activeStationRoute,
  activeStationEntry,
  stationRoutes,
  type MobileStationRouteCandidate,
  type StoredStationRegistry,
} from '../features/station/stationRegistry';
import { stationDisplayName } from '../features/station/stationDisplayName';
import { MobileAvatar } from '../components/MobileAvatar';
import { useSettingsSurfaceFixture } from '../acceptance/settingsSurfaceFixture';
import {
  useBlockedUsersController,
  useNotificationPreferencesController,
  useSettingsController,
} from './settings/useSettingsController';
import { SettingsAcceptanceSurface } from './settings/SettingsAcceptanceSurface';
import {
  BlockedUsersSection,
  DevicePrefsSection,
  DirtyBar,
  LanguageSection,
  NotificationsSection,
  PermissionsSection,
  PrivacySection,
  ProfileSection,
  StationSection,
  StorageSection,
} from './settings/SettingsSections';

const tintAccent = 'var(--pt-accent)';
const tintWarning = 'var(--pt-warning)';
const tintSuccess = 'var(--pt-success)';
const tintDanger = 'var(--pt-danger)';
const tintInfo = 'var(--pt-info)';

interface SettingEntry {
  id: MobileSettingDetailId;
  labelKey: string;
  icon: IconId;
  tint: string;
  valueKey?: string | undefined;
  valueOverride?: string | undefined;
}

interface SettingGroup {
  titleKey: string;
  items: SettingEntry[];
}

// ---------------------------------------------------------------------------
// Page props — the shell passes only what the page cannot own
// ---------------------------------------------------------------------------

interface SettingsPageProps {
  readonly stationRegistry: StoredStationRegistry;
  readonly authSession: MobileAuthSession | null;
  readonly activeSettingId: MobileSettingDetailId | null;
  readonly onOpenSetting: (settingId: MobileSettingDetailId) => void;
  readonly onBack: () => void;
  readonly searchEntry?: ReactNode;
  readonly onChangeStation: () => Promise<void>;
  readonly onChangeStationRoute: (
    stationPeerId: string,
    route: MobileStationRouteCandidate,
  ) => Promise<void>;
  readonly onLogout: () => Promise<void>;
}

function ProfileUnavailable({
  reason,
  onRetry,
}: {
  readonly reason: string | null;
  readonly onRetry: () => Promise<void>;
}) {
  const { t } = useMobileI18n();
  return (
    <section
      className="settings-section"
      role="alert"
      data-product-surface="settings.detail-unavailable"
    >
      <div className="settings-section-body">
        <Text tone="secondary">
          {t(reason ?? 'mobile.settings.profileUnavailable')}
        </Text>
        <Button
          actionId="settings-detail-retry"
          fullWidth
          onActivate={() => void onRetry()}
        >
          {t('common.action.retry')}
        </Button>
      </div>
    </section>
  );
}

function BlockedUsersDetail() {
  const controller = useBlockedUsersController();
  return (
    <BlockedUsersSection
      users={controller.users}
      status={controller.status}
      errorKey={controller.errorKey}
      unblockingPtid={controller.unblockingPtid}
      onRetry={controller.reload}
      onUnblock={controller.unblock}
    />
  );
}

// ---------------------------------------------------------------------------
// SettingsPage — pure renderer (prototype ProfilePage layout)
// ---------------------------------------------------------------------------

export function SettingsPage(props: SettingsPageProps) {
  const fixture = useSettingsSurfaceFixture();
  if (fixture.surfaceId) {
    return (
      <SettingsAcceptanceSurface
        key={`${fixture.surfaceId}:${fixture.revision}`}
        surfaceId={fixture.surfaceId}
      />
    );
  }
  return <SettingsPageContent {...props} />;
}

function SettingsPageContent({
  stationRegistry,
  authSession,
  activeSettingId,
  onOpenSetting,
  onBack,
  searchEntry,
  onChangeStation,
  onChangeStationRoute,
  onLogout,
}: SettingsPageProps) {
  const { t, language } = useMobileI18n();
  const [loggingOut, setLoggingOut] = useState(false);
  const [pendingExit, setPendingExit] = useState<{
    readonly action: SettingsExitAction;
  } | null>(null);
  const [exitSaving, setExitSaving] = useState(false);

  const activeStation = activeStationEntry(stationRegistry);
  const unavailableLabel = t('mobile.launch.unavailable');
  const activeStationLabel = stationDisplayName(
    activeStation?.label ?? '',
    activeStation?.url ?? '',
    t('common.stationPicker.fallbackLabel'),
  );
  const currentUserProfile = useSocialStore((state) => state.currentUserProfile);
  const updateCurrentUserProfile = useSocialStore(
    (state) => state.updateCurrentUserProfile,
  );
  const blockedUsersOwnerAvailable = useSocialStore(
    (state) => state.socialGateway !== null,
  );
  const blockedUsersProjectionReady = useSocialStore(
    (state) => state.lastReconcileAt !== null && state.error === null,
  );
  const blockedUsersCount = useSocialStore((state) => state.blockedUsers.length);
  const currentUserPtid = useSocialStore((state) => state.currentUserPtid);
  const friendRequests = useSocialStore((state) => state.friendRequests);
  const peerOnline = useSocialStore((state) => state.peerOnline);
  const peerProfiles = useSocialStore((state) => state.peerProfiles);
  const groupCount = useSocialStore((state) => state.messagingConversations.reduce(
    (count, conversation) => count + Number(
      conversation.active && conversation.kind === 2,
    ),
    0,
  ));

  const friendCount = useMemo(
    () => projectAcceptedContacts(
      friendRequests,
      currentUserPtid,
      peerOnline,
      peerProfiles,
    ).length,
    [currentUserPtid, friendRequests, peerOnline, peerProfiles],
  );

  // Settings controller — owns dirty/save/discard/conflict lifecycle
  const controller = useSettingsController(
    authSession,
    currentUserProfile,
    updateCurrentUserProfile,
    () => requestSocialCurrentUserProfile(true),
  );
  const visibleProfile = controller.profileAvailable ? currentUserProfile : null;
  const displayName = visibleProfile?.displayName || authSession?.actorRef.acct;
  const momentsCount = visibleProfile?.statusesCount ?? unavailableLabel;
  const notificationController = useNotificationPreferencesController();
  const notificationPermission = controller.permissions.find(
    (permission) => permission.kind === 'notifications',
  );
  const selectedOwner = (() => {
    switch (activeSettingId) {
      case 'account-info':
      case 'privacy-security':
        return {
          dirty: controller.profileDirty,
          conflict: controller.profileConflict,
          saveStatus: controller.profileSaveStatus,
          saveError: controller.profileSaveError,
          save: controller.saveProfile,
          discard: controller.discardProfile,
          reload: controller.reloadProfile,
        };
      case 'notifications':
        return notificationController;
      case 'chat-settings':
        return {
          dirty: controller.devicePreferencesDirty,
          conflict: controller.devicePreferencesConflict,
          saveStatus: controller.devicePreferencesSaveStatus,
          saveError: controller.devicePreferencesSaveError,
          save: controller.saveDevicePreferences,
          discard: controller.discardDevicePreferences,
          reload: controller.reloadDevicePreferences,
        };
      default:
        return null;
    }
  })();
  const settingsDirty = selectedOwner?.dirty ?? false;
  const settingsConflict = selectedOwner?.conflict ?? false;
  const settingsSaveStatus = selectedOwner?.saveStatus ?? 'idle';
  const settingsSaveError = selectedOwner?.saveError ?? null;

  const requestExit = useCallback((action: SettingsExitAction) => {
    if (!settingsDirty) {
      void action();
      return;
    }
    setPendingExit({ action });
  }, [settingsDirty]);

  useEffect(
    () => registerSettingsExitGuard(requestExit),
    [requestExit],
  );

  const finishPendingExit = useCallback(async () => {
    const pending = pendingExit;
    setPendingExit(null);
    if (pending) await pending.action();
  }, [pendingExit]);

  const saveAndExit = useCallback(async () => {
    setExitSaving(true);
    const saved = selectedOwner ? await selectedOwner.save() : true;
    setExitSaving(false);
    if (saved) {
      await finishPendingExit();
    }
  }, [finishPendingExit, selectedOwner]);

  const discardAndExit = useCallback(async () => {
    selectedOwner?.discard();
    await finishPendingExit();
  }, [finishPendingExit, selectedOwner]);

  // --- Setting groups (prototype-aligned) ---
  const settingGroups: SettingGroup[] = useMemo(() => [
    {
      titleKey: 'mobile.settings.group.account',
      items: [
        { id: 'account-info', labelKey: 'mobile.settings.accountInfo', icon: 'user', tint: tintAccent },
        { id: 'notifications', labelKey: 'mobile.settings.section.notifications', valueOverride: notificationController.unavailable ? unavailableLabel : undefined, icon: 'bell', tint: tintWarning },
        { id: 'privacy-security', labelKey: 'mobile.settings.privacySecurity', icon: 'shield', tint: tintSuccess },
        {
          id: 'blocked-users',
          labelKey: 'mobile.settings.blockedUsers',
          valueOverride: !blockedUsersOwnerAvailable
            ? unavailableLabel
            : blockedUsersProjectionReady
              ? String(blockedUsersCount)
              : undefined,
          icon: 'ban',
          tint: tintDanger,
        },
      ],
    },
    {
      titleKey: 'mobile.settings.group.chat',
      items: [
        { id: 'chat-settings', labelKey: 'mobile.settings.chatSettings', icon: 'message-circle', tint: tintAccent },
      ],
    },
    {
      titleKey: 'mobile.settings.group.network',
      items: [
        { id: 'station-connection', labelKey: 'mobile.settings.stationConnection', valueOverride: activeStation ? activeStationLabel : t('mobile.settings.stationNotSelected'), icon: 'server', tint: tintSuccess },
        { id: 'language', labelKey: 'mobile.settings.section.language', valueOverride: language === 'zh-CN' ? '简体中文' : 'English', icon: 'globe', tint: tintInfo },
      ],
    },
    {
      titleKey: 'mobile.settings.group.about',
      items: [
        { id: 'about', labelKey: 'mobile.settings.aboutApp', valueOverride: controller.appVersion ?? unavailableLabel, icon: 'shield-check', tint: tintWarning },
      ],
    },
  ], [
    activeStation,
    activeStationLabel,
    controller.appVersion,
    blockedUsersCount,
    blockedUsersOwnerAvailable,
    blockedUsersProjectionReady,
    language,
    notificationController.unavailable,
    t,
    unavailableLabel,
  ]);
  const activeSetting = useMemo(
    () => settingGroups.flatMap((group) => group.items).find(
      (item) => item.id === activeSettingId,
    ) ?? null,
    [activeSettingId, settingGroups],
  );
  const activeSettingIconId = activeSetting?.icon ?? null;

  const profileSubtitle = t('mobile.settings.connected');

  // --- Logout flow ---
  const handleLogoutConfirm = useCallback(async () => {
    setLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setLoggingOut(false);
    }
  }, [onLogout]);

  const confirmLogout = useCallback(() => {
    void confirmDestructive({
      title: t('mobile.settings.station.logoutConfirmTitle'),
      description: t('mobile.settings.station.logoutConfirmBody'),
      confirmLabel: t('mobile.settings.logout'),
      cancelLabel: t('common.action.cancel'),
      onConfirm: () => void handleLogoutConfirm(),
    });
  }, [handleLogoutConfirm, t]);

  const requestLogout = useCallback(() => {
    requestExit(confirmLogout);
  }, [confirmLogout, requestExit]);

  const detailContent = (() => {
    switch (activeSettingId) {
      case 'account-info':
        return controller.profileAvailable ? (
          <ProfileSection
            profile={controller.draftProfile}
            actorIdentity={authSession?.actorRef.acct}
            disabled={false}
            onPatch={controller.patchProfile}
          />
        ) : (
          <ProfileUnavailable
            reason={controller.profileUnavailableReason}
            onRetry={controller.retryProfile}
          />
        );
      case 'notifications':
        return (
          <NotificationsSection
            controller={notificationController}
            permission={notificationPermission}
            permissionLoading={controller.permissionsLoading}
            permissionUnavailable={controller.permissionsUnavailable}
            onRequestPermission={() => controller.requestPermission('notifications')}
          />
        );
      case 'privacy-security':
        return (
          <>
            {controller.profileAvailable ? (
              <PrivacySection
                profile={controller.draftProfile}
                disabled={false}
                onPatch={controller.patchProfile}
              />
            ) : (
              <ProfileUnavailable
                reason={controller.profileUnavailableReason}
                onRetry={controller.retryProfile}
              />
            )}
            <PermissionsSection
              permissions={controller.permissions}
              loading={controller.permissionsLoading}
              unavailable={controller.permissionsUnavailable}
              onRefresh={controller.refreshPermissions}
              onRequest={controller.requestPermission}
            />
          </>
        );
      case 'blocked-users':
        return <BlockedUsersDetail />;
      case 'chat-settings':
        return (
          <>
            <DevicePrefsSection
              prefs={controller.draftDevicePrefs}
              loading={controller.devicePreferencesLoading}
              unavailable={controller.devicePreferencesUnavailable}
              onPatch={controller.patchDevicePrefs}
              onRetry={controller.retryDevicePreferences}
            />
            <StorageSection
              status={controller.cacheClearStatus}
              onClearCache={controller.clearCache}
            />
          </>
        );
      case 'station-connection':
        return (
          <StationSection
            stationLabel={activeStation ? activeStationLabel : t('mobile.settings.stationNotSelected')}
            stationUrl={activeStation?.url || ''}
            identityVerified={activeStation?.identityVerified === true}
            routes={activeStation ? stationRoutes(activeStation) : []}
            activeRouteId={activeStation ? activeStationRoute(activeStation)?.routeId ?? '' : ''}
            onChangeRoute={async (route) => {
              if (!activeStation) return;
              await onChangeStationRoute(activeStation.stationPeerId, route);
            }}
            onChangeStation={async () => requestExit(onChangeStation)}
            onLogout={requestLogout}
            loggingOut={loggingOut}
          />
        );
      case 'language':
        return <LanguageSection />;
      case 'encryption':
      case 'about':
        return (
          <section className="settings-section">
            <div className="settings-section-body">
              <div className="settings-section-header">
                {activeSettingIconId ? <Icon iconId={activeSettingIconId} size={16} /> : null}
                <Text strong>{activeSetting ? t(activeSetting.labelKey) : t('mobile.settings.title')}</Text>
              </div>
              {activeSetting?.valueOverride ? (
                <div className="settings-row">
                  <Text>{t(activeSetting.labelKey)}</Text>
                  <Text tone="secondary">{activeSetting.valueOverride}</Text>
                </div>
              ) : null}
            </div>
          </section>
        );
      case 'safety-number':
      case 'chat-background':
        return (
          <Empty description={t('mobile.launch.unavailable')} />
        );
      default:
        return null;
    }
  })();

  // --- Render ---
  if (controller.loading) {
    return (
      <div
        className="page-container settings-loading"
        data-product-surface="settings.summary-loading"
      >
        <h1 className="sr-only">{t('mobile.settings.title')}</h1>
        <Spin />
      </div>
    );
  }

  const content = activeSettingId ? (
    <div
      className="page-container settings-page mobile-detail-page"
      data-product-surface={`settings.${activeSettingId}`}
    >
      <header className="page-header">
        <button
          type="button"
          className="header-action"
          aria-label={t('common.action.back')}
          onClick={() => requestExit(onBack)}
        >
          <Icon iconId="arrow-left" size={20} />
        </button>
        <h1 className="header-title compact">
          {activeSetting ? t(activeSetting.labelKey) : t('mobile.settings.title')}
        </h1>
      </header>
      <div className="settings-detail-body">
        {selectedOwner ? (
          <DirtyBar
            dirty={settingsDirty}
            conflict={settingsConflict}
            saveStatus={settingsSaveStatus}
            saveError={settingsSaveError}
            onSave={() => void selectedOwner.save()}
            onDiscard={selectedOwner.discard}
            onReload={() => void selectedOwner.reload()}
          />
        ) : null}
        {detailContent}
      </div>
    </div>
  ) : (
    <div
      className="page-container settings-page"
      data-product-surface="settings.summary"
    >
      {/* The page is already Settings; profile details remain the first row. */}
      <header className="page-header">
        <h1 className="header-title">{t('mobile.settings.title')}</h1>
        {searchEntry}
      </header>

      <div className="settings-body">
        {/* Profile header card — Avatar 64px + friendly identity + chevron + stats */}
        <button
          type="button"
          className="settings-profile-trigger"
          onClick={() => onOpenSetting('account-info')}
        >
          <div className="settings-profile-header-card">
            <div className="settings-profile-header">
              <MobileAvatar
                size={64}
                src={visibleProfile?.avatar}
                identityKey={currentUserPtid || ''}
                name={displayName || t('mobile.settings.notLoggedIn')}
              >
                {displayName ? displayName.slice(0, 2).toUpperCase() : '?'}
              </MobileAvatar>
              <div className="settings-profile-info">
                <Text strong className="settings-profile-name">
                  {displayName || t('mobile.settings.notLoggedIn')}
                </Text>
                <Text tone="secondary" className="settings-profile-subtitle">
                  {profileSubtitle}
                </Text>
              </div>
              <Icon iconId="chevron-right" size={20} className="settings-profile-chevron" />
            </div>
            <div className="settings-profile-stats">
              <div className="settings-stat">
                <Text strong className="settings-stat-value">{friendCount}</Text>
                <Text tone="secondary" className="settings-stat-label">
                  {t('mobile.settings.stats.friends')}
                </Text>
              </div>
              <div className="settings-stat-divider" />
              <div className="settings-stat">
                <Text strong className="settings-stat-value">{groupCount}</Text>
                <Text tone="secondary" className="settings-stat-label">
                  {t('mobile.settings.stats.groups')}
                </Text>
              </div>
              <div className="settings-stat-divider" />
              <div className="settings-stat">
                <Text strong className="settings-stat-value">{momentsCount}</Text>
                <Text tone="secondary" className="settings-stat-label">
                  {t('mobile.settings.stats.moments')}
                </Text>
              </div>
            </div>
          </div>
        </button>

        {/* Setting groups (prototype-aligned) */}
        {settingGroups.map((group) => (
          <div key={group.titleKey} className="settings-group-block">
            <div className="settings-group-block-title">{t(group.titleKey)}</div>
            <div className="settings-group-card">
              {group.items.map((item, idx) => {
                const displayValue = item.valueOverride ?? (item.valueKey ? t(item.valueKey) : undefined);
                const iconStyle = { '--setting-tint': item.tint } as CSSProperties;
                return (
                  <button
                    type="button"
                    key={item.labelKey}
                    className={`setting-row ${idx > 0 ? 'setting-row--border' : ''}`}
                    onClick={() => onOpenSetting(item.id)}
                  >
                    <span
                      className="setting-row-icon"
                      style={iconStyle}
                    >
                      <Icon iconId={item.icon} size={17} />
                    </span>
                    <Text className="setting-row-label">{t(item.labelKey)}</Text>
                    {displayValue && (
                      <Text tone="secondary" className="setting-row-value">
                        {displayValue}
                      </Text>
                    )}
                    <Icon iconId="chevron-right" size={17} className="setting-row-chevron" />
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Sign Out button */}
        <button
          type="button"
          className="settings-sign-out"
          onClick={requestLogout}
          disabled={loggingOut}
        >
          {loggingOut ? t('mobile.settings.station.loggingOut') : t('mobile.settings.signOut')}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {content}
      <Dialog
        title={t('mobile.settings.exit.title')}
        open={pendingExit !== null}
        closeLabel={t('common.action.close')}
        dismissOutside={false}
        onDismiss={() => setPendingExit(null)}
        footer={
          <div className="settings-exit-actions">
            <Button
              actionId="settings-exit-stay"
              emphasis="secondary"
              availability={exitSaving
                ? { kind: 'disabled', reason: t('mobile.settings.exit.stay') }
                : undefined}
              onActivate={() => setPendingExit(null)}
            >
              {t('mobile.settings.exit.stay')}
            </Button>
            <Button
              actionId="settings-exit-discard"
              tone="danger"
              availability={exitSaving
                ? { kind: 'disabled', reason: t('mobile.settings.exit.discard') }
                : undefined}
              onActivate={() => void discardAndExit()}
            >
              {t('mobile.settings.exit.discard')}
            </Button>
            <Button
              actionId="settings-exit-save"
              emphasis="primary"
              execution={exitSaving ? 'pending' : 'idle'}
              onActivate={() => void saveAndExit()}
            >
              {t('mobile.settings.exit.save')}
            </Button>
          </div>
        }
      >
        <div
          data-acceptance-id="settings-unsaved-exit"
          data-product-surface="settings.unsaved-exit"
        >
          {t('mobile.settings.exit.body')}
        </div>
      </Dialog>
    </>
  );
}
