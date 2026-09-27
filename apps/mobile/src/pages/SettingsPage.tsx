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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar, Button, Card, Empty, Modal, Spin, Typography } from 'antd';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft,
  Ban,
  Bell,
  ChevronRight,
  Fingerprint,
  Globe,
  Image as ImageIcon,
  MessageCircle,
  Server,
  Settings as SettingsIcon,
  Shield,
  ShieldCheck,
  User,
} from 'lucide-react';

import { useMobileI18n } from '../app/mobileI18n';
import {
  registerSettingsExitGuard,
  type MobileSettingDetailId,
  type SettingsExitAction,
} from '../app/navigation';
import type { MobileAuthSession } from '../features/auth/authSession';
import { useGroupStore } from '../features/group/groupStore';
import { requestSocialCurrentUserProfile } from '../features/social/socialRuntime';
import { useSocialStore } from '../features/social/socialStore';
import {
  activeStationEntry,
  type StoredStationRegistry,
} from '../features/station/stationRegistry';
import {
  useBlockedUsersController,
  useNotificationPreferencesController,
  useSettingsController,
} from './settings/useSettingsController';
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

const { Text } = Typography;

// ---------------------------------------------------------------------------
// Setting group types (prototype-aligned)
// ---------------------------------------------------------------------------

