/**
 * SettingsPage.tsx — Pure renderer for the Settings / "Me" tab.
 *
 * W6C product closure: profile editing, account preferences, device
 * preferences, notifications, privacy, storage, blocked users,
 * language, permissions, station change, and logout.
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
import { Modal, Spin } from 'antd';

import { useMobileI18n } from '../app/mobileI18n';
import logo from '../assets/logo.png';
import type { MobileAuthSession } from '../features/auth/authSession';
import { useSocialStore } from '../features/social/socialStore';
import {
  activeStationEntry,
  type StoredStationRegistry,
} from '../features/station/stationRegistry';
import { createProfileGateway } from '../services/gateways/profileGateway';
import { createProfileProjection } from '../runtimes/profileProjectionDescriptor';
import { useSettingsController } from './settings/useSettingsController';
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

// ---------------------------------------------------------------------------
// Page props — the shell passes only what the page cannot own
// ---------------------------------------------------------------------------

interface SettingsPageProps {
  readonly stationRegistry: StoredStationRegistry;
  readonly authSession: MobileAuthSession | null;
  readonly onChangeStation: () => void;
  readonly onLogout: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// SettingsPage — pure renderer
// ---------------------------------------------------------------------------

export function SettingsPage({
  stationRegistry,
  authSession,
  onChangeStation,
  onLogout,
}: SettingsPageProps) {
  const { t } = useMobileI18n();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  const activeStation = activeStationEntry(stationRegistry);
  const displayName = authSession?.actorRef.acct;

  // Blocked users from the social store
  const blockedUsers = useSocialStore((state) => state.blockedUsers);
  const refreshBlockedUsers = useSocialStore((state) => state.refreshBlockedUsers);
  const unblockUser = useSocialStore((state) => state.unblockUser);

  useEffect(() => {
    if (authSession) void refreshBlockedUsers().catch(() => undefined);
  }, [authSession, refreshBlockedUsers]);

  // Gateway + projection: created only when session exists
  const profileGateway = useMemo(
    () => (authSession ? createProfileGateway(authSession) : null),
    [authSession],
  );

  // Lightweight projection for the settings page lifetime.
  // The global profile projection descriptor is the canonical owner;
  // we create a local instance here so the controller can push readback
  // into a cache without coupling to the global ingress lifecycle.
  const profileProjection = useMemo(() => {
    if (!authSession) return null;
    // Stub ingress — settings page does not ingest realtime events,
    // it only pushes preference readback into the projection cache.
    // The profile projection factory requires an ingress reference but
    // only uses it for type-level dependency; all data flows through
    // explicit applyPreference / ingestEvent calls.
    const stubIngress = {
      ingestDataEvent: () => true,
      ingestControlEvent: () => true,
      state: () => ({
        cursors: {} as Record<string, unknown>,
        staleness: {} as Record<string, unknown>,
        writeAdmission: { open: true } as const,
        dataQueueDepth: 0,
        controlQueueDepth: 0,
        consecutiveControlLosses: 0,
      }),
      repairCursor: () => {},
      reopenAdmission: () => {},
      teardown: () => {},
    } as unknown as Parameters<typeof createProfileProjection>[0];
    return createProfileProjection(stubIngress);
  }, [authSession]);

  // Settings controller — owns dirty/save/discard/conflict lifecycle
  const controller = useSettingsController(authSession, profileGateway, profileProjection);

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

  // --- Cache clear ---
  const handleClearCache = useCallback(() => {
    if (typeof window !== 'undefined' && window.caches) {
      void window.caches.keys().then((names) =>
        Promise.all(names.map((name) => window.caches.delete(name))),
      );
    }
  }, []);

  // --- Render ---
  if (controller.loading) {
    return (
      <div className="page-container settings-loading">
        <Spin />
      </div>
    );
  }

  return (
    <div className="page-container settings-page">
      <header className="page-header">
        <h1 className="header-title">{t('mobile.settings.title')}</h1>
      </header>

      {/* Profile card */}
      <div className="settings-profile-card">
        <img src={logo} alt="Peers Touch" className="profile-logo" />
        <div className="profile-info">
          <span className="profile-name">
            {displayName || t('mobile.settings.notLoggedIn')}
          </span>
          <span className="profile-status">
            {authSession ? t('mobile.settings.connected') : t('mobile.settings.loginHint')}
          </span>
        </div>
      </div>

      {/* Dirty bar — save/discard/conflict */}
      <DirtyBar
        dirty={controller.dirty}
        conflict={controller.conflict}
        saveStatus={controller.saveStatus}
        saveError={controller.saveError}
        onSave={() => void controller.save()}
        onDiscard={controller.discard}
        onReload={() => void controller.reload()}
      />

      {/* Profile editing */}
      <ProfileSection
        displayName={displayName}
        onEditProfile={() => {
          // W6C: profile editing is a selected-only detail mount;
          // the edit form is rendered on-demand (future detail page).
        }}
      />

      {/* Notifications (account preferences, Station readback) */}
      <NotificationsSection
        prefs={controller.draftAccountPrefs}
        onPatch={controller.patchAccountPrefs}
        disabled={!authSession}
      />

      {/* Privacy (account preferences, Station readback) */}
      <PrivacySection
        prefs={controller.draftAccountPrefs}
        onPatch={controller.patchAccountPrefs}
        disabled={!authSession}
      />

      {/* Device preferences (local-only) */}
      <DevicePrefsSection
        prefs={controller.draftDevicePrefs}
        onPatch={controller.patchDevicePrefs}
      />

      {/* Language */}
      <LanguageSection />

      {/* Storage */}
      <StorageSection onClearCache={handleClearCache} />

      {/* Blocked users */}
      <BlockedUsersSection
        blockedUsers={blockedUsers}
        onUnblock={(ptid) => unblockUser(ptid)}
      />

      {/* Permissions */}
      <PermissionsSection />

      {/* Station + Logout */}
      <StationSection
        stationLabel={activeStation?.label || t('mobile.launch.station')}
        stationUrl={activeStation?.url || t('mobile.settings.stationNotSelected')}
        online={activeStation?.online ?? false}
        onChangeStation={onChangeStation}
        onLogout={() => setLogoutConfirmOpen(true)}
        loggingOut={loggingOut}
      />

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
    </div>
  );
}
