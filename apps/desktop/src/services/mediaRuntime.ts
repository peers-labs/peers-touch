/**
 * Media Runtime — pre-warms media (images, files) from chat messages so they
 * are ready when the user scrolls into a conversation.
 *
 * The store tracks which session ULIDs have already been prewarmed to avoid
 * redundant work. The lifecycle hooks (`installMediaRuntime` /
 * `teardownMediaRuntime`) are wired from `appRuntime.ts` alongside other
 * legacy bridges that are not yet wrapped by RuntimeDescriptors.
 */

import { create } from 'zustand';
import { log } from '../utils/logger';
import type { SocialMessage } from '../store/socialProjection';

interface MediaRuntimeState {
  /** Set of session ULIDs that have already been prewarmed. */
  prewarmedSessions: Set<string>;

  /**
   * Pre-warm media URLs from messages so the browser caches them before
   * the user scrolls into view.
   *
   * Accepts the same shape as `useSocialChatStore.getState().messages`:
   * a record keyed by session ULID mapping to message arrays.
   */
  prewarmMessages: (messages: Record<string, SocialMessage[]>) => void;

  /** Reset the prewarmed tracking state. */
  reset: () => void;
}

function extractMediaUrls(messages: SocialMessage[]): string[] {
  const urls: string[] = [];
  for (const message of messages) {
    if (!message.attachments || message.attachments.length === 0) continue;
    for (const attachment of message.attachments) {
      // Prefer thumbnail for prewarming (smaller payload); fall back to
      // the main CID-based reference when no thumbnail exists.
      const cid = (attachment.thumbnailCid || attachment.cid) as string | undefined;
      if (cid) urls.push(cid);
    }
  }
  return urls;
}

function prewarmCids(cids: string[]): void {
  // Trigger browser-level fetch caching via <link rel="prefetch"> elements.
  // This is a best-effort operation; failures are silently ignored since
  // the user will simply load the media on demand.
  for (const cid of cids) {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = cid;
    link.as = 'image';
    document.head.appendChild(link);
    // Clean up after a short delay to avoid DOM bloat.
    setTimeout(() => {
      try { link.remove(); } catch { /* noop */ }
    }, 30_000);
  }
}

export const useMediaRuntimeStore = create<MediaRuntimeState>((set, get) => ({
  prewarmedSessions: new Set(),

  prewarmMessages: (messages) => {
    const state = get();
    const newlyPrewarmed: string[] = [];

    for (const sessionUlid of Object.keys(messages)) {
      if (state.prewarmedSessions.has(sessionUlid)) continue;

      const sessionMessages = messages[sessionUlid];
      if (!sessionMessages || sessionMessages.length === 0) continue;

      const cids = extractMediaUrls(sessionMessages);
      if (cids.length > 0) {
        prewarmCids(cids);
      }
      newlyPrewarmed.push(sessionUlid);
    }

    if (newlyPrewarmed.length > 0) {
      set((prev) => {
        const next = new Set(prev.prewarmedSessions);
        for (const ulid of newlyPrewarmed) next.add(ulid);
        return { prewarmedSessions: next };
      });
      log.info('mediaRuntime', 'prewarmed sessions', { count: newlyPrewarmed.length });
    }
  },

  reset: () => set({ prewarmedSessions: new Set() }),
}));

let installed = false;

/** Install the media runtime. Called once from `appRuntime.ts`. */
export function installMediaRuntime(): void {
  if (installed) return;
  installed = true;
  log.info('mediaRuntime', 'installed');
}

/** Tear down the media runtime and reset prewarm state. */
export function teardownMediaRuntime(): void {
  if (!installed) return;
  installed = false;
  useMediaRuntimeStore.getState().reset();
  log.info('mediaRuntime', 'torn down');
}
