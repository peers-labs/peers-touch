/**
 * useMomentsDraft.ts — Draft save/restore hook for moment composer
 *
 * Integrates with W4's DraftRestorationPort to persist composer
 * state across app restarts. Drafts are keyed by 'moments:compose'
 * and serialized as JSON.
 *
 * The hook provides:
 * - Auto-restore on mount (if a saved draft exists)
 * - Debounced auto-save on text/audience changes
 * - Explicit save, clear, and rollback operations
 *
 * W6B: Initial implementation for draft recovery and rollback.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { getDraftRestorationPort, type DraftRestorationPort } from '../../runtimes/commandRuntime';
import type { Audience_Kind } from '../../gen/proto/domain/social/post_pb';

// ---------------------------------------------------------------------------
// Draft payload shape (serialized to JSON)
// ---------------------------------------------------------------------------

export interface MomentDraftPayload {
  readonly text: string;
  readonly audienceKind: number;
  readonly savedAtMs: number;
}

// ---------------------------------------------------------------------------
// Hook types
// ---------------------------------------------------------------------------

export interface UseMomentsDraftResult {
  /** Whether a draft was restored on mount */
  readonly draftRestored: boolean;
  /** Save current state as draft */
  readonly saveDraft: (text: string, audienceKind: number) => void;
  /** Clear the saved draft */
  readonly clearDraft: () => void;
  /** Restore the last saved draft (returns payload or null) */
  readonly restoreDraft: () => Promise<MomentDraftPayload | null>;
  /** Whether a save is pending */
  readonly saving: boolean;
}

const DRAFT_DOMAIN_KEY = 'compose';
const AUTO_SAVE_DELAY_MS = 1500;

/**
 * Hook for managing moment composer drafts via DraftRestorationPort.
 *
 * On mount, attempts to restore a previously saved draft. Provides
 * debounced auto-save and explicit save/clear/rollback operations.
 */
export function useMomentsDraft(
  onDraftRestored?: (payload: MomentDraftPayload) => void,
): UseMomentsDraftResult {
  const [draftRestored, setDraftRestored] = useState(false);
  const [saving, setSaving] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const portRef = useRef<DraftRestorationPort | null>(null);
  const mountedRef = useRef(true);

  // Get the draft port singleton
  useEffect(() => {
    portRef.current = getDraftRestorationPort();
    mountedRef.current = true;

    // Attempt to restore draft on mount
    void restoreDraftInternal().then((payload) => {
      if (payload && mountedRef.current) {
        setDraftRestored(true);
        onDraftRestored?.(payload);
      }
    });

    return () => {
      mountedRef.current = false;
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  // Run only on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function restoreDraftInternal(): Promise<MomentDraftPayload | null> {
    const port = portRef.current;
    if (!port) return null;

    try {
      const projection = await port.load('moments', DRAFT_DOMAIN_KEY);
      if (!projection) return null;

      const parsed = JSON.parse(projection.payloadJson) as Record<string, unknown>;
      if (typeof parsed.text !== 'string') return null;

      return {
        text: parsed.text,
        audienceKind: typeof parsed.audienceKind === 'number' ? parsed.audienceKind : 1,
        savedAtMs: typeof parsed.savedAtMs === 'number' ? parsed.savedAtMs : projection.updatedAtMs,
      };
    } catch {
      return null;
    }
  }

  const saveDraft = useCallback((text: string, audienceKind: number) => {
    // Cancel pending auto-save
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // Skip saving empty drafts
    if (!text.trim()) return;

    autoSaveTimerRef.current = setTimeout(() => {
      const port = portRef.current;
      if (!port || !mountedRef.current) return;

      const payload: MomentDraftPayload = {
        text,
        audienceKind,
        savedAtMs: Date.now(),
      };

      setSaving(true);
      void port.save('moments', DRAFT_DOMAIN_KEY, JSON.stringify(payload)).finally(() => {
        if (mountedRef.current) setSaving(false);
      });
    }, AUTO_SAVE_DELAY_MS);
  }, []);

  const clearDraft = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    const port = portRef.current;
    if (!port) return;

    void port.remove('moments', DRAFT_DOMAIN_KEY);
    setDraftRestored(false);
  }, []);

  const restoreDraft = useCallback(async (): Promise<MomentDraftPayload | null> => {
    return restoreDraftInternal();
  }, []);

  return {
    draftRestored,
    saveDraft,
    clearDraft,
    restoreDraft,
    saving,
  };
}
