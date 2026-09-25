/**
 * useMomentsDraft.ts — Draft save/restore hook for moment composer
 *
 * Integrates with W4's DraftRestorationPort to persist composer
 * state across app restarts using the generated Mobile draft contract.
 *
 * The hook provides:
 * - Typed restoration delivery from the W4 recovery owner
 * - Debounced auto-save on text/audience changes
 * - Explicit save, clear, and rollback operations
 *
 * W6B: Initial implementation for draft recovery and rollback.
 */

import { create } from '@bufbuild/protobuf';
import { timestampFromMs, timestampMs } from '@bufbuild/protobuf/wkt';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getDraftRestorationPort,
  registerDraftRestorationConsumer,
  type DraftRestorationPort,
} from '../../runtimes/commandRuntime';
import {
  EncryptedBlobReferenceSchema,
  MobileDraftEnvelopeV2Schema,
  MobileDraftSurfaceKind,
  MomentDraftPayloadSchema,
  type MobileDraftEnvelopeV2,
} from '../../gen/proto/domain/mobile/reliability_pb';
import {
  Audience_Kind,
  AudienceSchema,
} from '../../gen/proto/domain/social/post_pb';
import { readableErrorMessage } from '../../utils/errorMessage';
import { isAccessGranted } from '../auth/authSession';
import { useAuthStore } from '../auth/authStore';

// ---------------------------------------------------------------------------
// Draft payload shape
// ---------------------------------------------------------------------------

export interface MomentDraftPayload {
  readonly text: string;
  readonly audienceKind: number;
  readonly mediaRefs: readonly string[];
  readonly savedAtMs: number;
}

// ---------------------------------------------------------------------------
// Hook types
// ---------------------------------------------------------------------------

export interface UseMomentsDraftResult {
  /** Whether the recovery owner delivered a draft to this composer */
  readonly draftRestored: boolean;
  /** Whether the current scope has local draft state */
  readonly hasDraft: boolean;
  /** Save current state as draft */
  readonly saveDraft: (
    text: string,
    audienceKind: number,
    mediaRefs: readonly string[],
  ) => void;
  /** Persist the complete current composer state before a fallible write */
  readonly persistDraftNow: (
    text: string,
    audienceKind: number,
    mediaRefs: readonly string[],
  ) => Promise<boolean>;
  /** Explicitly discard the exact Station and actor scoped draft */
  readonly discardDraft: () => Promise<boolean>;
  /** Restore the last saved draft (returns payload or null) */
  readonly restoreDraft: () => Promise<MomentDraftPayload | null>;
  /** Retry the exact failed persistence operation */
  readonly retryPersistence: () => Promise<boolean>;
  /** Whether a save is pending */
  readonly saving: boolean;
  /** Whether exact-scope removal is pending */
  readonly discarding: boolean;
  /** Last persistence failure, retained until its operation succeeds */
  readonly persistenceFailure: MomentDraftPersistenceFailure | null;
}

const DRAFT_DOMAIN_KEY = 'compose';
const AUTO_SAVE_DELAY_MS = 1500;

export interface MomentDraftScope {
  readonly stationPeerId: string;
  readonly actorPtid: string;
}

export type MomentDraftPersistenceOperation = 'save' | 'discard';

export interface MomentDraftPersistenceFailure {
  readonly operation: MomentDraftPersistenceOperation;
  readonly message: string;
}

export interface PendingMomentDraft {
  readonly text: string;
  readonly audienceKind: number;
  readonly mediaRefs: readonly string[];
}

function normalizeMediaRefs(mediaRefs: readonly string[]): string[] {
  return [...new Set(mediaRefs.filter((reference) => (
    Boolean(reference) && reference.trim() === reference
  )))];
}

