/**
 * useSettingsController.ts — Settings page controller hook
 *
 * Owns the settings lifecycle for Station-backed profile fields and
 * device-owned preferences. Capabilities without an authoritative owner
 * remain unavailable in the renderer.
 *
 * The hook produces a SettingsProjection consumed by the pure renderer
 * SettingsPage.tsx. The page never fetches or writes directly.
 */

import { create } from '@bufbuild/protobuf';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { MobileAuthSession } from '../../features/auth/authSession';
import {
  requestSocialBlockedUsers,
  requestSocialPeerProfiles,
  unblockSocialUser,
} from '../../features/social/socialRuntime';
import { useSocialStore } from '../../features/social/socialStore';
import type { PeerProfile } from '../../features/social/socialTypes';
import {
  ProfileUpdateOutcome,
} from '../../gen/proto/domain/actor/actor_pb';
import {
  NotificationPreferencePatchSchema,
  NotificationPreferenceSchema,
  NotificationPreferencesUpdateOutcome,
  type NotificationPreference,
  type NotificationPreferencePatch,
  type NotificationPreferencesSnapshot,
} from '../../gen/proto/domain/notification/notification_pb';
import {
  persistDevicePreferences,
  readDeviceSettingsRuntimeSnapshot,
  retryDeviceSettingsRuntime,
  subscribeDeviceSettingsRuntime,
  type DevicePreferences,
} from '../../runtimes/deviceSettingsRuntime';
import { readCurrentActiveProfileRuntime } from '../../runtimes/socialProjectionRuntime';
import type {
  EditableProfileInput,
  ProfileUpdateResult,
} from '../../services/gateways/profileGateway';
import {
  clearMobileCache,
  loadAppVersion,
  loadDevicePermissions,
  requestDevicePermission,
  type DevicePermission,
} from './devicePreferences';

// ---------------------------------------------------------------------------
// Settings controller state
// ---------------------------------------------------------------------------

export type SettingsSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export type CacheClearStatus = 'idle' | 'clearing' | 'cleared' | 'error';
export type EditableProfileDraft = Required<EditableProfileInput>;

export interface SettingsControllerState {
  /** True while initial data is loading */
  readonly loading: boolean;

  /** Committed Station profile readback. */
  readonly serverProfile: EditableProfileDraft | null;

  /** Working copy of the editable Station profile fields. */
  readonly draftProfile: EditableProfileDraft | null;

  /** Whether the authoritative Profile projection is currently available. */
  readonly profileAvailable: boolean;

  /** Authoritative reason while the Profile projection is unavailable. */
  readonly profileUnavailableReason: string | null;

  /** Committed local device preferences */
  readonly serverDevicePrefs: DevicePreferences | null;

  /** Working copy of device preferences */
  readonly draftDevicePrefs: DevicePreferences | null;

  /** True while the app-scoped device settings owner is loading. */
  readonly devicePreferencesLoading: boolean;

  /** True when the app-scoped device settings owner cannot read its store. */
  readonly devicePreferencesUnavailable: boolean;

  readonly profileDirty: boolean;
  readonly profileConflict: boolean;
  readonly profileSaveStatus: SettingsSaveStatus;
  readonly profileSaveError: string | null;
  readonly devicePreferencesDirty: boolean;
  readonly devicePreferencesConflict: boolean;
  readonly devicePreferencesSaveStatus: SettingsSaveStatus;
  readonly devicePreferencesSaveError: string | null;

  /** Native permission projection read through the platform runtime. */
  readonly permissions: readonly DevicePermission[];

  /** True while native permission state is being refreshed. */
  readonly permissionsLoading: boolean;

  /** True when the native permission projection is unavailable. */
  readonly permissionsUnavailable: boolean;

  /** Application version read from the native build metadata owner. */
  readonly appVersion: string | null;

  /** Current cache-clear operation status. */
  readonly cacheClearStatus: CacheClearStatus;
}

// ---------------------------------------------------------------------------
// Controller actions exposed to the page
// ---------------------------------------------------------------------------

