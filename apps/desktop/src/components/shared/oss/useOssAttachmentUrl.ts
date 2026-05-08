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
//   3. Prefer `local_path` (served via Tauri's `convertFileSrc`) — it
//      keeps the WebView from going to network for already-cached
//      attachments. Fall back to the absolute `url` when no local
//      mirror is available.
//
// Originally lived under `components/chat/useAttachmentUrl.ts`. Moved
// to `components/shared/oss/` in P3 because Moments image rendering
// uses the exact same logic; the chat-side path now re-exports this
// for backward compatibility (P3 commit C1).

import { useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { api } from '../../../services/desktop_api';

type Resolved = { src: string } | null;

const cache = new Map<string, Resolved>();
const inflight = new Map<string, Promise<Resolved>>();

async function resolve(cid: string): Promise<Resolved> {
  if (!cid) return null;
  if (cache.has(cid)) return cache.get(cid) ?? null;
  if (inflight.has(cid)) return inflight.get(cid)!;

  const promise = (async (): Promise<Resolved> => {
    try {
      const data = await api.ossResolveUrl(cid);
      if (!data) {
        cache.set(cid, null);
        return null;
      }
      const src = data.local_path
        ? convertFileSrc(data.local_path)
        : data.url;
      const value: Resolved = src ? { src } : null;
      cache.set(cid, value);
      return value;
    } catch {
      // Don't poison the cache on transient failures — leave the entry
      // unset so the next render retries on its own.
      return null;
    } finally {
      inflight.delete(cid);
    }
  })();
  inflight.set(cid, promise);
  return promise;
}

export function useOssAttachmentUrl(
  cid: string | undefined | null,
): string | null {
  const [src, setSrc] = useState<string | null>(() => {
    if (!cid) return null;
    return cache.get(cid)?.src ?? null;
  });

  useEffect(() => {
    if (!cid) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    resolve(cid).then((r) => {
      if (!cancelled) setSrc(r?.src ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [cid]);

  return src;
}

/**
 * @deprecated Renamed to `useOssAttachmentUrl`. The chat-side
 * `useAttachmentUrl` re-exports this; new code should import from
 * `components/shared/oss/useOssAttachmentUrl`.
 */
export const useAttachmentUrl = useOssAttachmentUrl;
