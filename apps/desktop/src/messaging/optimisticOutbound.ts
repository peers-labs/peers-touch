// Optimistic outbound messages.
//
// The sender must see their own message immediately, using the local asset
// (blob:/asset URL) that already exists on this device — never a black block
// and never a wait on staging or network upload. Staging, engine send and
// reconciliation are a separate background flow that only flips the status of
// an already-rendered, stable-keyed optimistic row.
//
// This module is intentionally pure: it owns the state machine shapes and
// transition helpers so they are unit-testable without React or the store.

export type OptimisticTransferStatus = 'staging' | 'sending' | 'sent' | 'failed';

/** A single attachment carried by an optimistic message. */
export interface OptimisticAttachment {
  /** Stable per-pick id; doubles as the React key for the preview tile. */
  localId: string;
  /** Immediately renderable local URL (blob: or a Tauri asset URL). */
  previewUrl: string | null;
  filename: string;
  mimeType: string;
  size: number;
  isImage: boolean;
  durationSeconds?: number;
  status: OptimisticTransferStatus;
}

export interface OptimisticOutboundMessage {
  /** Stable client id for this optimistic row (React key, never reused). */
  localId: string;
  /** The engine intent id; the real message reconciles on this / messageId. */
  sendIntentId: string;
  conversationUlid: string;
  kind: 'friend' | 'group';
  text: string;
  createdAtMs: number;
  attachments: OptimisticAttachment[];
  status: OptimisticTransferStatus;
  /** Set once the engine admits the message; equals the projected message ulid. */
  reconciledMessageId?: string;
  errorCode?: string;
}

/** Local descriptor handed from the composer before staging completes. */
export interface LocalAttachmentDraft {
  localId: string;
  previewUrl: string | null;
  ownsPreviewUrl: boolean;
  filename: string;
  mimeType: string;
  size: number;
  isImage: boolean;
  durationSeconds?: number;
}

export function optimisticConversationKey(
  kind: 'friend' | 'group',
  conversationUlid: string,
): string {
  return `${kind}:${conversationUlid}`;
}

export function createOptimisticMessage(input: {
  localId: string;
  sendIntentId: string;
  conversationUlid: string;
  kind: 'friend' | 'group';
  text: string;
  drafts: LocalAttachmentDraft[];
  nowMs?: number;
}): OptimisticOutboundMessage {
  const attachments: OptimisticAttachment[] = input.drafts.map((draft) => ({
    localId: draft.localId,
    previewUrl: draft.previewUrl,
    filename: draft.filename,
    mimeType: draft.mimeType,
    size: draft.size,
    isImage: draft.isImage,
    durationSeconds: draft.durationSeconds,
    // The row appears instantly; transfers start in the background.
    status: 'staging',
  }));
  return {
    localId: input.localId,
    sendIntentId: input.sendIntentId,
    conversationUlid: input.conversationUlid,
    kind: input.kind,
    text: input.text,
    createdAtMs: input.nowMs ?? Date.now(),
    attachments,
    status: attachments.length > 0 ? 'staging' : 'sending',
  };
}

/** Immutable status patch for one optimistic message. */
export function patchOptimisticMessage(
  message: OptimisticOutboundMessage,
  patch: Partial<Pick<OptimisticOutboundMessage, 'status' | 'reconciledMessageId' | 'errorCode'>>,
): OptimisticOutboundMessage {
  return { ...message, ...patch };
}

/**
 * Reconcile optimistic rows against the projected message list. A row is
 * considered delivered once the engine-admitted messageId appears as a real
 * message ulid, or the engine reports a terminal send state without an id.
 * Returns the rows that still have no durable counterpart (and must stay).
 */
export function reconcileOptimisticMessages(
  rows: OptimisticOutboundMessage[],
  visibleMessageIds: ReadonlySet<string>,
): { keep: OptimisticOutboundMessage[]; reconciled: OptimisticOutboundMessage[] } {
  const keep: OptimisticOutboundMessage[] = [];
  const reconciled: OptimisticOutboundMessage[] = [];
  for (const row of rows) {
    const delivered = Boolean(
      row.reconciledMessageId && visibleMessageIds.has(row.reconciledMessageId),
    );
    if (delivered) reconciled.push(row);
    else keep.push(row);
  }
  return { keep, reconciled };
}

/** True while any attachment (or the message itself) is still in flight. */
export function isOptimisticInFlight(message: OptimisticOutboundMessage): boolean {
  return message.status === 'staging' || message.status === 'sending';
}

/** Preview URLs the caller must revoke once the row leaves the screen. */
export function collectPreviewUrls(rows: OptimisticOutboundMessage[]): string[] {
  const urls: string[] = [];
  for (const row of rows) {
    for (const attachment of row.attachments) {
      if (attachment.previewUrl?.startsWith('blob:')) urls.push(attachment.previewUrl);
    }
  }
  return urls;
}