export interface SettingsController extends SettingsControllerState {
  /** Patch one or more Station-owned profile fields. */
  patchProfile: (patch: Partial<EditableProfileDraft>) => void;

  /** Patch one or more device preference fields */
  patchDevicePrefs: (patch: Partial<DevicePreferences>) => void;

  saveProfile: () => Promise<boolean>;
  discardProfile: () => void;
  reloadProfile: () => Promise<void>;
  saveDevicePreferences: () => Promise<boolean>;
  discardDevicePreferences: () => void;
  reloadDevicePreferences: () => Promise<void>;

  /** Refresh all native permission readbacks. */
  refreshPermissions: () => Promise<void>;

  /** Retry authoritative device preference readback. */
  retryDevicePreferences: () => Promise<void>;

  /** Retry authoritative Profile readback. */
  retryProfile: () => Promise<void>;

  /** Request one permission through the native platform runtime. */
  requestPermission: (kind: DevicePermission['kind']) => Promise<void>;

  /** Clear only regenerable Mobile cache domains. */
  clearCache: () => Promise<void>;
}

export type NotificationPreferenceBooleanField = keyof Pick<
  NotificationPreferencePatch,
  'enabled' | 'pushEnabled' | 'soundEnabled'
>;

export interface NotificationPreferencesController {
  readonly preferences: readonly NotificationPreference[];
  readonly loading: boolean;
  readonly unavailable: boolean;
  readonly dirty: boolean;
  readonly conflict: boolean;
  readonly saveStatus: SettingsSaveStatus;
  readonly saveError: string | null;
  readonly patch: (
    field: NotificationPreferenceBooleanField,
    value: boolean,
  ) => void;
  readonly save: () => Promise<boolean>;
  readonly discard: () => void;
  readonly reload: () => Promise<void>;
}

export type BlockedUsersStatus = 'loading' | 'ready' | 'unavailable';

export interface BlockedUserView {
  readonly targetPtid: string;
  readonly displayName: string;
  readonly avatar: string;
  readonly homeStationPeerId: string;
}

export interface BlockedUsersController {
  readonly users: readonly BlockedUserView[];
  readonly status: BlockedUsersStatus;
  readonly errorKey: string | null;
  readonly unblockingPtid: string | null;
  readonly reload: () => Promise<void>;
  readonly unblock: (targetPtid: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSettingsController(
  authSession: MobileAuthSession | null,
  currentProfile: PeerProfile | null,
  updateCurrentProfile: (input: EditableProfileInput) => Promise<ProfileUpdateResult>,
  reloadCurrentProfile: () => Promise<void>,
): SettingsController {
  const profileRuntime = readCurrentActiveProfileRuntime();
  const [profileProjectionState, setProfileProjectionState] = useState(
    () => profileRuntime?.projection.state() ?? null,
  );
  const [loading, setLoading] = useState(true);
  const [serverProfile, setServerProfile] = useState<EditableProfileDraft | null>(null);
  const [draftProfile, setDraftProfile] = useState<EditableProfileDraft | null>(null);
  const initialDeviceSettings = readDeviceSettingsRuntimeSnapshot();
  const initialDevicePreferences = initialDeviceSettings.status === 'ready'
    ? initialDeviceSettings.preferences
    : null;
  const [serverDevicePrefs, setServerDevicePrefs] =
    useState<DevicePreferences | null>(initialDevicePreferences);
  const [draftDevicePrefs, setDraftDevicePrefs] =
    useState<DevicePreferences | null>(initialDevicePreferences);
  const [devicePreferencesLoading, setDevicePreferencesLoading] = useState(
    initialDeviceSettings.status === 'loading',
  );
  const [devicePreferencesUnavailable, setDevicePreferencesUnavailable] =
    useState(initialDeviceSettings.status === 'unavailable');
  const [profileConflict, setProfileConflict] = useState(false);
  const [profileSaveStatus, setProfileSaveStatus] =
    useState<SettingsSaveStatus>('idle');
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);
  const [devicePreferencesConflict, setDevicePreferencesConflict] =
    useState(false);
  const [devicePreferencesSaveStatus, setDevicePreferencesSaveStatus] =
    useState<SettingsSaveStatus>('idle');
  const [devicePreferencesSaveError, setDevicePreferencesSaveError] =
    useState<string | null>(null);
  const [permissions, setPermissions] = useState<readonly DevicePermission[]>([]);
  const [permissionsLoading, setPermissionsLoading] = useState(true);
  const [permissionsUnavailable, setPermissionsUnavailable] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [cacheClearStatus, setCacheClearStatus] = useState<CacheClearStatus>('idle');
  const serverProfileRef = useRef<EditableProfileDraft | null>(null);
  const draftProfileRef = useRef<EditableProfileDraft | null>(null);
  const serverDevicePrefsRef = useRef<DevicePreferences | null>(
    initialDevicePreferences,
  );
  const draftDevicePrefsRef = useRef<DevicePreferences | null>(
    initialDevicePreferences,
  );

  // Track mount state to avoid state updates after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ---- Initial load ----
  const loadAll = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);

