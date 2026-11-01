// Resolve `oss://{host}/{key}` (or bare key) to a renderer-friendly URL.
//
// 主模块 = OSS, consumers = chat / social / future modules. The hook
// keeps a module-level cache so a list with N references to the same
// CID fires the Tauri command at most once per process lifetime.
// Resolution is best-effort — if Station is offline or the CID is
// malformed, the hook returns `null` and the caller should render its
// fallback UI.
//
// Strategy:
//   1. Hit the in-memory cache.
//   2. Otherwise call `api.ossResolveUrl(cid)`.
//   3. Prefer inline image data when Rust can safely provide it, then
//      `local_path` (served via Tauri's `convertFileSrc`). Fall back to
//      the absolute `url` when no local mirror is available.
//
import { useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { isDocumentHidden } from '../../../kernel/documentVisibility';
import { api } from '../../../services/desktop_api';
import {
  clearInflightOssAttachmentUrl,
  getCachedOssAttachmentUrl,
  getInflightOssAttachmentUrl,
  setCachedOssAttachmentUrl,
  setInflightOssAttachmentUrl,
} from '../../../services/ossAttachmentUrlCache';

type Resolved = { src: string } | null;

// Backoff for a CID the Station cannot resolve yet (eventual consistency /
// offline OSS). Retries stay cheap after the first failure because resolve()
// memoizes in-flight work and permanent misses (explicit null cache entry)
// stop the loop.
const RETRY_DELAYS_MS = [2_000, 8_000, 30_000];
// Bound the retry budget (~5 min): a CID that stays unresolvable stops here
// instead of holding a timer for the card's whole lifetime.
const MAX_RESOLVE_ATTEMPTS = 6;

async function resolve(cid: string): Promise<Resolved> {
  if (!cid) return null;
  const cached = getCachedOssAttachmentUrl(cid);
  if (cached !== undefined) return cached;
  const inflight = getInflightOssAttachmentUrl(cid);
  if (inflight) return inflight;

  const promise = (async (): Promise<Resolved> => {
    try {
      const data = await api.ossResolveUrl(cid);
      if (!data) {
        setCachedOssAttachmentUrl(cid, null);
        return null;
      }
      const src = data.data_url
        || (data.local_path ? convertFileSrc(data.local_path) : data.url);
      const value: Resolved = src ? { src } : null;
      setCachedOssAttachmentUrl(cid, value);
      return value;
    } catch {
      // Don't poison the cache on transient failures — leave the entry
      // unset so the next render retries on its own.
      return null;
    } finally {
      clearInflightOssAttachmentUrl(cid);
    }
  })();
  setInflightOssAttachmentUrl(cid, promise);
  return promise;
}

export function useOssAttachmentUrl(
  cid: string | undefined | null,
): string | null {
  const [src, setSrc] = useState<string | null>(() => {
    if (!cid) return null;
    return getCachedOssAttachmentUrl(cid)?.src ?? null;
  });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    if (!cid) {
      // Async clear keeps the effect body free of a synchronous setState.
      queueMicrotask(() => {
        if (!cancelled) setSrc(null);
      });
      return () => {
        cancelled = true;
        if (timer !== null) clearTimeout(timer);
      };
    }

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      // Never burn retries while the tab is backgrounded; the next tick is
      // rescheduled and the visibility resume also re-renders consumers.
      if (isDocumentHidden()) {
        timer = setTimeout(() => void tick(), RETRY_DELAYS_MS[0]);
        return;
      }
      const result = await resolve(cid);
      if (cancelled) return;
      if (result) {
        setSrc(result.src);
        return;
      }
      // An explicit cached null means the CID is permanently unresolvable;
      // an unset entry is a transient failure worth retrying.
      if (getCachedOssAttachmentUrl(cid) === null) return;
      if (attempt >= MAX_RESOLVE_ATTEMPTS) return;
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      attempt += 1;
      timer = setTimeout(() => void tick(), delay);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [cid]);

  return src;
}
