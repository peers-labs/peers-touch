type ResolvedAttachmentUrl = { src: string } | null;

const resolvedUrlCache = new Map<string, ResolvedAttachmentUrl>();
const inflightResolutions = new Map<string, Promise<ResolvedAttachmentUrl>>();
const localObjectUrls = new Map<string, string>();

export function getCachedOssAttachmentUrl(cid: string): ResolvedAttachmentUrl | undefined {
  const normalized = cid.trim();
  if (!normalized) return null;
  const localObjectUrl = localObjectUrls.get(normalized);
  if (localObjectUrl) return { src: localObjectUrl };
  return resolvedUrlCache.get(normalized);
}

export function setCachedOssAttachmentUrl(cid: string, value: ResolvedAttachmentUrl): void {
  const normalized = cid.trim();
  if (!normalized) return;
  resolvedUrlCache.set(normalized, value);
}

export function getInflightOssAttachmentUrl(
  cid: string,
): Promise<ResolvedAttachmentUrl> | undefined {
  return inflightResolutions.get(cid.trim());
}

export function setInflightOssAttachmentUrl(
  cid: string,
  promise: Promise<ResolvedAttachmentUrl>,
): void {
  const normalized = cid.trim();
  if (!normalized) return;
  inflightResolutions.set(normalized, promise);
}

export function clearInflightOssAttachmentUrl(cid: string): void {
  inflightResolutions.delete(cid.trim());
}

export function registerOssAttachmentObjectUrl(cid: string, blob: Blob): void {
  const normalized = cid.trim();
  if (!normalized || localObjectUrls.has(normalized)) return;
  const objectUrl = URL.createObjectURL(blob);
  localObjectUrls.set(normalized, objectUrl);
  resolvedUrlCache.set(normalized, { src: objectUrl });
}