    const [permissionReadback, versionReadback] = await Promise.all([
      loadDevicePermissions()
        .then((value) => ({ value, unavailable: false }))
        .catch(() => ({ value: [] as DevicePermission[], unavailable: true })),
      loadAppVersion()
        .then((value) => value.trim() || null)
        .catch(() => null),
    ]);
    if (!mountedRef.current) return;
    setPermissions(permissionReadback.value);
    setPermissionsUnavailable(permissionReadback.unavailable);
    setPermissionsLoading(false);
    setAppVersion(versionReadback);

    if (mountedRef.current) setLoading(false);
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  useEffect(() => {
    if (!profileRuntime) {
      setProfileProjectionState(null);
      return;
    }
    const sync = () => setProfileProjectionState(profileRuntime.projection.state());
    sync();
    return profileRuntime.projection.subscribe(sync);
  }, [profileRuntime]);

  useEffect(() => {
    serverProfileRef.current = serverProfile;
    draftProfileRef.current = draftProfile;
  }, [serverProfile, draftProfile]);

  useEffect(() => {
    serverDevicePrefsRef.current = serverDevicePrefs;
    draftDevicePrefsRef.current = draftDevicePrefs;
  }, [serverDevicePrefs, draftDevicePrefs]);

  useEffect(() => {
    const sync = () => {
      const snapshot = readDeviceSettingsRuntimeSnapshot();
      setDevicePreferencesLoading(snapshot.status === 'loading');
      setDevicePreferencesUnavailable(snapshot.status === 'unavailable');
      if (snapshot.status !== 'ready') return;

      const hasLocalEdits = !shallowEqual(
        serverDevicePrefsRef.current,
        draftDevicePrefsRef.current,
      );
      const confirmsLocalDraft = shallowEqual(
        snapshot.preferences,
        draftDevicePrefsRef.current,
      );
      setServerDevicePrefs(snapshot.preferences);
      if (!hasLocalEdits || confirmsLocalDraft) {
        setDraftDevicePrefs(snapshot.preferences);
        setDevicePreferencesConflict(false);
      } else if (
        serverDevicePrefsRef.current
        && !shallowEqual(snapshot.preferences, serverDevicePrefsRef.current)
      ) {
        setDevicePreferencesConflict(true);
      }
    };
    sync();
    return subscribeDeviceSettingsRuntime(sync);
  }, []);

  useEffect(() => {
    if (!profileProjectionState?.availability.available) return;
    const next = reconcileEditableProfileDraft(
      serverProfileRef.current,
      draftProfileRef.current,
      profileProjectionState.currentProfile ?? currentProfile,
    );
    setServerProfile(next.server);
    setDraftProfile(next.draft);
    setProfileConflict(next.conflict);
  }, [currentProfile, profileProjectionState]);

