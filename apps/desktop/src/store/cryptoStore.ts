// Zustand store for crypto UI state. Exposes reactive state for:
// - Session security states per conversation
// - Device list management
// - Backup status
// - Safety number change notifications
// - Key rotation status
//
// This store is the single source of truth for all crypto-related UI.
import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';
import type {
  CryptoBackupCreateResult,
  CryptoBackupRestoreResult,
  CryptoBackupStatus,
  CryptoDeviceAddress,
  DeviceEnrollment,
  KeyRotationStatus,
} from '../services/crypto-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionSecurityLevel =
  | 'idle'
  | 'establishing'
  | 'ready'
  | 'error'
  | 'safety-number-changed';

export interface SessionSecurityInfo {
  sessionId: string;
  peerAddress: CryptoDeviceAddress;
  level: SessionSecurityLevel;
  version: number;
  lastUpdatedMs: number;
  safetyNumberVerified: boolean;
}

export interface ConversationSecuritySummary {
  conversationId: string;
  /** Aggregate level: weakest link across all peer device sessions. */
  aggregateLevel: SessionSecurityLevel;
  deviceSessions: SessionSecurityInfo[];
}

export interface BackupUIState {
  exists: boolean;
  lastBackupUnixMs: number;
  latestRevision: number;
  messageCount: number;
  conversationCount: number;
  attachmentCount: number;
  verifiedFingerprintCount: number;
  backupInProgress: boolean;
  restoreInProgress: boolean;
  recoveryPromptDismissed: boolean;
}

export interface SafetyNumberChangeAlert {
  sessionId: string;
  peerAddress: CryptoDeviceAddress;
  displayFingerprint: string;
  detectedAtMs: number;
  dismissed: boolean;
}

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface CryptoStoreState {
  // Identity
  initialized: boolean;
  ownPtid: string | null;
  ownDeviceId: string | null;
  ownFingerprint: string | null;

  // Encryption toggle
  encryptionEnabled: boolean;

  // Per-session security state (keyed by sessionId)
  sessionSecurity: Record<string, SessionSecurityInfo>;

  // Per-conversation aggregate (keyed by conversationId)
  conversationSecurity: Record<string, ConversationSecuritySummary>;

  // Enrolled devices for the current user
  devices: DeviceEnrollment[];
  devicesLoading: boolean;

  // Backup state
  backup: BackupUIState;

  // Safety number change alerts (unacknowledged)
  safetyNumberAlerts: SafetyNumberChangeAlert[];

  // Key rotation
  keyRotationStatus: KeyRotationStatus | null;
}

interface CryptoStoreActions {
  // Initialization
  setInitialized(ptid: string, deviceId: string, fingerprint: string): void;
  setEncryptionEnabled(enabled: boolean): void;
  reset(): void;

  // Session security
  setSessionSecurity(sessionId: string, info: Partial<SessionSecurityInfo>): void;
  setSessionSecurityLevel(sessionId: string, level: SessionSecurityLevel, version?: number): void;
  removeSessionSecurity(sessionId: string): void;

  // Conversation-level aggregate
  updateConversationSecurity(
    conversationId: string,
    deviceSessions: SessionSecurityInfo[],
  ): void;

  // Device management
  setDevices(devices: DeviceEnrollment[]): void;
  setDevicesLoading(loading: boolean): void;

  // Backup
  setBackupStatus(status: CryptoBackupStatus): void;
  setBackupResult(result: CryptoBackupCreateResult | CryptoBackupRestoreResult): void;
  setBackupInProgress(inProgress: boolean): void;
  setRestoreInProgress(inProgress: boolean): void;
  dismissRecoveryPrompt(): void;

  // Safety number alerts
  pushSafetyNumberAlert(alert: Omit<SafetyNumberChangeAlert, 'dismissed'>): void;
  dismissSafetyNumberAlert(sessionId: string): void;
  clearAllAlerts(): void;

  // Key rotation
  setKeyRotationStatus(status: KeyRotationStatus): void;
}

type CryptoStore = CryptoStoreState & CryptoStoreActions;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_BACKUP: BackupUIState = {
  exists: false,
  lastBackupUnixMs: 0,
  latestRevision: 0,
  messageCount: 0,
  conversationCount: 0,
  attachmentCount: 0,
  verifiedFingerprintCount: 0,
  backupInProgress: false,
  restoreInProgress: false,
  recoveryPromptDismissed: false,
};

const INITIAL_STATE: CryptoStoreState = {
  initialized: false,
  ownPtid: null,
  ownDeviceId: null,
  ownFingerprint: null,
  encryptionEnabled: false,
  sessionSecurity: {},
  conversationSecurity: {},
  devices: [],
  devicesLoading: false,
  backup: { ...INITIAL_BACKUP },
  safetyNumberAlerts: [],
  keyRotationStatus: null,
};

// ---------------------------------------------------------------------------
// Aggregate computation
// ---------------------------------------------------------------------------

