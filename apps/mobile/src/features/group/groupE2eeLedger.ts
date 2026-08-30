import { safeStorageKey } from '@peers-touch/client-storage';

import type { MobileAuthSession } from '../auth/authSession';
import { mobileAuthScope } from '../auth/mobileAuthIdentity';
import { getSecureStorageValue, setSecureStorageValue } from '../../services/mobileCommands';

type SkdmLedgerState = 'pending' | 'sent';

export interface SkdmLedgerEntry {
  key: string;
  groupUlid: string;
  peerPtid: string;
  deviceKey: string;
  state: SkdmLedgerState;
  attempts: number;
  updatedAt: number;
  error?: string;
}

interface SkdmLedgerSnapshot {
  version: 1;
  entries: Record<string, SkdmLedgerEntry>;
}

export interface GroupSkdmLedger {
  isSent: (entry: SkdmLedgerTarget) => Promise<boolean>;
  markPending: (entry: SkdmLedgerTarget) => Promise<void>;
  markSent: (entry: SkdmLedgerTarget) => Promise<void>;
  markFailed: (entry: SkdmLedgerTarget, error: string) => Promise<void>;
  clearGroup: (groupUlid: string) => Promise<void>;
}

export interface SkdmLedgerTarget {
  groupUlid: string;
  peerPtid: string;
  deviceKey: string;
}

const LEDGER_VERSION = 1;
const LEDGER_KEY_PREFIX = 'mobile.group.e2ee.skdm-ledger.v1';

export function createGroupSkdmLedger(session: MobileAuthSession): GroupSkdmLedger {
  const storageKey = ledgerStorageKey(session);
  let snapshotPromise: Promise<SkdmLedgerSnapshot> | null = null;

  const loadSnapshot = async (): Promise<SkdmLedgerSnapshot> => {
    if (!snapshotPromise) {
      snapshotPromise = getSecureStorageValue(storageKey).then(parseSnapshot);
    }
    return snapshotPromise;
  };

  const saveSnapshot = async (snapshot: SkdmLedgerSnapshot) => {
    snapshotPromise = Promise.resolve(snapshot);
    await setSecureStorageValue(storageKey, JSON.stringify(snapshot));
  };

  const updateEntry = async (
    target: SkdmLedgerTarget,
    state: SkdmLedgerState,
    error?: string,
  ) => {
    const snapshot = await loadSnapshot();
    const key = skdmLedgerKey(target);
    const previous = snapshot.entries[key];
    const next: SkdmLedgerEntry = {
      key,
      groupUlid: target.groupUlid,
      peerPtid: target.peerPtid,
      deviceKey: target.deviceKey,
      state,
      attempts: state === 'pending' ? (previous?.attempts ?? 0) + 1 : previous?.attempts ?? 1,
      updatedAt: Date.now(),
      ...(error ? { error } : {}),
    };
    await saveSnapshot({
      version: LEDGER_VERSION,
      entries: { ...snapshot.entries, [key]: next },
    });
  };

  return {
    isSent: async (target) => {
      const snapshot = await loadSnapshot();
      return snapshot.entries[skdmLedgerKey(target)]?.state === 'sent';
    },
    markPending: (target) => updateEntry(target, 'pending'),
    markSent: (target) => updateEntry(target, 'sent'),
    markFailed: (target, error) => updateEntry(target, 'pending', error),
    clearGroup: async (groupUlid) => {
      const snapshot = await loadSnapshot();
      const entries = Object.fromEntries(
        Object.entries(snapshot.entries).filter(([, entry]) => entry.groupUlid !== groupUlid),
      );
      await saveSnapshot({ version: LEDGER_VERSION, entries });
    },
  };
}

export function skdmLedgerKey(target: SkdmLedgerTarget): string {
  return `${target.groupUlid}:${target.peerPtid}:${target.deviceKey}`;
}

function parseSnapshot(raw: string | null): SkdmLedgerSnapshot {
  if (!raw) return emptySnapshot();
  try {
    const parsed = JSON.parse(raw) as Partial<SkdmLedgerSnapshot>;
    if (parsed.version !== LEDGER_VERSION || !parsed.entries || typeof parsed.entries !== 'object') {
      return emptySnapshot();
    }
    return { version: LEDGER_VERSION, entries: parsed.entries };
  } catch {
    return emptySnapshot();
  }
}

function emptySnapshot(): SkdmLedgerSnapshot {
  return { version: LEDGER_VERSION, entries: {} };
}

function ledgerStorageKey(session: MobileAuthSession): string {
  const scope = mobileAuthScope(session);
  return safeStorageKey([
    LEDGER_KEY_PREFIX,
    stableKeyPart(scope.stationPeerId),
    stableKeyPart(scope.ptid),
  ]);
}

function stableKeyPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96);
}