export function buildMomentDraftEnvelope(
  scope: MomentDraftScope,
  draft: PendingMomentDraft,
  savedAtMs: number,
): MobileDraftEnvelopeV2 {
  return create(MobileDraftEnvelopeV2Schema, {
    schemaRevision: 2,
    stationPeerId: scope.stationPeerId,
    actorPtid: scope.actorPtid,
    surfaceKind: MobileDraftSurfaceKind.MOMENT_COMPOSER,
    targetId: DRAFT_DOMAIN_KEY,
    updatedAt: timestampFromMs(savedAtMs),
    payload: {
      case: 'moment',
      value: create(MomentDraftPayloadSchema, {
        text: draft.text,
        audience: create(AudienceSchema, {
          kind: draft.audienceKind as Audience_Kind,
        }),
        mediaRefs: normalizeMediaRefs(draft.mediaRefs).map((blobId) => (
          create(EncryptedBlobReferenceSchema, { blobId })
        )),
      }),
    },
  });
}

export function readMomentDraftEnvelope(
  envelope: MobileDraftEnvelopeV2,
): MomentDraftPayload | null {
  if (envelope.payload.case !== 'moment') return null;

  return {
    text: envelope.payload.value.text,
    audienceKind: envelope.payload.value.audience?.kind ?? Audience_Kind.PUBLIC,
    mediaRefs: envelope.payload.value.mediaRefs.map((reference) => reference.blobId),
    savedAtMs: envelope.updatedAt ? timestampMs(envelope.updatedAt) : 0,
  };
}

export function readOwnedMomentDraftEnvelope(
  envelope: MobileDraftEnvelopeV2,
  scope: MomentDraftScope,
): MomentDraftPayload {
  if (
    envelope.stationPeerId !== scope.stationPeerId
    || envelope.actorPtid !== scope.actorPtid
    || envelope.surfaceKind !== MobileDraftSurfaceKind.MOMENT_COMPOSER
    || envelope.targetId !== DRAFT_DOMAIN_KEY
  ) {
    throw new Error('mobile.reliability.draftScopeMismatch');
  }

  const payload = readMomentDraftEnvelope(envelope);
  if (!payload) {
    throw new Error('mobile.reliability.draftPayloadMismatch');
  }
  return payload;
}

export async function persistMomentDraft(
  port: Pick<DraftRestorationPort, 'save'>,
  scope: MomentDraftScope,
  draft: PendingMomentDraft,
  savedAtMs: number,
): Promise<void> {
  await port.save(buildMomentDraftEnvelope(scope, draft, savedAtMs));
}

export async function discardMomentDraft(
  port: Pick<DraftRestorationPort, 'remove'>,
  scope: MomentDraftScope,
): Promise<void> {
  await port.remove(
    scope.stationPeerId,
    scope.actorPtid,
    MobileDraftSurfaceKind.MOMENT_COMPOSER,
    DRAFT_DOMAIN_KEY,
  );
}

/**
 * Hook for managing moment composer drafts via DraftRestorationPort.
 *
 * The W4 recovery owner delivers an explicitly restored typed envelope to this
 * consumer. The Rust store remains the only persistence owner.
 */
