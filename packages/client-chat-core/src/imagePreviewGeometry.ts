// Cross-mount memory of chat image intrinsic dimensions.
//
// Attachment grants are released when the conversation presentation closes
// (see ChatAttachmentAccessController.observe), so reopening a conversation
// always mints a new asset handle and therefore a new asset URL. The WebView
// cannot reuse its previous decode, and the attachment wire type carries no
// width/height metadata. Without an external dimension source, image boxes
// collapse to zero height before decode and snap open afterwards on every
// reopen.
//
// This module keeps learned intrinsic dimensions keyed by the stable
// attachment id (not the per-grant URL), so presentation can reserve the exact
// final box before the new URL finishes decoding. It stores geometry only — no
// media bytes, no grants — and therefore never extends an attachment's
// security lifetime.

export interface ChatImageIntrinsicSize {
  readonly width: number;
  readonly height: number;
}

export interface ChatImageBoxConstraints {
  readonly maxWidth: number;
  readonly maxHeight: number;
}

export interface ChatImageReservedBox extends ChatImageIntrinsicSize {
  /** False when the box is the caller's fallback, not learned geometry. */
  readonly exact: boolean;
}

const MAX_ENTRIES = 256;

const geometryById = new Map<string, ChatImageIntrinsicSize>();

function isPositiveDimension(value: number): value is number {
  return Number.isFinite(value) && value > 0;
}

/** Record intrinsic dimensions learned from a decoded image. Re-recording an
    id refreshes its LRU recency. */
export function recordChatImageGeometry(
  id: string,
  width: number,
  height: number,
): void {
  if (!id || !isPositiveDimension(width) || !isPositiveDimension(height)) return;
  geometryById.delete(id);
  geometryById.set(id, {
    width: Math.round(width),
    height: Math.round(height),
  });
  if (geometryById.size > MAX_ENTRIES) {
    const oldest = geometryById.keys().next().value;
    if (oldest !== undefined) geometryById.delete(oldest);
  }
}

export function readChatImageGeometry(id: string): ChatImageIntrinsicSize | null {
  return geometryById.get(id) ?? null;
}

export function hasChatImageGeometry(id: string): boolean {
  return geometryById.has(id);
}

/** Scale intrinsic dimensions to fit both caps, preserving aspect ratio.
    Mirrors the CSS `object-fit: contain` + max-width/max-height caps, so the
    reserved box matches the decoded image at 1:1 pixel size. */
export function fitChatImageBox(
  intrinsic: ChatImageIntrinsicSize,
  constraints: ChatImageBoxConstraints,
): ChatImageIntrinsicSize {
  const scale = Math.min(
    1,
    constraints.maxWidth / intrinsic.width,
    constraints.maxHeight / intrinsic.height,
  );
  return {
    width: Math.round(intrinsic.width * scale),
    height: Math.round(intrinsic.height * scale),
  };
}

/** Resolve a stable presentation box: learned geometry when available,
    otherwise the caller-provided placeholder so the tile never collapses. */
export function reserveChatImageBox(
  id: string,
  constraints: ChatImageBoxConstraints,
  fallback: ChatImageIntrinsicSize,
): ChatImageReservedBox {
  const intrinsic = readChatImageGeometry(id);
  if (!intrinsic) return { ...fallback, exact: false };
  return { ...fitChatImageBox(intrinsic, constraints), exact: true };
}

export function clearChatImageGeometryForTests(): void {
  geometryById.clear();
}