  const profileAvailable = Boolean(
    authSession
    && profileRuntime
    && profileProjectionState?.availability.available,
  );
  const profileUnavailableReason = profileProjectionState
    && !profileProjectionState.availability.available
    ? profileProjectionState.availability.reason
    : profileRuntime
      ? null
      : 'mobile.settings.profileUnavailable';

  const profileDirty = !shallowEqual(serverProfile, draftProfile);
  const devicePreferencesDirty = !shallowEqual(
    serverDevicePrefs,
    draftDevicePrefs,
  );

  // ---- Patch ----
  const patchProfile = useCallback((patch: Partial<EditableProfileDraft>) => {
    if (!profileAvailable) return;
    setDraftProfile((previous) => (
      previous ? { ...previous, ...patch } : null
    ));
    setProfileSaveStatus('idle');
    setProfileSaveError(null);
    setProfileConflict(false);
  }, [profileAvailable]);

  const patchDevicePrefs = useCallback((patch: Partial<DevicePreferences>) => {
    setDraftDevicePrefs((previous) => (
      previous ? { ...previous, ...patch } : null
    ));
    setDevicePreferencesSaveStatus('idle');
    setDevicePreferencesSaveError(null);
    setDevicePreferencesConflict(false);
  }, []);

  const saveProfile = useCallback(async () => {
    if (!profileDirty) return true;
    if (!profileAvailable || !authSession || !draftProfile) {
      setProfileSaveStatus('error');
      setProfileSaveError('mobile.settings.profileUnavailable');
      return false;
    }
    setProfileSaveStatus('saving');
    setProfileSaveError(null);
    const profileDraft = draftProfile;
    try {
      const result = await updateCurrentProfile(profileDraft);
      if (!mountedRef.current) return false;
      const next = reconcileEditableProfileDraft(
        serverProfile,
        profileDraft,
        result.profile,
      );
      const conflict = result.outcome === ProfileUpdateOutcome.CONFLICT
        || next.conflict;
      setServerProfile(next.server);
      setDraftProfile(conflict ? profileDraft : next.draft);
      setProfileConflict(conflict);
      if (conflict) {
        setProfileSaveStatus('error');
        setProfileSaveError('mobile.settings.dirty.conflict');
        return false;
      }
    } catch {
      if (!mountedRef.current) return false;
      setProfileSaveStatus('error');
      setProfileSaveError('mobile.settings.profile.saveFailed');
      return false;
    }
    setProfileSaveStatus('saved');
    return mountedRef.current;
  }, [
    authSession,
    draftProfile,
    profileDirty,
    profileAvailable,
    serverProfile,
    updateCurrentProfile,
  ]);

  const saveDevicePreferences = useCallback(async () => {
    if (!devicePreferencesDirty) return true;
    if (!draftDevicePrefs || devicePreferencesUnavailable) {
      setDevicePreferencesSaveStatus('error');
      setDevicePreferencesSaveError('mobile.settings.dirty.saveFailed');
      return false;
    }
    setDevicePreferencesSaveStatus('saving');
    setDevicePreferencesSaveError(null);
    try {
      await persistDevicePreferences(draftDevicePrefs);
    } catch {
      if (mountedRef.current) {
        setDevicePreferencesSaveStatus('error');
        setDevicePreferencesSaveError('mobile.settings.dirty.saveFailed');
      }
      return false;
    }
    if (!mountedRef.current) return false;
    const readback = readDeviceSettingsRuntimeSnapshot();
    if (
      readback.status !== 'ready'
      || !shallowEqual(readback.preferences, draftDevicePrefs)
    ) {
      if (readback.status === 'ready') {
        setServerDevicePrefs(readback.preferences);
      }
      setDevicePreferencesConflict(readback.status === 'ready');
      setDevicePreferencesSaveStatus('error');
      setDevicePreferencesSaveError(
        readback.status === 'ready'
          ? 'mobile.settings.dirty.conflict'
          : 'mobile.settings.dirty.saveFailed',
      );
      return false;
    }
    setServerDevicePrefs(readback.preferences);
    setDraftDevicePrefs(readback.preferences);
    setDevicePreferencesConflict(false);
    setDevicePreferencesSaveStatus('saved');
    return true;
  }, [
    devicePreferencesDirty,
    devicePreferencesUnavailable,
    draftDevicePrefs,
  ]);