function computeAggregateLevel(sessions: SessionSecurityInfo[]): SessionSecurityLevel {
  if (sessions.length === 0) return 'idle';

  const levelPriority: Record<SessionSecurityLevel, number> = {
    'error': 0,
    'safety-number-changed': 1,
    'establishing': 2,
    'idle': 3,
    'ready': 4,
  };

  let weakest: SessionSecurityLevel = 'ready';
  for (const session of sessions) {
    if (levelPriority[session.level] < levelPriority[weakest]) {
      weakest = session.level;
    }
  }
  return weakest;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCryptoStore = createDesktopStore<CryptoStore>(
  'cryptoStore',
  (set, get) => ({
    ...INITIAL_STATE,

    setInitialized(ptid, deviceId, fingerprint) {
      set({
        initialized: true,
        ownPtid: ptid,
        ownDeviceId: deviceId,
        ownFingerprint: fingerprint,
      });
      log.info('cryptoStore', 'identity initialized', { ptid, deviceId });
    },

    setEncryptionEnabled(enabled) {
      set({ encryptionEnabled: enabled });
    },

    reset() {
      set({ ...INITIAL_STATE });
    },

    setSessionSecurity(sessionId, info) {
      const current = get().sessionSecurity[sessionId];
      const updated: SessionSecurityInfo = {
        sessionId,
        peerAddress: info.peerAddress ?? current?.peerAddress ?? { ptid: '', deviceId: '' },
        level: info.level ?? current?.level ?? 'idle',
        version: info.version ?? current?.version ?? 0,
        lastUpdatedMs: Date.now(),
        safetyNumberVerified: info.safetyNumberVerified ?? current?.safetyNumberVerified ?? false,
      };
      set({
        sessionSecurity: {
          ...get().sessionSecurity,
          [sessionId]: updated,
        },
      });
    },

    setSessionSecurityLevel(sessionId, level, version) {
      const current = get().sessionSecurity[sessionId];
      const updated: SessionSecurityInfo = {
        sessionId,
        peerAddress: current?.peerAddress ?? { ptid: '', deviceId: '' },
        level,
        version: version ?? current?.version ?? 0,
        lastUpdatedMs: Date.now(),
        safetyNumberVerified: current?.safetyNumberVerified ?? false,
      };
      set({
        sessionSecurity: {
          ...get().sessionSecurity,
          [sessionId]: updated,
        },
      });
    },

    removeSessionSecurity(sessionId) {
      const { [sessionId]: _removed, ...rest } = get().sessionSecurity;
      set({ sessionSecurity: rest });
    },

    updateConversationSecurity(conversationId, deviceSessions) {
      const summary: ConversationSecuritySummary = {
        conversationId,
        aggregateLevel: computeAggregateLevel(deviceSessions),
        deviceSessions,
      };
      set({
        conversationSecurity: {
          ...get().conversationSecurity,
          [conversationId]: summary,
        },
      });
    },

    setDevices(devices) {
      set({ devices, devicesLoading: false });
    },

    setDevicesLoading(loading) {
      set({ devicesLoading: loading });
    },

    setBackupStatus(status) {
      set({
        backup: {
          ...get().backup,
          exists: status.exists,
          lastBackupUnixMs: status.latest?.createdAtUnixMs ?? 0,
          latestRevision: status.latest?.revision ?? 0,
        },
      });
    },

    setBackupResult(result) {
      set({
        backup: {
          ...get().backup,
          exists: true,
          lastBackupUnixMs: result.backup.createdAtUnixMs,
          latestRevision: result.backup.revision,
          messageCount: result.messageCount,
          conversationCount: result.conversationCount,
          attachmentCount: result.attachmentCount,
          verifiedFingerprintCount: result.verifiedFingerprintCount,
        },
      });
    },

    setBackupInProgress(inProgress) {
      set({ backup: { ...get().backup, backupInProgress: inProgress } });
    },

    setRestoreInProgress(inProgress) {
      set({ backup: { ...get().backup, restoreInProgress: inProgress } });
    },

    dismissRecoveryPrompt() {
      set({ backup: { ...get().backup, recoveryPromptDismissed: true } });
    },

    pushSafetyNumberAlert(alert) {
      const existing = get().safetyNumberAlerts;
      // Replace if already exists for same session
      const filtered = existing.filter((a) => a.sessionId !== alert.sessionId);
      set({
        safetyNumberAlerts: [...filtered, { ...alert, dismissed: false }],
      });
    },

    dismissSafetyNumberAlert(sessionId) {
      set({
        safetyNumberAlerts: get().safetyNumberAlerts.map((a) =>
          a.sessionId === sessionId ? { ...a, dismissed: true } : a,
        ),
      });
    },

    clearAllAlerts() {
      set({ safetyNumberAlerts: [] });
    },

    setKeyRotationStatus(status) {
      set({ keyRotationStatus: status });
    },
  }),
);

// ---------------------------------------------------------------------------
// Selectors (for use in components)
// ---------------------------------------------------------------------------

/** Whether any safety number change is pending user acknowledgment. */
export function selectHasPendingAlerts(): boolean {
  return useCryptoStore.getState().safetyNumberAlerts.some((a) => !a.dismissed);
}

/** Get the aggregate security level for a conversation. */
export function selectConversationSecurityLevel(
  conversationId: string,
): SessionSecurityLevel {
  return (
    useCryptoStore.getState().conversationSecurity[conversationId]?.aggregateLevel ?? 'idle'
  );
}

/** Whether backup needs attention (no backup or backup too old). */
export function selectBackupNeedsAttention(): boolean {
  const { backup } = useCryptoStore.getState();
  if (!backup.exists) return true;
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  return Date.now() - backup.lastBackupUnixMs > ONE_WEEK_MS;
}
