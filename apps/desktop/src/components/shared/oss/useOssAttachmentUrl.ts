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
import { api } from '../../../services/desktop_api';
import {
  clearInflightOssAttachmentUrl,
  getCachedOssAttachmentUrl,
  getInflightOssAttachmentUrl,
  setCachedOssAttachmentUrl,
  setInflightOssAttachmentUrl,
} from '../../../services/ossAttachmentUrlCache';

type Resolved = { src: string } | null;

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