  const discardProfile = useCallback(() => {
    setDraftProfile(serverProfile);
    setProfileConflict(false);
    setProfileSaveStatus('idle');
    setProfileSaveError(null);
  }, [serverProfile]);

  const discardDevicePreferences = useCallback(() => {
    setDraftDevicePrefs(serverDevicePrefs);
    setDevicePreferencesConflict(false);
    setDevicePreferencesSaveStatus('idle');
    setDevicePreferencesSaveError(null);
  }, [serverDevicePrefs]);

  const reloadProfile = useCallback(async () => {
    try {
      await reloadCurrentProfile();
      if (!mountedRef.current) return;
      const latest = readCurrentActiveProfileRuntime()
        ?.projection.state().currentProfile ?? null;
      const canonical = profileDraftFromReadback(latest);
      setServerProfile(canonical);
      setDraftProfile(canonical);
      setProfileConflict(false);
      setProfileSaveStatus('idle');
      setProfileSaveError(null);
    } catch {
      if (!mountedRef.current) return;
      setProfileSaveStatus('error');
      setProfileSaveError('mobile.settings.profileUnavailable');
    }
  }, [reloadCurrentProfile]);

  const reloadDevicePreferences = useCallback(async () => {
    try {
      await retryDeviceSettingsRuntime();
      if (!mountedRef.current) return;
      const latest = readDeviceSettingsRuntimeSnapshot();
      if (latest.status !== 'ready') throw new Error('device preferences unavailable');
      setServerDevicePrefs(latest.preferences);
      setDraftDevicePrefs(latest.preferences);
      setDevicePreferencesConflict(false);
      setDevicePreferencesSaveStatus('idle');
      setDevicePreferencesSaveError(null);
    } catch {
      if (!mountedRef.current) return;
      setDevicePreferencesSaveStatus('error');
      setDevicePreferencesSaveError('mobile.settings.dirty.saveFailed');
    }
  }, []);

  const retryDevicePreferences = useCallback(async () => {
    setDevicePreferencesLoading(true);
    try {
      await retryDeviceSettingsRuntime();
    } catch {
      // The runtime snapshot remains explicitly unavailable.
    }
  }, []);

  const retryProfile = reloadProfile;

  const refreshPermissions = useCallback(async () => {
    setPermissionsLoading(true);
    setPermissionsUnavailable(false);
    try {
      const next = await loadDevicePermissions();
      if (!mountedRef.current) return;
      setPermissions(next);
    } catch {
      if (!mountedRef.current) return;
      setPermissions([]);
      setPermissionsUnavailable(true);
    } finally {
      if (mountedRef.current) setPermissionsLoading(false);
    }
  }, []);

  const requestPermission = useCallback(async (
    kind: DevicePermission['kind'],
  ) => {
    setPermissionsLoading(true);
    setPermissionsUnavailable(false);
    try {
      await requestDevicePermission(kind);
    } catch {
      // Preserve the last authoritative status and refresh it below.
    }
    try {
      const next = await loadDevicePermissions();
      if (!mountedRef.current) return;
      setPermissions(next);
      setPermissionsUnavailable(false);
    } catch {
      if (mountedRef.current && permissions.length === 0) {
        setPermissionsUnavailable(true);
      }
    } finally {
      if (mountedRef.current) setPermissionsLoading(false);
    }
  }, [permissions.length]);

  const clearCache = useCallback(async () => {
    setCacheClearStatus('clearing');
    try {
      await clearMobileCache(authSession);
      if (mountedRef.current) setCacheClearStatus('cleared');
    } catch {
      if (mountedRef.current) setCacheClearStatus('error');
    }
  }, [authSession]);

