import { useEffect, useState, type SyntheticEvent } from 'react';
import {
  chatImageObjectUrlCache,
  recordChatImageGeometry,
  reserveChatImageBox,
  type ChatImageReservedBox,
} from '@peers-touch/client-chat-core';

// Caps mirror .sc-attachment--image (max-width: min(240px, 100%)) and
// .sc-attachment__image img (max-height: 260px) in ui/chat.css, so the
// reserved box matches the decoded image at 1:1 pixel size.
const IMAGE_PREVIEW_CONSTRAINTS = { maxWidth: 240, maxHeight: 260 };
// Before the first decode the wire carries no dimensions; hold the historic
// 160x96 tile instead of collapsing to a zero-height box.
const IMAGE_PREVIEW_FALLBACK = { width: 160, height: 96 };

/**
 * Reserve a stable image tile and a stable object URL across grant churn.
 *
 * Reopening a conversation releases the attachment grant and mints a new
 * no-store asset URL, so the <img> would otherwise fetch and decode again.
 * The reserved box (keyed by attachment id) removes the layout shift, and
 * the object URL cache keeps the already-decrypted bytes on a stable URL so
 * re-display is instant without re-fetching or re-decoding.
 */
export function useChatImagePreview(attachmentId: string, src: string | null) {
  const [box, setBox] = useState<ChatImageReservedBox>(() =>
    reserveChatImageBox(attachmentId, IMAGE_PREVIEW_CONSTRAINTS, IMAGE_PREVIEW_FALLBACK),
  );
  // A stable in-WebView object URL survives grant/asset-URL churn; null until
  // the first successful prime.
  // The <img> renders the preview representation, so the cache primes and
  // falls back to that exact resource (not the full-size asset).
  const previewSrc = src ? `${src}?representation=preview` : null;
  const [objectUrl, setObjectUrl] = useState<string | null>(
    () => chatImageObjectUrlCache.get(attachmentId),
  );
  const [loaded, setLoaded] = useState(() => chatImageObjectUrlCache.has(attachmentId));

  // Geometry is keyed to the attachment, not the ephemeral grant URL, so it
  // must not reset when src changes.
  useEffect(() => {
    setBox(reserveChatImageBox(attachmentId, IMAGE_PREVIEW_CONSTRAINTS, IMAGE_PREVIEW_FALLBACK));
  }, [attachmentId]);

  // Resolve a stable object URL: serve the cache immediately on re-open,
  // otherwise prime it from the freshly granted preview URL in the background.
  useEffect(() => {
    const cached = chatImageObjectUrlCache.get(attachmentId);
    if (cached) {
      setObjectUrl(cached);
      setLoaded(true);
      return;
    }
    setObjectUrl(null);
    if (!previewSrc) return;
    let active = true;
    void chatImageObjectUrlCache.prime(attachmentId, previewSrc).then((url) => {
      if (active && url) {
        setObjectUrl(url);
        setLoaded(true);
      }
    });
    return () => {
      active = false;
    };
  }, [attachmentId, previewSrc]);

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      recordChatImageGeometry(attachmentId, image.naturalWidth, image.naturalHeight);
      setBox(reserveChatImageBox(attachmentId, IMAGE_PREVIEW_CONSTRAINTS, IMAGE_PREVIEW_FALLBACK));
    }
    setLoaded(true);
  };

  return { box, loaded, handleLoad, displayUrl: objectUrl ?? previewSrc };
}
