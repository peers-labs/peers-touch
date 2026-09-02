/**
 * useSettingsController.ts — Settings page controller hook
 *
 * Owns the full settings lifecycle: loading account preferences from
 * the profile gateway (Station readback), loading device preferences
 * from local storage, tracking dirty state, and driving save/discard/
 * conflict detection via readback comparison.
 *
 * The hook produces a SettingsProjection consumed by the pure renderer
 * SettingsPage.tsx. The page never fetches or writes directly.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { MobileAuthSession } from '../../features/auth/authSession';
import type { ProfileGateway, AccountPreference } from '../../services/gateways/profileGateway';
import type { ProfileProjectionController } from '../../runtimes/profileProjectionDescriptor';
import {
  defaultDevicePreferences,
  loadDevicePreferences,
  persistDevicePreferences,
  type DevicePreferences,
} from './devicePreferences';

// ---------------------------------------------------------------------------
// Settings controller state
// ---------------------------------------------------------------------------

export type SettingsSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface SettingsControllerState {
  /** True while initial data is loading */
  readonly loading: boolean;

  /** Committed server-side account preference (last known good) */
  readonly serverAccountPrefs: AccountPreference | null;

  /** Working copy of account preferences (user edits applied) */
  readonly draftAccountPrefs: AccountPreference | null;

  /** Committed local device preferences */
  readonly serverDevicePrefs: DevicePreferences;

  /** Working copy of device preferences */
  readonly draftDevicePrefs: DevicePreferences;

  /** True when any preference differs from committed state */
  readonly dirty: boolean;

  /** True when a readback detected a server-side conflict */
  readonly conflict: boolean;

  /** Current save operation status */
  readonly saveStatus: SettingsSaveStatus;

  /** Human-readable error key when saveStatus is 'error' */
  readonly saveError: string | null;
}

// ---------------------------------------------------------------------------
// Controller actions exposed to the page
// ---------------------------------------------------------------------------

export interface SettingsController extends SettingsControllerState {
  /** Patch one or more account preference fields */
  patchAccountPrefs: (patch: Partial<AccountPreference>) => void;

  /** Patch one or more device preference fields */
  patchDevicePrefs: (patch: Partial<DevicePreferences>) => void;

  /** Persist all dirty changes (account to Station, device to local) */
  save: () => Promise<void>;

  /** Discard all uncommitted edits, revert to committed state */
  discard: () => void;

  /** Reload from Station (resolves conflicts) */
  reload: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSettingsController(
  authSession: MobileAuthSession | null,
  profileGateway: ProfileGateway | null,
  profileProjection: ProfileProjectionController | null,
): SettingsController {
  const [loading, setLoading] = useState(true);
  const [serverAccountPrefs, setServerAccountPrefs] = useState<AccountPreference | null>(null);
  const [draftAccountPrefs, setDraftAccountPrefs] = useState<AccountPreference | null>(null);
  const [serverDevicePrefs, setServerDevicePrefs] = useState<DevicePreferences>(defaultDevicePreferences);
  const [draftDevicePrefs, setDraftDevicePrefs] = useState<DevicePreferences>(defaultDevicePreferences);
  const [conflict, setConflict] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SettingsSaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

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
    setConflict(false);
    setSaveStatus('idle');
    setSaveError(null);

    // Load device preferences (always available)
    const devicePrefs = await loadDevicePreferences();
    if (!mountedRef.current) return;
    setServerDevicePrefs(devicePrefs);
    setDraftDevicePrefs(devicePrefs);

    // Load account preferences from Station (requires session + gateway)
    if (authSession && profileGateway) {
      const result = await profileGateway.getAccountPreferences();
      if (!mountedRef.current) return;
      if (result.ok) {
        setServerAccountPrefs(result.data);
        setDraftAccountPrefs(result.data);
        // Push into projection cache
        profileProjection?.applyPreference(result.data);
      }
    }

    if (mountedRef.current) setLoading(false);
  }, [authSession, profileGateway, profileProjection]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // ---- Dirty detection ----
  const dirty = computeDirty(serverAccountPrefs, draftAccountPrefs, serverDevicePrefs, draftDevicePrefs);

  // ---- Patch ----
  const patchAccountPrefs = useCallback((patch: Partial<AccountPreference>) => {
    setDraftAccountPrefs((prev) => (prev ? { ...prev, ...patch } : null));
    setSaveStatus('idle');
    setSaveError(null);
    setConflict(false);
  }, []);

  const patchDevicePrefs = useCallback((patch: Partial<DevicePreferences>) => {
    setDraftDevicePrefs((prev) => ({ ...prev, ...patch }));
    setSaveStatus('idle');
    setSaveError(null);
  }, []);

  // ---- Save ----
  const save = useCallback(async () => {
    if (!dirty) return;
    setSaveStatus('saving');
    setSaveError(null);

    // Save device preferences locally
    const deviceDirty = !shallowEqual(serverDevicePrefs, draftDevicePrefs);
    if (deviceDirty) {
      await persistDevicePreferences(draftDevicePrefs);
      if (!mountedRef.current) return;
      setServerDevicePrefs(draftDevicePrefs);
    }

    // Save account preferences to Station
    const accountDirty = !shallowEqual(serverAccountPrefs, draftAccountPrefs);
    if (accountDirty && profileGateway && draftAccountPrefs) {
      // Readback current server state to detect conflicts
      const readback = await profileGateway.getAccountPreferences();
      if (!mountedRef.current) return;

      if (readback.ok && !shallowEqual(readback.data, serverAccountPrefs)) {
        // Server state diverged from our committed snapshot: conflict
        setConflict(true);
        setServerAccountPrefs(readback.data);
        setSaveStatus('error');
        setSaveError('mobile.settings.dirty.conflict');
        return;
      }

      // No conflict: push the update
      const updateResult = await profileGateway.updateAccountPreferences(draftAccountPrefs);
      if (!mountedRef.current) return;

      if (!updateResult.ok) {
        setSaveStatus('error');
        setSaveError('mobile.settings.dirty.saveFailed');
        return;
      }

      setServerAccountPrefs(updateResult.data);
      setDraftAccountPrefs(updateResult.data);
      profileProjection?.applyPreference(updateResult.data);
    }

    if (mountedRef.current) setSaveStatus('saved');
  }, [dirty, serverDevicePrefs, draftDevicePrefs, serverAccountPrefs, draftAccountPrefs, profileGateway, profileProjection]);

  // ---- Discard ----
  const discard = useCallback(() => {
    setDraftAccountPrefs(serverAccountPrefs);
    setDraftDevicePrefs(serverDevicePrefs);
    setConflict(false);
    setSaveStatus('idle');
    setSaveError(null);
  }, [serverAccountPrefs, serverDevicePrefs]);

  // ---- Reload (resolve conflict) ----
  const reload = useCallback(async () => {
    await loadAll();
  }, [loadAll]);

  return {
    loading,
    serverAccountPrefs,
    draftAccountPrefs,
    serverDevicePrefs,
    draftDevicePrefs,
    dirty,
    conflict,
    saveStatus,
    saveError,
    patchAccountPrefs,
    patchDevicePrefs,
    save,
    discard,
    reload,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeDirty(
  serverAccount: AccountPreference | null,
  draftAccount: AccountPreference | null,
  serverDevice: DevicePreferences,
  draftDevice: DevicePreferences,
): boolean {
  if (!shallowEqual(serverDevice, draftDevice)) return true;
  if (!shallowEqual(serverAccount, draftAccount)) return true;
  return false;
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
