// Resolve `MessageAttachment.cid` (federated `oss://{host}/{key}` URI or
// a bare key from legacy uploads) to a renderer-friendly URL.
//
// The hook keeps a module-level cache so a chat list with N references
// to the same attachment fires the Tauri command at most once per
// process lifetime. Resolution is best-effort — if Station is offline
// or the cid is malformed, the hook returns `null` and the caller
// should render its fallback UI.
//
// Strategy:
//   1. Hit the in-memory cache.
//   2. Otherwise call `api.ossResolveUrl(cid)`.
//   3. Prefer `local_path` (served via Tauri's `convertFileSrc`) — it
//      keeps the WebView from going to network for already-cached
//      attachments. Fall back to the absolute `url` when no local
//      mirror is available.

import { useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { api } from '../../services/desktop_api';

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

export function useAttachmentUrl(cid: string | undefined | null): string | null {
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
