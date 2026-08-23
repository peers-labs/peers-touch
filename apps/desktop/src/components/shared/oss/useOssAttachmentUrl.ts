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
import { useEffect, useMemo, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  clientMediaEncryptionDescriptorFromAttachment,
  decryptClientMediaBlob,
} from '@peers-touch/client-media-security';
import { api } from '../../../services/desktop_api';
import { openMomentMediaKeyFromAudience } from '../../../services/momentAudienceKeys';
import type { Audience } from '../../../gen/proto/domain/social/post_pb';
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
      // #region debug-point A,B:background-resolver-output
      fetch('http://127.0.0.1:7779/event', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'uploaded-background-resource',
          runId: 'pre-fix',
          hypothesisId: 'A,B',
          location: 'useOssAttachmentUrl:resolve',
          msg: '[DEBUG] OSS attachment resolver selected renderer source',
          data: {
            cid,
            host: data.host,
            key: data.key,
            localPath: data.local_path || '',
            fallbackUrl: data.url,
            hasDataUrl: Boolean(data.data_url),
            selectedSource: data.data_url
              ? 'data-url'
              : data.local_path
                ? 'asset-url'
                : data.url
                  ? 'network-url'
                  : 'none',
            selectedUrl: data.data_url ? '' : src,
            selectedLength: src?.length || 0,
          },
          ts: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
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

export function useDecryptedOssAttachmentUrl(
  attachment: {
    readonly cid?: string;
    readonly mimeType?: string;
    readonly mime_type?: string;
    readonly audience?: Audience | null;
    readonly authorDid?: string | null;
  } & Parameters<typeof clientMediaEncryptionDescriptorFromAttachment>[0],
): string | null {
  const sourceUrl = useOssAttachmentUrl(attachment.cid);
  const descriptor = useMemo(
    () => clientMediaEncryptionDescriptorFromAttachment(attachment),
    [attachment],
  );
  const [decryptedUrl, setDecryptedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceUrl || (!descriptor && !attachment.mediaEncryption && !attachment.media_encryption)) {
      setDecryptedUrl(null);
      return undefined;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      const mediaDescriptor = descriptor ?? clientMediaEncryptionDescriptorFromAttachment(
        attachment,
        await openMomentMediaKeyFromAudience({
          cid: attachment.cid ?? '',
          audience: attachment.audience,
          authorDid: attachment.authorDid,
        }) ?? undefined,
      );
      if (!mediaDescriptor) {
        if (!cancelled) setDecryptedUrl(null);
        return;
      }
      const response = await fetch(sourceUrl, { cache: 'no-store' });
      const ciphertext = await response.blob();
      const plaintext = await decryptClientMediaBlob({
        ciphertext,
        descriptor: mediaDescriptor,
        mimeType: attachment.mimeType ?? attachment.mime_type ?? 'application/octet-stream',
      });
      objectUrl = URL.createObjectURL(plaintext);
      if (cancelled) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      setDecryptedUrl(objectUrl);
    })().catch(() => {
      if (!cancelled) setDecryptedUrl(null);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment, descriptor, sourceUrl]);

  return (descriptor || attachment.mediaEncryption || attachment.media_encryption) ? decryptedUrl : sourceUrl;
}
