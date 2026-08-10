// Zustand store for crypto UI state. Exposes reactive state for:
// - Session security states per conversation
// - Device list management
// - Safety number change notifications
// - Key rotation status
//
// This store is the single source of truth for all crypto-related UI.
import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';
import type { CryptoDeviceAddress, DeviceEnrollment, KeyRotationStatus } from '../services/crypto-service';

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
