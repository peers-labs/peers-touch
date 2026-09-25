import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { MobileAuthSession } from '../auth/authSession';
import { createMobileActorStorageRuntime } from '../../storage/mobileClientStorage';

export type MessageFlagKind = 'friend' | 'group';

interface DeviceLocalMessageFlagsV1 {
  readonly version: 1;
  readonly kind: MessageFlagKind;
  readonly conversationId: string;
  readonly flags: Readonly<Record<string, {
    readonly flaggedAtMs: number;
  }>>;
}

interface MessageFlagProjection {
  readonly flaggedMessageIds: ReadonlySet<string>;
  readonly loading: boolean;
  readonly loadFailed: boolean;
  readonly toggle: (messageId: string) => Promise<void>;
}

const STORAGE_VERSION = 1;
const STORAGE_PREFIX = 'device-local-message-flags.v1';
const writeTails = new Map<string, Promise<void>>();

export function useMessageFlagState(
  session: MobileAuthSession | null,
  kind: MessageFlagKind | null,
  conversationId: string,
): MessageFlagProjection {
  const [flaggedMessageIds, setFlaggedMessageIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const loadGenerationRef = useRef(0);

  useEffect(() => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setFlaggedMessageIds(new Set());
    setLoadFailed(false);
    if (!session || !kind || !conversationId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    void loadDeviceLocalMessageFlags(session, kind, conversationId)
      .then((flags) => {
        if (loadGenerationRef.current === generation) {
          setFlaggedMessageIds(flags);
        }
      })
      .catch(() => {
        if (loadGenerationRef.current === generation) {
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (loadGenerationRef.current === generation) {
          setLoading(false);
        }
      });
  }, [conversationId, kind, session]);

  const toggle = useCallback(async (messageId: string) => {
    if (!session || !kind || !conversationId || !messageId) return;
    const next = await setDeviceLocalMessageFlag(
      session,
      kind,
      conversationId,
      messageId,
      !flaggedMessageIds.has(messageId),
    );
    setFlaggedMessageIds(next);
  }, [conversationId, flaggedMessageIds, kind, session]);

  return useMemo(() => ({
    flaggedMessageIds,
    loading,
    loadFailed,
    toggle,
  }), [flaggedMessageIds, loadFailed, loading, toggle]);
}

export async function loadDeviceLocalMessageFlags(
  session: MobileAuthSession,
  kind: MessageFlagKind,
  conversationId: string,
): Promise<ReadonlySet<string>> {
  const snapshot = await flagRepository(session).readValue(
    storageKey(kind, conversationId),
  );
  return idsFromSnapshot(normalizeSnapshot(snapshot, kind, conversationId));
}

export async function setDeviceLocalMessageFlag(
  session: MobileAuthSession,
  kind: MessageFlagKind,
  conversationId: string,
  messageId: string,
  flagged: boolean,
): Promise<ReadonlySet<string>> {
  const queueKey = [
    session.stationPeerId,
    session.actorRef.ptid,
    kind,
    conversationId,
  ].join(':');
  const prior = writeTails.get(queueKey) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  writeTails.set(queueKey, current);

  await prior.catch(() => undefined);
  try {
    const repository = flagRepository(session);
    const key = storageKey(kind, conversationId);
    const currentSnapshot = normalizeSnapshot(
      await repository.readValue(key),
      kind,
      conversationId,
    );
    const nextFlags = { ...currentSnapshot.flags };
    if (flagged) {
      nextFlags[messageId] = { flaggedAtMs: Date.now() };
    } else {
      delete nextFlags[messageId];
    }

    if (Object.keys(nextFlags).length === 0) {
      await repository.remove(key);
    } else {
      await repository.write(key, {
        version: STORAGE_VERSION,
        kind,
        conversationId,
        flags: nextFlags,
      } satisfies DeviceLocalMessageFlagsV1);
    }
    return new Set(Object.keys(nextFlags));
  } finally {
    release();
    if (writeTails.get(queueKey) === current) {
      writeTails.delete(queueKey);
    }
  }
}

function flagRepository(session: MobileAuthSession) {
  return createMobileActorStorageRuntime(
    session.stationPeerId,
    session.actorRef.ptid,
  ).repositories.messageFlags;
}

function storageKey(kind: MessageFlagKind, conversationId: string): string {
  return `${STORAGE_PREFIX}.${kind}.${conversationId}`;
}

function normalizeSnapshot(
  value: unknown,
  kind: MessageFlagKind,
  conversationId: string,
): DeviceLocalMessageFlagsV1 {
  if (!isRecord(value)
    || value.version !== STORAGE_VERSION
    || value.kind !== kind
    || value.conversationId !== conversationId
    || !isRecord(value.flags)) {
    return emptySnapshot(kind, conversationId);
  }

  const flags = Object.fromEntries(
    Object.entries(value.flags)
      .filter(([messageId, entry]) => (
        Boolean(messageId)
        && isRecord(entry)
        && Number.isFinite(entry.flaggedAtMs)
        && Number(entry.flaggedAtMs) > 0
      ))
      .map(([messageId, entry]) => {
        const record = entry as Record<string, unknown>;
        return [
          messageId,
          { flaggedAtMs: Number(record.flaggedAtMs) },
        ];
      }),
  );
  return { version: STORAGE_VERSION, kind, conversationId, flags };
}

function emptySnapshot(
  kind: MessageFlagKind,
  conversationId: string,
): DeviceLocalMessageFlagsV1 {
  return {
    version: STORAGE_VERSION,
    kind,
    conversationId,
    flags: {},
  };
}

function idsFromSnapshot(
  snapshot: DeviceLocalMessageFlagsV1,
): ReadonlySet<string> {
  return new Set(Object.keys(snapshot.flags));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export const messageFlagStateTestContract = {
  normalizeSnapshot,
  storageKey,
};