  return {
    loading,
    serverProfile,
    draftProfile,
    profileAvailable,
    profileUnavailableReason,
    serverDevicePrefs,
    draftDevicePrefs,
    devicePreferencesLoading,
    devicePreferencesUnavailable,
    profileDirty,
    profileConflict,
    profileSaveStatus,
    profileSaveError,
    devicePreferencesDirty,
    devicePreferencesConflict,
    devicePreferencesSaveStatus,
    devicePreferencesSaveError,
    permissions,
    permissionsLoading,
    permissionsUnavailable,
    appVersion,
    cacheClearStatus,
    patchProfile,
    patchDevicePrefs,
    saveProfile,
    discardProfile,
    reloadProfile,
    saveDevicePreferences,
    discardDevicePreferences,
    reloadDevicePreferences,
    refreshPermissions,
    retryDevicePreferences,
    retryProfile,
    requestPermission,
    clearCache,
  };
}

export function useNotificationPreferencesController(): NotificationPreferencesController {
  const runtime = readCurrentActiveProfileRuntime();
  const [projectionState, setProjectionState] = useState(
    () => runtime?.notificationPreferences.state() ?? null,
  );
  const [serverSnapshot, setServerSnapshot] =
    useState<NotificationPreferencesSnapshot | null>(null);
  const [draftPreferences, setDraftPreferences] = useState<
    readonly NotificationPreference[] | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SettingsSaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const serverRef = useRef<NotificationPreferencesSnapshot | null>(null);
  const draftRef = useRef<readonly NotificationPreference[] | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!runtime) {
      setProjectionState(null);
      return;
    }
    const sync = () => setProjectionState(runtime.notificationPreferences.state());
    sync();
    return runtime.notificationPreferences.subscribe(sync);
  }, [runtime]);

  useEffect(() => {
    serverRef.current = serverSnapshot;
    draftRef.current = draftPreferences;
  }, [serverSnapshot, draftPreferences]);

  useEffect(() => {
    if (
      !projectionState?.availability.available
      || !projectionState.snapshot
    ) return;
    const next = reconcileNotificationPreferenceDraft(
      serverRef.current,
      draftRef.current,
      projectionState.snapshot,
    );
    setServerSnapshot(next.server);
    setDraftPreferences(next.draft);
    setConflict(next.conflict);
  }, [projectionState]);

  const preferences = draftPreferences ?? [];
  const dirty = !notificationPreferencesEqual(
    serverSnapshot?.preferences ?? null,
    draftPreferences,
  );
  const unavailable = !runtime
    || !projectionState?.availability.available
    || !projectionState.snapshot
    || preferences.length === 0;

  const patch = useCallback((
    field: NotificationPreferenceBooleanField,
    value: boolean,
  ) => {
    setDraftPreferences((current) => (
      current ? patchNotificationPreferences(current, field, value) : null
    ));
    setConflict(false);
    setSaveStatus('idle');
    setSaveError(null);
  }, []);

  const save = useCallback(async () => {
    if (!dirty) return true;
    if (!runtime || !serverSnapshot || !draftPreferences) {
      setSaveStatus('error');
      setSaveError('mobile.settings.dirty.saveFailed');
      return false;
    }
    setSaveStatus('saving');
    setSaveError(null);
    const updates = buildNotificationPreferenceUpdates(
      serverSnapshot.preferences,
      draftPreferences,
    );
    const result = await runtime.updateNotificationPreferences(updates);
    if (!mountedRef.current) return false;
    if (!result.ok) {
      setSaveStatus('error');
      setSaveError('mobile.settings.dirty.saveFailed');
      return false;
    }
    const next = reconcileNotificationPreferenceDraft(
      serverSnapshot,
      draftPreferences,
      result.data.snapshot,
    );
    const updateConflict =
      result.data.outcome === NotificationPreferencesUpdateOutcome.CONFLICT
      || next.conflict;
    setServerSnapshot(next.server);
    setDraftPreferences(updateConflict ? draftPreferences : next.draft);
    setConflict(updateConflict);
    if (updateConflict) {
      setSaveStatus('error');
      setSaveError('mobile.settings.dirty.conflict');
      return false;
    }
    setSaveStatus('saved');
    return true;
  }, [dirty, draftPreferences, runtime, serverSnapshot]);

  const discard = useCallback(() => {
    setDraftPreferences(serverSnapshot?.preferences ?? null);
    setConflict(false);
    setSaveStatus('idle');
    setSaveError(null);
  }, [serverSnapshot]);

  const reload = useCallback(async () => {
    if (!runtime) return;
    setLoading(true);
    const result = await runtime.refreshNotificationPreferences();
    if (!mountedRef.current) return;
    setLoading(false);
    if (!result.ok) {
      setSaveStatus('error');
      setSaveError('mobile.settings.dirty.saveFailed');
      return;
    }
    setServerSnapshot(result.data);
    setDraftPreferences(result.data.preferences);
    setConflict(false);
    setSaveStatus('idle');
    setSaveError(null);
  }, [runtime]);

  return {
    preferences,
    loading,
    unavailable,
    dirty,
    conflict,
    saveStatus,
    saveError,
    patch,
    save,
    discard,
    reload,
  };
}