interface SettingEntry {
  id: MobileSettingDetailId;
  labelKey: string;
  icon: LucideIcon;
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
  readonly onChangeStation: () => Promise<void>;
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
    <Card className="settings-section" variant="borderless" role="alert">
      <Text type="secondary">
        {t(reason ?? 'mobile.settings.profileUnavailable')}
      </Text>
      <Button block onClick={() => void onRetry()}>
        {t('common.action.retry')}
      </Button>
    </Card>
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

export function SettingsPage({
  stationRegistry,
  authSession,
  activeSettingId,
  onOpenSetting,
  onBack,
  onChangeStation,
  onLogout,
}: SettingsPageProps) {
  const { t, language } = useMobileI18n();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [pendingExit, setPendingExit] = useState<{
    readonly action: SettingsExitAction;
  } | null>(null);
  const [exitSaving, setExitSaving] = useState(false);

  const activeStation = activeStationEntry(stationRegistry);
  const unavailableLabel = t('mobile.launch.unavailable');
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

  // Friendship status is a per-target cache, not a canonical total.
  const friendCount = unavailableLabel;
  const groupCount = useGroupStore((state) => state.groups.length);

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

  const requestLogout = useCallback(() => {
    requestExit(() => setLogoutConfirmOpen(true));
  }, [requestExit]);

  // --- Setting groups (prototype-aligned) ---
  const settingGroups: SettingGroup[] = useMemo(() => [
    {
      titleKey: 'mobile.settings.group.account',
      items: [
        { id: 'account-info', labelKey: 'mobile.settings.accountInfo', icon: User, tint: '#6366f1' },
        { id: 'notifications', labelKey: 'mobile.settings.section.notifications', valueOverride: notificationController.unavailable ? unavailableLabel : undefined, icon: Bell, tint: '#f59e0b' },
        { id: 'privacy-security', labelKey: 'mobile.settings.privacySecurity', icon: Shield, tint: '#22c55e' },
        { id: 'safety-number', labelKey: 'mobile.settings.safetyNumber', icon: Fingerprint, tint: '#0ea5e9' },
        {
          id: 'blocked-users',
          labelKey: 'mobile.settings.blockedUsers',
          valueOverride: !blockedUsersOwnerAvailable
            ? unavailableLabel
            : blockedUsersProjectionReady
              ? String(blockedUsersCount)
              : undefined,
          icon: Ban,
          tint: '#ef4444',
        },
      ],
    },
    {
      titleKey: 'mobile.settings.group.chat',
      items: [
        { id: 'chat-settings', labelKey: 'mobile.settings.chatSettings', icon: MessageCircle, tint: '#6366f1' },
        { id: 'chat-background', labelKey: 'mobile.settings.chatBackground', icon: ImageIcon, tint: '#ec4899' },
      ],
    },
    {
      titleKey: 'mobile.settings.group.network',
      items: [
        { id: 'station-connection', labelKey: 'mobile.settings.stationConnection', valueOverride: activeStation?.label || t('mobile.settings.stationNotSelected'), icon: Server, tint: '#22c55e' },
        { id: 'encryption', labelKey: 'mobile.settings.encryption', valueOverride: unavailableLabel, icon: ShieldCheck, tint: '#6366f1' },
        { id: 'language', labelKey: 'mobile.settings.section.language', valueOverride: language === 'zh-CN' ? '简体中文' : 'English', icon: Globe, tint: '#0ea5e9' },
      ],
    },
    {
      titleKey: 'mobile.settings.group.about',
      items: [
        { id: 'about', labelKey: 'mobile.settings.aboutApp', valueOverride: controller.appVersion ?? unavailableLabel, icon: ShieldCheck, tint: '#f59e0b' },
      ],
    },
  ], [
    activeStation,
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
  const ActiveSettingIcon = activeSetting?.icon;

  // --- PTID display ---
  const ptidDisplay = authSession?.actorRef.ptid
    ? `ptid:${String(authSession.actorRef.ptid).slice(0, 24)}...`
    : '';

  // --- Logout flow ---
  const handleLogoutConfirm = useCallback(async () => {
    setLogoutConfirmOpen(false);
    setLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setLoggingOut(false);
    }
  }, [onLogout]);

  const detailContent = (() => {
    switch (activeSettingId) {
      case 'account-info':
        return controller.profileAvailable ? (
          <ProfileSection
            profile={controller.draftProfile}
            actorPtid={authSession?.actorRef.ptid}
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
            stationLabel={activeStation?.label || t('mobile.settings.stationNotSelected')}
            stationUrl={activeStation?.url || ''}
            identityVerified={activeStation?.identityVerified === true}
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
          <Card className="settings-section" variant="borderless">
            <div className="settings-section-header">
              {ActiveSettingIcon ? <ActiveSettingIcon size={16} /> : null}
              <Text strong>{activeSetting ? t(activeSetting.labelKey) : t('mobile.settings.title')}</Text>
            </div>
            {activeSetting?.valueOverride ? (
              <div className="settings-row">
                <Text>{t(activeSetting.labelKey)}</Text>
                <Text type="secondary">{activeSetting.valueOverride}</Text>
              </div>
            ) : null}
          </Card>
        );
      case 'safety-number':
      case 'chat-background':
        return (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('mobile.launch.unavailable')}
          />
        );
      default:
        return null;
    }
  })();

  // --- Render ---
  if (controller.loading) {
    return (
      <div className="page-container settings-loading">
        <Spin />
      </div>
    );
  }

  const content = activeSettingId ? (
    <div className="page-container settings-page mobile-detail-page">
      <header className="page-header">
        <button
          type="button"
          className="header-action"
          aria-label={t('common.action.back')}
          onClick={() => requestExit(onBack)}
        >
          <ArrowLeft size={20} />
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
    <div className="page-container settings-page">
      {/* Header: "Me" + Settings gear */}
      <header className="page-header">
        <h1 className="header-title">{t('mobile.settings.title')}</h1>
        <button
          type="button"
          className="header-action"
          aria-label={t('mobile.settings.accountInfo')}
          onClick={() => onOpenSetting('account-info')}
        >
          <SettingsIcon size={20} />
        </button>
      </header>

      <div className="settings-body">
        {/* Profile header card — Avatar 64px + name + PTID + chevron + stats */}
        <button
          type="button"
          className="settings-profile-trigger"
          onClick={() => onOpenSetting('account-info')}
        >
          <Card className="settings-profile-header-card" variant="borderless">
            <div className="settings-profile-header">
              <Avatar
                size={64}
                src={visibleProfile?.avatar || undefined}
                style={{
                  background: 'linear-gradient(135deg, #667eea, #764ba2)',
                  borderRadius: 16,
                }}
              >
                {displayName ? displayName.slice(0, 2).toUpperCase() : '?'}
              </Avatar>
              <div className="settings-profile-info">
                <Text strong className="settings-profile-name">
                  {displayName || t('mobile.settings.notLoggedIn')}
                </Text>
                {ptidDisplay && (
                  <Text type="secondary" className="settings-profile-ptid">
                    {ptidDisplay}
                  </Text>
                )}
              </div>
              <ChevronRight size={20} color="#9ca0ab" />
            </div>
            <div className="settings-profile-stats">
              <div className="settings-stat">
                <Text strong className="settings-stat-value">{friendCount}</Text>
                <Text type="secondary" className="settings-stat-label">
                  {t('mobile.settings.stats.friends')}
                </Text>
              </div>
              <div className="settings-stat-divider" />
              <div className="settings-stat">
                <Text strong className="settings-stat-value">{groupCount}</Text>
                <Text type="secondary" className="settings-stat-label">
                  {t('mobile.settings.stats.groups')}
                </Text>
              </div>
              <div className="settings-stat-divider" />
              <div className="settings-stat">
                <Text strong className="settings-stat-value">{momentsCount}</Text>
                <Text type="secondary" className="settings-stat-label">
                  {t('mobile.settings.stats.moments')}
                </Text>
              </div>
            </div>
          </Card>
        </button>

        {/* Setting groups (prototype-aligned) */}
        {settingGroups.map((group) => (
          <div key={group.titleKey} className="settings-group-block">
            <div className="settings-group-block-title">{t(group.titleKey)}</div>
            <Card className="settings-group-card" variant="borderless">
              {group.items.map((item, idx) => {
                const Icon = item.icon;
                const displayValue = item.valueOverride ?? (item.valueKey ? t(item.valueKey) : undefined);
                return (
                  <button
                    type="button"
                    key={item.labelKey}
                    className={`setting-row ${idx > 0 ? 'setting-row--border' : ''}`}
                    onClick={() => onOpenSetting(item.id)}
                  >
                    <span
                      className="setting-row-icon"
                      style={{
                        backgroundColor: `${item.tint}14`,
                        color: item.tint,
                      }}
                    >
                      <Icon size={17} />
                    </span>
                    <Text className="setting-row-label">{t(item.labelKey)}</Text>
                    {displayValue && (
                      <Text type="secondary" className="setting-row-value">
                        {displayValue}
                      </Text>
                    )}
                    <ChevronRight size={17} color="#c1c4cc" />
                  </button>
                );
              })}
            </Card>
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
      <Modal
        title={t('mobile.settings.exit.title')}
        open={pendingExit !== null}
        closable={!exitSaving}
        maskClosable={false}
        onCancel={() => setPendingExit(null)}
        footer={[
          <Button
            key="stay"
            disabled={exitSaving}
            onClick={() => setPendingExit(null)}
          >
            {t('mobile.settings.exit.stay')}
          </Button>,
          <Button
            key="discard"
            danger
            disabled={exitSaving}
            onClick={() => void discardAndExit()}
          >
            {t('mobile.settings.exit.discard')}
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={exitSaving}
            onClick={() => void saveAndExit()}
          >
            {t('mobile.settings.exit.save')}
          </Button>,
        ]}
        destroyOnClose
      >
        <div data-acceptance-id="settings-unsaved-exit">
          {t('mobile.settings.exit.body')}
        </div>
      </Modal>
      {/* Logout confirmation modal */}
      <Modal
        title={t('mobile.settings.station.logoutConfirmTitle')}
        open={logoutConfirmOpen}
        okText={t('mobile.settings.logout')}
        okButtonProps={{ danger: true }}
        cancelText={t('common.action.cancel')}
        onOk={() => void handleLogoutConfirm()}
        onCancel={() => setLogoutConfirmOpen(false)}
        destroyOnClose
      >
        {t('mobile.settings.station.logoutConfirmBody')}
      </Modal>
    </>
  );
}