export function useMomentsDraft(
  onDraftRestored?: (payload: MomentDraftPayload) => void,
): UseMomentsDraftResult {
  const authSession = useAuthStore((state) =>
    isAccessGranted(state.accessDecision) ? state.session : null
  );
  const stationPeerId = authSession?.stationPeerId ?? null;
  const actorPtid = authSession?.actorRef.ptid ?? null;
  const [draftRestored, setDraftRestored] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [persistenceFailure, setPersistenceFailure] =
    useState<MomentDraftPersistenceFailure | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const portRef = useRef<DraftRestorationPort | null>(null);
  const mountedRef = useRef(true);
  const latestDraftRef = useRef<PendingMomentDraft | null>(null);
  const draftRevisionRef = useRef(0);
  const scopeGenerationRef = useRef(0);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const persistenceFailureRef = useRef<MomentDraftPersistenceFailure | null>(null);
  const onDraftRestoredRef = useRef(onDraftRestored);
  onDraftRestoredRef.current = onDraftRestored;

  const updatePersistenceFailure = useCallback((
    failure: MomentDraftPersistenceFailure | null,
  ) => {
    persistenceFailureRef.current = failure;
    if (mountedRef.current) setPersistenceFailure(failure);
  }, []);

  const enqueueOperation = useCallback(<Result,>(
    operation: () => Promise<Result>,
  ): Promise<Result> => {
    const queued = operationQueueRef.current.then(operation, operation);
    operationQueueRef.current = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }, []);

  const persistDraft = useCallback((
    draft: PendingMomentDraft,
    revision: number,
    reflectSaving: boolean,
  ): Promise<boolean> => {
    const port = portRef.current;
    if (!port || !stationPeerId || !actorPtid) {
      updatePersistenceFailure({
        operation: 'save',
        message: 'draft_persistence_unavailable',
      });
      return Promise.resolve(false);
    }

    const scope = { stationPeerId, actorPtid };
    const scopeGeneration = scopeGenerationRef.current;
    const isSameScope = () => (
      mountedRef.current
      && scopeGenerationRef.current === scopeGeneration
    );
    const isCurrent = () => (
      isSameScope()
      && draftRevisionRef.current === revision
    );

    return enqueueOperation(async () => {
      if (reflectSaving && isSameScope()) setSaving(true);
      try {
        await persistMomentDraft(port, scope, draft, Date.now());
        if (!isCurrent()) return false;
        updatePersistenceFailure(null);
        return true;
      } catch (error) {
        if (isCurrent()) {
          updatePersistenceFailure({
            operation: 'save',
            message: readableErrorMessage(error, 'draft_persistence_failed'),
          });
        }
        return false;
      } finally {
        if (reflectSaving && isSameScope()) setSaving(false);
      }
    });
  }, [
    actorPtid,
    enqueueOperation,
    stationPeerId,
    updatePersistenceFailure,
  ]);

  const stageDraft = useCallback((
    text: string,
    audienceKind: number,
    mediaRefs: readonly string[],
  ): { draft: PendingMomentDraft; revision: number } | null => {
    const draft: PendingMomentDraft = {
      text,
      audienceKind,
      mediaRefs: normalizeMediaRefs(mediaRefs),
    };
    if (!draft.text.trim() && draft.mediaRefs.length === 0 && !latestDraftRef.current) {
      return null;
    }

    latestDraftRef.current = draft;
    draftRevisionRef.current += 1;
    if (mountedRef.current) setHasDraft(true);
    return {
      draft,
      revision: draftRevisionRef.current,
    };
  }, []);

  const applyRestoredEnvelope = useCallback((
    envelope: MobileDraftEnvelopeV2,
  ): MomentDraftPayload => {
    if (!stationPeerId || !actorPtid) {
      throw new Error('mobile.reliability.draftConsumerUnavailable');
    }
    const payload = readOwnedMomentDraftEnvelope(envelope, {
      stationPeerId,
      actorPtid,
    });
    latestDraftRef.current = {
      text: payload.text,
      audienceKind: payload.audienceKind,
      mediaRefs: payload.mediaRefs,
    };
    draftRevisionRef.current += 1;
    setDraftRestored(true);
    setHasDraft(true);
    updatePersistenceFailure(null);
    onDraftRestoredRef.current?.(payload);
    return payload;
  }, [actorPtid, stationPeerId, updatePersistenceFailure]);

  // Bind the active composer to the typed recovery delivery path.
  useEffect(() => {
    scopeGenerationRef.current += 1;
    portRef.current = getDraftRestorationPort();
    mountedRef.current = true;
    latestDraftRef.current = null;
    draftRevisionRef.current = 0;
    setDraftRestored(false);
    setHasDraft(false);
    setSaving(false);
    setDiscarding(false);
    updatePersistenceFailure(null);
    const unregister = stationPeerId && actorPtid
      ? registerDraftRestorationConsumer(
          stationPeerId,
          actorPtid,
          MobileDraftSurfaceKind.MOMENT_COMPOSER,
          DRAFT_DOMAIN_KEY,
          applyRestoredEnvelope,
        )
      : null;

    return () => {
      mountedRef.current = false;
      unregister?.();
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
        if (latestDraftRef.current) {
          void persistDraft(
            latestDraftRef.current,
            draftRevisionRef.current,
            false,
          );
        }
      }
    };
  }, [
    applyRestoredEnvelope,
    actorPtid,
    persistDraft,
    stationPeerId,
    updatePersistenceFailure,
  ]);

  const restoreDraft = useCallback(async (): Promise<MomentDraftPayload | null> => {
    const port = portRef.current;
    if (!port || !stationPeerId || !actorPtid) return null;

    const envelope = await port.load(
      stationPeerId,
      actorPtid,
      MobileDraftSurfaceKind.MOMENT_COMPOSER,
      DRAFT_DOMAIN_KEY,
    );
    return envelope ? applyRestoredEnvelope(envelope) : null;
  }, [actorPtid, applyRestoredEnvelope, stationPeerId]);

  const discardDraft = useCallback(async (): Promise<boolean> => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    const port = portRef.current;
    if (!port || !stationPeerId || !actorPtid) {
      updatePersistenceFailure({
        operation: 'discard',
        message: 'draft_discard_unavailable',
      });
      return false;
    }

    draftRevisionRef.current += 1;
    const revision = draftRevisionRef.current;
    const scopeGeneration = scopeGenerationRef.current;
    const scope = { stationPeerId, actorPtid };
    const isSameScope = () => (
      mountedRef.current
      && scopeGenerationRef.current === scopeGeneration
    );
    const isCurrent = () => (
      isSameScope()
      && draftRevisionRef.current === revision
    );

    if (isCurrent()) setDiscarding(true);
    return enqueueOperation(async () => {
      try {
        await discardMomentDraft(port, scope);
        if (!isCurrent()) return false;
        latestDraftRef.current = null;
        setDraftRestored(false);
        setHasDraft(false);
        updatePersistenceFailure(null);
        return true;
      } catch (error) {
        if (isCurrent()) {
          updatePersistenceFailure({
            operation: 'discard',
            message: readableErrorMessage(error, 'draft_discard_failed'),
          });
        }
        return false;
      } finally {
        if (isSameScope()) setDiscarding(false);
      }
    });
  }, [
    actorPtid,
    enqueueOperation,
    stationPeerId,
    updatePersistenceFailure,
  ]);

  const persistDraftNow = useCallback((
    text: string,
    audienceKind: number,
    mediaRefs: readonly string[],
  ): Promise<boolean> => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    const staged = stageDraft(text, audienceKind, mediaRefs);
    if (!staged) return Promise.resolve(true);
    return persistDraft(staged.draft, staged.revision, true);
  }, [persistDraft, stageDraft]);

  const saveDraft = useCallback((
    text: string,
    audienceKind: number,
    mediaRefs: readonly string[],
  ) => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    const staged = stageDraft(text, audienceKind, mediaRefs);
    if (!staged) return;
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      if (!mountedRef.current) return;
      void persistDraft(staged.draft, staged.revision, true);
    }, AUTO_SAVE_DELAY_MS);
  }, [persistDraft, stageDraft]);

  const retryPersistence = useCallback((): Promise<boolean> => {
    const failure = persistenceFailureRef.current;
    if (!failure) return Promise.resolve(true);
    if (failure.operation === 'discard') return discardDraft();

    const draft = latestDraftRef.current;
    if (!draft) return Promise.resolve(false);
    return persistDraft(draft, draftRevisionRef.current, true);
  }, [discardDraft, persistDraft]);

  return {
    draftRestored,
    hasDraft,
    saveDraft,
    persistDraftNow,
    discardDraft,
    restoreDraft,
    retryPersistence,
    saving,
    discarding,
    persistenceFailure,
  };
}