export function useBlockedUsersController(): BlockedUsersController {
  const ownerAvailable = useSocialStore((state) => state.socialGateway !== null);
  const blockedUsers = useSocialStore((state) => state.blockedUsers);
  const peerProfiles = useSocialStore((state) => state.peerProfiles);
  const [status, setStatus] = useState<BlockedUsersStatus>(
    ownerAvailable ? 'loading' : 'unavailable',
  );
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [unblockingPtid, setUnblockingPtid] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!ownerAvailable) {
      setStatus('unavailable');
      setErrorKey(null);
      return;
    }
    setStatus('loading');
    setErrorKey(null);
    try {
      await requestSocialBlockedUsers();
      if (mountedRef.current) setStatus('ready');
    } catch {
      if (mountedRef.current) setStatus('unavailable');
    }
  }, [ownerAvailable]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (status !== 'ready') return;
    const missingProfiles = blockedUsers
      .map((item) => item.targetPtid)
      .filter((ptid) => ptid && !(ptid in peerProfiles));
    if (missingProfiles.length === 0) return;
    void requestSocialPeerProfiles(missingProfiles).catch(() => undefined);
  }, [blockedUsers, peerProfiles, status]);

  const unblock = useCallback(async (targetPtid: string) => {
    if (!ownerAvailable || unblockingPtid) return;
    setUnblockingPtid(targetPtid);
    setErrorKey(null);
    try {
      await unblockSocialUser(targetPtid);
      if (mountedRef.current) setStatus('ready');
    } catch (error) {
      if (mountedRef.current) {
        setErrorKey(blockedUsersMutationErrorKey(error));
      }
    } finally {
      if (mountedRef.current) setUnblockingPtid(null);
    }
  }, [
    ownerAvailable,
    unblockingPtid,
  ]);

  return {
    users: blockedUserViews(blockedUsers, peerProfiles),
    status,
    errorKey,
    unblockingPtid,
    reload,
    unblock,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function profileDraftFromReadback(
  profile: PeerProfile | null,
): EditableProfileDraft | null {
  if (!profile) return null;
  return {
    displayName: profile.displayName,
    note: profile.note,
    avatar: profile.avatar,
    header: profile.header,
    region: profile.region,
    timezone: profile.timezone,
    defaultVisibility: profile.defaultVisibility,
    discoverability: profile.discoverability,
    manuallyApprovesFollowers: profile.manuallyApprovesFollowers,
    messagePermission: profile.messagePermission,
    autoExpireDays: profile.autoExpireDays,
  };
}

export function reconcileEditableProfileDraft(
  server: EditableProfileDraft | null,
  draft: EditableProfileDraft | null,
  incomingProfile: PeerProfile | null,
): {
  readonly server: EditableProfileDraft | null;
  readonly draft: EditableProfileDraft | null;
  readonly conflict: boolean;
} {
  const incoming = profileDraftFromReadback(incomingProfile);
  if (!server || !draft || shallowEqual(server, draft)) {
    return { server: incoming, draft: incoming, conflict: false };
  }
  if (shallowEqual(incoming, draft)) {
    return { server: incoming, draft: incoming, conflict: false };
  }
  return {
    server: incoming,
    draft,
    conflict: !shallowEqual(incoming, server),
  };
}

function shallowEqual<T>(a: T, b: T): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return a === b;
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  const recordA = a as Record<string, unknown>;
  const recordB = b as Record<string, unknown>;
  return keysA.every((key) => recordA[key] === recordB[key]);
}

export function patchNotificationPreferences(
  preferences: readonly NotificationPreference[],
  field: NotificationPreferenceBooleanField,
  value: boolean,
): readonly NotificationPreference[] {
  return preferences.map((preference) => create(NotificationPreferenceSchema, {
    ...preference,
    [field]: value,
  }));
}

export function buildNotificationPreferenceUpdates(
  server: readonly NotificationPreference[],
  draft: readonly NotificationPreference[],
): readonly NotificationPreferencePatch[] {
  const serverByCategory = new Map(
    server.map((preference) => [preference.category, preference]),
  );
  return draft.flatMap((preference) => {
    const committed = serverByCategory.get(preference.category);
    if (!committed || notificationPreferenceValuesEqual(committed, preference)) {
      return [];
    }
    return [create(NotificationPreferencePatchSchema, {
      category: preference.category,
      enabled: preference.enabled,
      pushEnabled: preference.pushEnabled,
      soundEnabled: preference.soundEnabled,
    })];
  });
}

export function reconcileNotificationPreferenceDraft(
  server: NotificationPreferencesSnapshot | null,
  draft: readonly NotificationPreference[] | null,
  incoming: NotificationPreferencesSnapshot,
): {
  readonly server: NotificationPreferencesSnapshot;
  readonly draft: readonly NotificationPreference[];
  readonly conflict: boolean;
} {
  if (
    !server
    || !draft
    || notificationPreferencesEqual(server.preferences, draft)
  ) {
    return {
      server: incoming,
      draft: incoming.preferences,
      conflict: false,
    };
  }
  if (notificationPreferencesEqual(incoming.preferences, draft)) {
    return {
      server: incoming,
      draft: incoming.preferences,
      conflict: false,
    };
  }
  return {
    server: incoming,
    draft,
    conflict:
      incoming.notificationPreferencesRevision !==
        server.notificationPreferencesRevision
      || !notificationPreferencesEqual(incoming.preferences, server.preferences),
  };
}

function notificationPreferencesEqual(
  left: readonly NotificationPreference[] | null,
  right: readonly NotificationPreference[] | null,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  const rightByCategory = new Map(
    right.map((preference) => [preference.category, preference]),
  );
  return left.every((preference) => {
    const other = rightByCategory.get(preference.category);
    return Boolean(other && notificationPreferenceValuesEqual(preference, other));
  });
}

function notificationPreferenceValuesEqual(
  left: NotificationPreference,
  right: NotificationPreference,
): boolean {
  return left.actorPtid === right.actorPtid
    && left.category === right.category
    && left.type === right.type
    && left.enabled === right.enabled
    && left.pushEnabled === right.pushEnabled
    && left.soundEnabled === right.soundEnabled;
}

export function blockedUserViews(
  blockedUsers: readonly {
    readonly targetPtid: string;
    readonly targetHomeStationPeerId?: string;
  }[],
  peerProfiles: Readonly<Record<string, PeerProfile | null>>,
): readonly BlockedUserView[] {
  return blockedUsers.map((item) => {
    const profile = peerProfiles[item.targetPtid];
    return {
      targetPtid: item.targetPtid,
      displayName: profile?.displayName || profile?.acct || item.targetPtid,
      avatar: profile?.avatar ?? '',
      homeStationPeerId: item.targetHomeStationPeerId ?? '',
    };
  });
}

function blockedUsersMutationErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /conflict|stale.{0,16}revision|revision.{0,16}stale/i.test(message)
    ? 'mobile.settings.dirty.conflict'
    : 'mobile.launch.unavailable';
}
