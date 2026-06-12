export const CHAT_MESSAGE_TYPE_TEXT = 1;
export const CHAT_MESSAGE_TYPE_IMAGE = 2;
export const CHAT_MESSAGE_TYPE_FILE = 3;
export const CHAT_MESSAGE_TYPE_AUDIO = 4;
export const CHAT_MESSAGE_TYPE_VIDEO = 5;

export interface ComposerEnterKeyState {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly isComposing?: boolean;
  readonly nativeIsComposing?: boolean;
  readonly keyCode?: number;
  readonly lastCompositionEndAt?: number;
  readonly now?: number;
}

export interface ChatComposerCapabilities {
  readonly emoji?: boolean;
  readonly file?: boolean;
  readonly screenshot?: boolean;
  readonly voice?: boolean;
}

export type ResolvedChatComposerCapabilities = Required<ChatComposerCapabilities>;

export interface ChatComposerDraftState {
  readonly text?: string;
  readonly attachmentCount?: number;
  readonly capabilities?: ChatComposerCapabilities;
}

export type ChatMediaKind = 'image' | 'video' | 'audio' | 'file';
export type ChatMediaTransferStatus = 'queued' | 'uploading' | 'ready' | 'failed';
export type ChatAttachmentVisibility = 'public' | 'chat' | 'private';

export type SocialHostEventKind =
  | 'app-resume'
  | 'network-online'
  | 'push'
  | 'deep-link'
  | 'notification-tap'
  | 'native-hint';

export interface SocialHostEvent {
  readonly kind: SocialHostEventKind;
  readonly target?: string;
  readonly sessionUlid?: string;
  readonly notificationId?: string;
  readonly url?: string;
  readonly reason?: string;
}

export interface SocialHostEventPayloadLike {
  readonly kind?: string;
  readonly target?: string;
  readonly sessionUlid?: string;
  readonly session_ulid?: string;
  readonly notificationId?: string;
  readonly notification_id?: string;
  readonly url?: string;
  readonly reason?: string;
}

export interface ChatAttachmentLike {
  readonly cid?: string;
  readonly filename?: string;
  readonly mimeType?: string;
  readonly mime_type?: string;
  readonly visibility?: string;
  readonly size?: number | string | bigint;
  readonly thumbnailCid?: string;
  readonly thumbnail_cid?: string;
  readonly mediaEncryption?: unknown;
  readonly media_encryption?: unknown;
  readonly encryptionSuite?: string;
  readonly encryption_suite?: string;
  readonly encryptionKeyB64?: string;
  readonly encryption_key_b64?: string;
  readonly encryptionNonceB64?: string;
  readonly encryption_nonce_b64?: string;
  readonly plaintextSha256B64?: string;
  readonly plaintext_sha256_b64?: string;
  readonly ciphertextSha256B64?: string;
  readonly ciphertext_sha256_b64?: string;
  readonly plaintextSize?: number | string | bigint;
  readonly plaintext_size?: number | string | bigint;
  readonly ciphertextSize?: number | string | bigint;
  readonly ciphertext_size?: number | string | bigint;
  readonly chunking?: string;
  readonly chunkSize?: number | string | bigint;
  readonly chunk_size?: number | string | bigint;
  readonly chunkCount?: number | string | bigint;
  readonly chunk_count?: number | string | bigint;
  readonly tagSize?: number | string | bigint;
  readonly tag_size?: number | string | bigint;
  readonly nonceStrategy?: string;
  readonly nonce_strategy?: string;
}

export interface ChatEncryptedMessagePayload<Attachment extends ChatAttachmentLike = ChatAttachmentLike> {
  readonly text: string;
  readonly attachments: readonly Attachment[];
  readonly messageType?: number;
}

export interface ChatMessageLike<Attachment extends ChatAttachmentLike = ChatAttachmentLike> {
  readonly ulid?: string;
  readonly senderDid?: string;
  readonly content?: string;
  readonly attachments?: readonly Attachment[];
  readonly replyToUlid?: string;
  readonly threadRootUlid?: string;
  readonly recalled?: boolean;
}

export interface ChatAttachmentPreviewLabels {
  readonly image: string;
  readonly video: string;
  readonly audio: string;
  readonly file: string;
}

export type ChatMessageDisplayKind = 'text' | 'recalled' | 'encrypted' | 'empty';

export interface ChatMessageDisplayInput {
  readonly content?: string;
  readonly recalled?: boolean;
  readonly encrypted?: boolean;
}

export interface ChatMessageEditInput {
  readonly own: boolean;
  readonly recalled: boolean;
  readonly encrypted?: boolean;
  readonly content?: string;
}

export interface ChatMessageSurfaceOptions<T extends ChatMessageLike> {
  readonly messages: readonly T[];
  readonly resolveTimestampMs: (message: T) => number;
  readonly timeGroupGapMs?: number;
}

export interface ChatMessageSurfaceItem<T extends ChatMessageLike> {
  readonly kind: 'message';
  readonly index: number;
  readonly message: T;
  readonly previousMessage?: T;
  readonly timestampMs: number;
  readonly dayKey: string;
  readonly showDateSeparator: boolean;
  readonly timelineGap: boolean;
}

export interface ChatConversationPreferenceLike {
  readonly sticky?: boolean;
  readonly muted?: boolean;
  readonly alertEnabled?: boolean;
  readonly clearedAt?: number;
}

export interface ChatConversationSurfaceOptions<T> {
  readonly conversations: readonly T[];
  readonly query?: string;
  readonly resolvePreference: (conversation: T) => ChatConversationPreferenceLike | undefined;
  readonly resolveSearchText: (conversation: T) => string;
  readonly resolveUnread: (conversation: T) => number;
  readonly resolveUpdatedAt: (conversation: T) => number;
}

export interface ChatConversationSurfaceItem<T> {
  readonly kind: 'conversation';
  readonly conversation: T;
  readonly index: number;
  readonly preference: ChatConversationPreferenceLike | undefined;
  readonly searchText: string;
  readonly unread: number;
  readonly updatedAt: number;
  readonly visibleUnread: number;
}

export interface ChatThreadSurfaceOptions<T extends ChatMessageLike> {
  readonly rootUlid?: string | null;
  readonly currentMessages: readonly T[];
  readonly loadedThreadMessages: readonly T[];
}

export interface ChatThreadSurface<T extends ChatMessageLike> {
  readonly rootMessage: T | null;
  readonly replies: T[];
  readonly displayMessages: T[];
}

export interface ChatStatusMessageLike {
  readonly ulid?: string;
  readonly status?: number;
}

export interface ChatMutableMessageLike extends ChatMessageLike {
  readonly encryptedPayload?: Uint8Array;
  readonly editedAt?: unknown;
}

export type ChatMessageMutationKind = 'RECALL' | 'EDIT' | 'DELETE';

export interface ChatMessageMutationInput {
  readonly kind: ChatMessageMutationKind;
  readonly newContent?: string;
  readonly newCiphertext?: Uint8Array;
  readonly mutatedTsUnixMs?: number;
}

export interface ChatMessageMutationOptions<EditedAt = unknown> {
  readonly now?: () => number;
  readonly createEditedAt?: (unixMs: number) => EditedAt;
  readonly emptyCiphertext?: () => Uint8Array;
  readonly canMutateMessage?: (message: ChatMutableMessageLike) => boolean;
}

export interface ChatMergeMessagesOptions<T extends ChatMessageLike> {
  readonly resolveTimestampMs: (message: T) => number;
  readonly shouldInclude?: (message: T) => boolean;
  readonly mergeExisting?: (current: T, incoming: T) => T;
}

export interface ChatReceiptStatusMap {
  readonly delivered: number;
  readonly read: number;
}

export interface ChatContentMessageLike {
  readonly ulid?: string;
  readonly content?: string;
}

export interface ChatTypingEntry {
  readonly typing: boolean;
  readonly lastUpdate: number;
}

export type ChatTypingPeers = Record<string, Record<string, ChatTypingEntry>>;

export interface ChatPresenceParticipant {
  readonly actorId?: string;
  readonly online: boolean;
}

export interface ChatNotificationLike {
  readonly id?: string;
  readonly status?: number;
  readonly category?: number | string;
}

export interface ChatNotificationMergeOptions<T extends ChatNotificationLike> {
  readonly resolveCreatedAt: (notification: T) => number;
  readonly limit?: number;
}

export interface ChatNotificationUnreadCountOptions<T extends ChatNotificationLike> {
  readonly notifications: readonly T[];
  readonly unreadStatus: number;
  readonly unreadTotal?: number;
}

export type ChatVisualSurface =
  | 'desktop-main'
  | 'desktop-thread'
  | 'mobile-main'
  | 'mobile-thread';

export interface ChatVisualLayoutContract {
  readonly surface: ChatVisualSurface;
  readonly avatarSize: number;
  readonly avatarGap: number;
  readonly avatarRadius: number;
  readonly ownRowMaxWidth: string;
  readonly peerRowMaxWidth: string;
  readonly groupPeerRowMaxWidth: string;
  readonly bubbleMinWidth: number;
  readonly bubblePadding: string;
  readonly ownBubbleRadius: string;
  readonly peerBubbleRadius: string;
  readonly mediaBubblePadding: string;
  readonly hoverActionBridgeHeight: number;
  readonly hoverActionBridgeInsetX: number;
  readonly composerOuterPadding: string;
  readonly composerShellRadius: number;
  readonly composerShellShadow: string;
  readonly composerInputMinHeight: number;
  readonly composerToolButtonSize: number;
  readonly composerHasAttachmentTools: boolean;
}

export interface ChatMessageRowVisualInput {
  readonly own: boolean;
  readonly groupPeer?: boolean;
}

export interface ChatParticipantUnreadLike {
  readonly ulid?: string;
  readonly participantADid?: string;
  readonly participantBDid?: string;
  readonly unreadCountA?: number;
  readonly unreadCountB?: number;
}

export type ChatE2eeStatus = 'unknown' | 'preparing' | 'ready' | 'blocked' | 'error';

export interface ChatE2eeProjectionEntry {
  readonly status: ChatE2eeStatus;
  readonly updatedAt: number;
  readonly error?: string;
}

export type ChatE2eeProjection = Record<string, ChatE2eeProjectionEntry>;

export type ChatOutboxScope = 'friend' | 'group';
export type ChatOutboxOperation = 'send-message' | 'edit-message' | 'recall-message' | 'delete-message' | 'ack-read';
export type ChatOutboxStatus = 'queued' | 'sending' | 'failed';

export interface ChatOutboxItem<Payload = unknown> {
  readonly localId: string;
  readonly scope: ChatOutboxScope;
  readonly conversationId: string;
  readonly operation: ChatOutboxOperation;
  readonly payload: Payload;
  readonly status: ChatOutboxStatus;
  readonly attempts: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly nextAttemptAt?: number;
  readonly error?: string;
}

export interface ChatOutboxDraft<Payload = unknown> {
  readonly localId: string;
  readonly scope: ChatOutboxScope;
  readonly conversationId: string;
  readonly operation: ChatOutboxOperation;
  readonly payload: Payload;
}

export interface ChatOutboxFailureOptions {
  readonly now?: number;
  readonly retryDelayMs?: number;
  readonly error?: string;
}

const COMPOSITION_END_ENTER_GUARD_MS = 120;
const IMAGE_ATTACHMENT_FILENAME_PATTERN = /\.(apng|avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i;
const VIDEO_ATTACHMENT_FILENAME_PATTERN = /\.(avi|m4v|mkv|mov|mp4|mpeg|mpg|webm)$/i;
const AUDIO_ATTACHMENT_FILENAME_PATTERN = /\.(aac|flac|m4a|mp3|ogg|opus|wav|webm)$/i;
const VISUAL_ATTACHMENT_FILENAME_PATTERN = /\.(apng|avif|bmp|gif|heic|heif|jpe?g|m4v|mov|mp4|png|webm|webp)$/i;
const DEFAULT_ENCRYPTED_PLACEHOLDER = '[Encrypted Message]';
const DEFAULT_MESSAGE_TIME_GROUP_GAP_MS = 10 * 60 * 1000;
export const CHAT_ENCRYPTED_MESSAGE_PAYLOAD_VERSION = 1;
const EMPTY_COMPOSER_CAPABILITIES: ResolvedChatComposerCapabilities = {
  emoji: false,
  file: false,
  screenshot: false,
  voice: false,
};

export const CHAT_COMPOSER_CAPABILITIES_DESKTOP_MAIN: ResolvedChatComposerCapabilities = {
  emoji: true,
  file: true,
  screenshot: true,
  voice: true,
};

export const CHAT_COMPOSER_CAPABILITIES_DESKTOP_THREAD: ResolvedChatComposerCapabilities = {
  ...CHAT_COMPOSER_CAPABILITIES_DESKTOP_MAIN,
  screenshot: false,
};

export const CHAT_COMPOSER_CAPABILITIES_MOBILE_MAIN: ResolvedChatComposerCapabilities = {
  ...EMPTY_COMPOSER_CAPABILITIES,
  emoji: true,
  file: true,
};

export const CHAT_COMPOSER_CAPABILITIES_MOBILE_THREAD: ResolvedChatComposerCapabilities = {
  ...CHAT_COMPOSER_CAPABILITIES_MOBILE_MAIN,
};

export const CHAT_VISUAL_LAYOUT_DESKTOP_MAIN: ChatVisualLayoutContract = {
  surface: 'desktop-main',
  avatarSize: 36,
  avatarGap: 8,
  avatarRadius: 10,
  ownRowMaxWidth: 'min(74%, 740px)',
  peerRowMaxWidth: 'min(74%, 740px)',
  groupPeerRowMaxWidth: 'min(82%, 800px)',
  bubbleMinWidth: 0,
  bubblePadding: '9px 13px',
  ownBubbleRadius: '16px 16px 6px 16px',
  peerBubbleRadius: '16px 16px 16px 6px',
  mediaBubblePadding: '0',
  hoverActionBridgeHeight: 18,
  hoverActionBridgeInsetX: 180,
  composerOuterPadding: '6px 6px 8px',
  composerShellRadius: 8,
  composerShellShadow: '0 12px 34px rgba(15, 23, 42, 0.10)',
  composerInputMinHeight: 82,
  composerToolButtonSize: 32,
  composerHasAttachmentTools: true,
};

export const CHAT_VISUAL_LAYOUT_DESKTOP_THREAD: ChatVisualLayoutContract = {
  ...CHAT_VISUAL_LAYOUT_DESKTOP_MAIN,
  surface: 'desktop-thread',
  avatarSize: 30,
  avatarGap: 7,
  avatarRadius: 9,
  ownRowMaxWidth: 'min(92%, 320px)',
  peerRowMaxWidth: 'min(92%, 320px)',
  groupPeerRowMaxWidth: 'min(92%, 320px)',
  bubblePadding: '8px 10px',
  ownBubbleRadius: '14px 14px 5px 14px',
  peerBubbleRadius: '14px 14px 14px 5px',
};

export const CHAT_VISUAL_LAYOUT_MOBILE_MAIN: ChatVisualLayoutContract = {
  surface: 'mobile-main',
  avatarSize: 38,
  avatarGap: 7,
  avatarRadius: 12,
  ownRowMaxWidth: '78%',
  peerRowMaxWidth: '78%',
  groupPeerRowMaxWidth: '78%',
  bubbleMinWidth: 56,
  bubblePadding: '7px 9px 5px',
  ownBubbleRadius: '17px 17px 5px 17px',
  peerBubbleRadius: '17px 17px 17px 5px',
  mediaBubblePadding: '0',
  hoverActionBridgeHeight: 0,
  hoverActionBridgeInsetX: 0,
  composerOuterPadding: '8px 10px 10px',
  composerShellRadius: 12,
  composerShellShadow: '0 -8px 26px rgba(15, 23, 42, 0.08)',
  composerInputMinHeight: 38,
  composerToolButtonSize: 40,
  composerHasAttachmentTools: false,
};

export const CHAT_VISUAL_LAYOUT_MOBILE_THREAD: ChatVisualLayoutContract = {
  ...CHAT_VISUAL_LAYOUT_MOBILE_MAIN,
  surface: 'mobile-thread',
};

export function shouldSendComposerEnter(state: ComposerEnterKeyState): boolean {
  if (state.key !== 'Enter') return false;
  if (state.shiftKey) return false;
  if (state.isComposing || state.nativeIsComposing) return false;
  if (
    state.lastCompositionEndAt &&
    ((state.now ?? Date.now()) - state.lastCompositionEndAt) < COMPOSITION_END_ENTER_GUARD_MS
  ) {
    return false;
  }
  return state.keyCode !== 229;
}

export function resolveChatComposerCapabilities(
  base: ChatComposerCapabilities = CHAT_COMPOSER_CAPABILITIES_DESKTOP_MAIN,
  override?: ChatComposerCapabilities,
): ResolvedChatComposerCapabilities {
  return {
    emoji: override?.emoji ?? base.emoji ?? EMPTY_COMPOSER_CAPABILITIES.emoji,
    file: override?.file ?? base.file ?? EMPTY_COMPOSER_CAPABILITIES.file,
    screenshot: override?.screenshot ?? base.screenshot ?? EMPTY_COMPOSER_CAPABILITIES.screenshot,
    voice: override?.voice ?? base.voice ?? EMPTY_COMPOSER_CAPABILITIES.voice,
  };
}

export function chatComposerAcceptsAttachments(capabilities: ChatComposerCapabilities): boolean {
  const resolved = resolveChatComposerCapabilities(EMPTY_COMPOSER_CAPABILITIES, capabilities);
  return resolved.file || resolved.screenshot || resolved.voice;
}

export function canSubmitChatComposerDraft({
  text,
  attachmentCount = 0,
  capabilities = CHAT_COMPOSER_CAPABILITIES_DESKTOP_MAIN,
}: ChatComposerDraftState): boolean {
  if ((text ?? '').trim()) return true;
  return attachmentCount > 0 && chatComposerAcceptsAttachments(capabilities);
}

export function chatVisualLayoutForSurface(surface: ChatVisualSurface): ChatVisualLayoutContract {
  switch (surface) {
    case 'desktop-main':
      return CHAT_VISUAL_LAYOUT_DESKTOP_MAIN;
    case 'desktop-thread':
      return CHAT_VISUAL_LAYOUT_DESKTOP_THREAD;
    case 'mobile-main':
      return CHAT_VISUAL_LAYOUT_MOBILE_MAIN;
    case 'mobile-thread':
      return CHAT_VISUAL_LAYOUT_MOBILE_THREAD;
  }
}

export function chatMessageRowMaxWidth(
  layout: ChatVisualLayoutContract,
  input: ChatMessageRowVisualInput,
): string {
  if (input.own) return layout.ownRowMaxWidth;
  return input.groupPeer ? layout.groupPeerRowMaxWidth : layout.peerRowMaxWidth;
}

export function chatVisualCssVars(layout: ChatVisualLayoutContract): Record<string, string> {
  return {
    '--chat-message-avatar-size': `${layout.avatarSize}px`,
    '--chat-message-avatar-gap': `${layout.avatarGap}px`,
    '--chat-message-avatar-radius': `${layout.avatarRadius}px`,
    '--chat-message-bubble-min-width': `${layout.bubbleMinWidth}px`,
    '--chat-message-bubble-max-width': layout.peerRowMaxWidth,
    '--chat-message-bubble-padding': layout.bubblePadding,
    '--chat-message-bubble-radius-peer': layout.peerBubbleRadius,
    '--chat-message-bubble-radius-own': layout.ownBubbleRadius,
    '--chat-message-media-padding': layout.mediaBubblePadding,
    '--chat-composer-outer-padding': layout.composerOuterPadding,
    '--chat-composer-radius': `${layout.composerShellRadius}px`,
    '--chat-composer-shadow': layout.composerShellShadow,
    '--chat-composer-input-min-height': `${layout.composerInputMinHeight}px`,
    '--chat-composer-tool-button-size': `${layout.composerToolButtonSize}px`,
  };
}

export function setChatE2eeProjectionStatus(
  projection: ChatE2eeProjection,
  key: string,
  status: ChatE2eeStatus,
  options: { now?: number; error?: string } = {},
): ChatE2eeProjection {
  const normalizedKey = key.trim();
  if (!normalizedKey) return projection;
  const now = options.now ?? Date.now();
  const previous = projection[normalizedKey];
  const next: ChatE2eeProjectionEntry = {
    status,
    updatedAt: now,
    ...(options.error ? { error: options.error } : {}),
  };
  if (
    previous?.status === next.status
    && previous.updatedAt === next.updatedAt
    && previous.error === next.error
  ) {
    return projection;
  }
  return { ...projection, [normalizedKey]: next };
}

export function clearChatE2eeProjectionStatus(
  projection: ChatE2eeProjection,
  key: string,
): ChatE2eeProjection {
  if (!(key in projection)) return projection;
  const { [key]: _removed, ...rest } = projection;
  return rest;
}

export function chatE2eeProjectionCanSend(
  projection: ChatE2eeProjection,
  key: string,
): boolean {
  return projection[key]?.status === 'ready';
}

export function chatE2eeProjectionError(
  projection: ChatE2eeProjection,
  key: string,
): string | undefined {
  return projection[key]?.error;
}

export function enqueueChatOutboxItem<Payload>(
  queue: readonly ChatOutboxItem<Payload>[],
  draft: ChatOutboxDraft<Payload>,
  now = Date.now(),
): ChatOutboxItem<Payload>[] {
  const existing = queue.find((item) => item.localId === draft.localId);
  if (existing) return queue.slice();
  return [
    ...queue,
    {
      ...draft,
      status: 'queued',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function markChatOutboxSending<Payload>(
  queue: readonly ChatOutboxItem<Payload>[],
  localId: string,
  now = Date.now(),
): ChatOutboxItem<Payload>[] {
  return queue.map((item) =>
    item.localId === localId
      ? {
          ...item,
          status: 'sending',
          attempts: item.attempts + 1,
          updatedAt: now,
          error: undefined,
          nextAttemptAt: undefined,
        }
      : item,
  );
}

export function completeChatOutboxItem<Payload>(
  queue: readonly ChatOutboxItem<Payload>[],
  localId: string,
): ChatOutboxItem<Payload>[] {
  return queue.filter((item) => item.localId !== localId);
}

export function failChatOutboxItem<Payload>(
  queue: readonly ChatOutboxItem<Payload>[],
  localId: string,
  options: ChatOutboxFailureOptions = {},
): ChatOutboxItem<Payload>[] {
  const now = options.now ?? Date.now();
  const retryDelayMs = options.retryDelayMs ?? 5000;
  return queue.map((item) =>
    item.localId === localId
      ? {
          ...item,
          status: 'failed',
          updatedAt: now,
          nextAttemptAt: now + retryDelayMs,
          ...(options.error ? { error: options.error } : {}),
        }
      : item,
  );
}

export function chatOutboxReadyToDrain<Payload>(
  queue: readonly ChatOutboxItem<Payload>[],
  now = Date.now(),
): ChatOutboxItem<Payload>[] {
  return queue.filter((item) =>
    item.status === 'queued'
    || (item.status === 'failed' && (item.nextAttemptAt ?? 0) <= now),
  );
}

export function normalizeSocialHostEventKind(
  eventName: string,
  rawKind?: string,
): SocialHostEventKind {
  if (rawKind === 'push' || eventName.endsWith(':push')) return 'push';
  if (rawKind === 'deep-link' || eventName.endsWith(':deep-link')) return 'deep-link';
  if (rawKind === 'notification-tap' || eventName.endsWith(':notification-tap')) return 'notification-tap';
  if (rawKind === 'network-online' || eventName.endsWith(':network-online')) return 'network-online';
  if (
    rawKind === 'app-resume'
    || rawKind === 'resume'
    || eventName.endsWith(':resume')
    || eventName.endsWith(':tray-open')
  ) {
    return 'app-resume';
  }
  return 'native-hint';
}

export function buildSocialHostEvent(
  eventName: string,
  payload: SocialHostEventPayloadLike | null | undefined,
): SocialHostEvent {
  return {
    kind: normalizeSocialHostEventKind(eventName, payload?.kind),
    target: payload?.target,
    sessionUlid: payload?.sessionUlid ?? payload?.session_ulid,
    notificationId: payload?.notificationId ?? payload?.notification_id,
    url: payload?.url,
    reason: payload?.reason,
  };
}

export function socialHostEventTargetsNotifications(event: SocialHostEvent): boolean {
  return Boolean(
    event.notificationId
    || event.target === 'notification'
    || event.kind === 'push'
    || event.kind === 'notification-tap',
  );
}

export function socialHostEventReconcileReason(event: SocialHostEvent): string {
  return [
    'host',
    event.kind,
    event.reason || event.target || event.sessionUlid || event.notificationId || 'event',
  ].join(':');
}

export function chatMessageTypeForMime(mimeType: string): number {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized.startsWith('image/')) return CHAT_MESSAGE_TYPE_IMAGE;
  if (normalized.startsWith('audio/')) return CHAT_MESSAGE_TYPE_AUDIO;
  if (normalized.startsWith('video/')) return CHAT_MESSAGE_TYPE_VIDEO;
  return CHAT_MESSAGE_TYPE_FILE;
}

export function chatMediaKindFromMimeFilename(mimeType = '', filename = ''): ChatMediaKind {
  const normalizedMime = mimeType.trim().toLowerCase();
  const normalizedFilename = filename.trim();
  if (normalizedMime.startsWith('image/') || IMAGE_ATTACHMENT_FILENAME_PATTERN.test(normalizedFilename)) {
    return 'image';
  }
  if (normalizedMime.startsWith('video/') || VIDEO_ATTACHMENT_FILENAME_PATTERN.test(normalizedFilename)) {
    return 'video';
  }
  if (normalizedMime.startsWith('audio/') || AUDIO_ATTACHMENT_FILENAME_PATTERN.test(normalizedFilename)) {
    return 'audio';
  }
  return 'file';
}

export function chatMediaKindForAttachment(attachment: ChatAttachmentLike): ChatMediaKind {
  return chatMediaKindFromMimeFilename(chatAttachmentMimeType(attachment), attachment.filename ?? '');
}

export function chatMessageTypeForAttachment(attachment: ChatAttachmentLike): number {
  switch (chatMediaKindForAttachment(attachment)) {
    case 'image':
      return CHAT_MESSAGE_TYPE_IMAGE;
    case 'video':
      return CHAT_MESSAGE_TYPE_VIDEO;
    case 'audio':
      return CHAT_MESSAGE_TYPE_AUDIO;
    case 'file':
      return CHAT_MESSAGE_TYPE_FILE;
  }
}

export function chatMessageTypeForAttachments(
  attachments: readonly ChatAttachmentLike[],
): number | undefined {
  const firstAttachment = attachments[0];
  return firstAttachment ? chatMessageTypeForAttachment(firstAttachment) : undefined;
}

export function buildChatEncryptedMessagePayload<Attachment extends ChatAttachmentLike = ChatAttachmentLike>({
  text = '',
  attachments = [],
  messageType,
}: Partial<ChatEncryptedMessagePayload<Attachment>> = {}): ChatEncryptedMessagePayload<Attachment> {
  const normalizedText = String(text ?? '');
  const normalizedMessageType = Number(messageType);
  return {
    text: normalizedText,
    attachments: attachments.filter(hasChatAttachmentIdentity),
    ...(Number.isFinite(normalizedMessageType) && normalizedMessageType > 0 ? { messageType: normalizedMessageType } : {}),
  };
}

export function encryptedChatTransportMessageType(): number {
  return CHAT_MESSAGE_TYPE_TEXT;
}

export function chatAttachmentMimeType(attachment: ChatAttachmentLike): string {
  return (attachment.mimeType ?? attachment.mime_type ?? '').trim();
}

export function normalizeChatAttachmentVisibility(
  value: string | undefined,
): ChatAttachmentVisibility | undefined {
  switch (value) {
    case 'public':
    case 'chat':
    case 'private':
      return value;
    default:
      return undefined;
  }
}

function hasChatAttachmentIdentity<Attachment extends ChatAttachmentLike>(attachment: Attachment): boolean {
  return Boolean((attachment.cid ?? '').trim() || (attachment.filename ?? '').trim());
}

export function isVisualChatAttachment(attachment: ChatAttachmentLike): boolean {
  const mimeType = chatAttachmentMimeType(attachment).toLowerCase();
  const filename = attachment.filename ?? '';
  return mimeType.startsWith('image/')
    || mimeType.startsWith('video/')
    || VISUAL_ATTACHMENT_FILENAME_PATTERN.test(filename);
}

export function isPreviewableChatAttachment(attachment: ChatAttachmentLike): boolean {
  const kind = chatMediaKindForAttachment(attachment);
  return kind === 'image' || kind === 'video' || kind === 'audio';
}

export function chatAttachmentSizeBytes(attachment: ChatAttachmentLike): number {
  const size = Number(attachment.size);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

export function formatChatAttachmentSize(size: number | string | bigint | undefined): string {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function isOwnChatMessage(
  message: ChatMessageLike,
  currentUserDid: string | null | undefined,
): boolean {
  return Boolean(currentUserDid && message.senderDid === currentUserDid);
}

export function messageReplyToUlid(message: ChatMessageLike): string {
  return message.replyToUlid ?? '';
}

export function messageThreadRootUlid(message: ChatMessageLike): string {
  return message.threadRootUlid || messageReplyToUlid(message);
}

export function isRecalledChatMessage(message: ChatMessageLike): boolean {
  return message.recalled === true;
}

export function isEncryptedChatPlaceholder(
  message: ChatMessageLike,
  placeholder = DEFAULT_ENCRYPTED_PLACEHOLDER,
): boolean {
  return (message.content ?? '') === placeholder;
}

export function chatMessageDisplayKind(input: ChatMessageDisplayInput): ChatMessageDisplayKind {
  if (input.recalled) return 'recalled';
  if (input.encrypted) return 'encrypted';
  return (input.content ?? '').trim() ? 'text' : 'empty';
}

export function chatMessageSearchText(message: ChatMessageLike, encrypted = false): string {
  if (message.recalled || encrypted) return '';
  return message.content ?? '';
}

export function filterChatMessagesBySearchText<T extends ChatMessageLike>(
  messages: readonly T[],
  query: string,
  resolveSearchText: (message: T) => string = chatMessageSearchText,
): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return messages.filter((message) => resolveSearchText(message).toLowerCase().includes(normalized));
}

export function canEditChatMessage(input: ChatMessageEditInput): boolean {
  return input.own && !input.recalled && !input.encrypted && Boolean(input.content?.trim());
}

export function chatMessageSenderDids(
  messages: readonly ChatMessageLike[],
  currentUserDid?: string | null,
): string[] {
  return Array.from(new Set(
    messages
      .map((message) => message.senderDid)
      .filter((did): did is string => Boolean(did && did !== currentUserDid)),
  ));
}

export function chatMessageCalendarDayKey(timestampMs: number): string {
  if (!timestampMs) return '';
  const date = new Date(timestampMs);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function buildChatMessageSurfaceItems<T extends ChatMessageLike>({
  messages,
  resolveTimestampMs,
  timeGroupGapMs = DEFAULT_MESSAGE_TIME_GROUP_GAP_MS,
}: ChatMessageSurfaceOptions<T>): ChatMessageSurfaceItem<T>[] {
  return messages.map((message, index) => {
    const previousMessage = messages[index - 1];
    const timestampMs = resolveTimestampMs(message);
    const previousTimestampMs = previousMessage ? resolveTimestampMs(previousMessage) : 0;
    const dayKey = chatMessageCalendarDayKey(timestampMs);
    const previousDayKey = chatMessageCalendarDayKey(previousTimestampMs);
    const sameDay = Boolean(dayKey && previousDayKey && dayKey === previousDayKey);

    return {
      kind: 'message',
      index,
      message,
      previousMessage,
      timestampMs,
      dayKey,
      showDateSeparator: Boolean(dayKey && dayKey !== previousDayKey),
      timelineGap: sameDay && timestampMs > 0 && previousTimestampMs > 0 && timestampMs - previousTimestampMs > timeGroupGapMs,
    };
  });
}

export function filterChatMessagesAfterClearedAt<T extends ChatMessageLike>(
  messages: readonly T[],
  clearedAt: number | null | undefined,
  resolveTimestampMs: (message: T) => number,
): T[] {
  if (!clearedAt) return [...messages];
  return messages.filter((message) => resolveTimestampMs(message) >= clearedAt);
}

export function countChatThreadReplies<T extends ChatMessageLike>(
  messages: readonly T[],
  rootUlid: string,
): number {
  if (!rootUlid) return 0;
  return messages.filter((message) => messageThreadRootUlid(message) === rootUlid).length;
}

export function mergeChatMessages<T extends ChatMessageLike>(
  messages: readonly T[],
  incoming: T,
  {
    resolveTimestampMs,
    shouldInclude,
    mergeExisting,
  }: ChatMergeMessagesOptions<T>,
): T[] {
  if (!incoming.ulid) return [...messages];
  if (shouldInclude && !shouldInclude(incoming)) return [...messages];

  const byUlid = new Map<string, T>();
  for (const message of messages) {
    if (message.ulid) byUlid.set(message.ulid, message);
  }

  const current = byUlid.get(incoming.ulid);
  byUlid.set(incoming.ulid, current && mergeExisting ? mergeExisting(current, incoming) : incoming);

  return [...byUlid.values()].sort((a, b) => {
    const timestampDelta = resolveTimestampMs(a) - resolveTimestampMs(b);
    if (timestampDelta !== 0) return timestampDelta;
    return (a.ulid ?? '').localeCompare(b.ulid ?? '');
  });
}

export function mergeUniqueChatMessages<T extends ChatMessageLike>(
  existing: readonly T[],
  incoming: readonly T[],
): T[] {
  const next: T[] = [];
  const seen = new Set<string>();
  for (const message of [...existing, ...incoming]) {
    if (!message.ulid || seen.has(message.ulid)) continue;
    next.push(message);
    seen.add(message.ulid);
  }
  return next;
}

export function resolveChatMessageReceiptStatus(
  kind: number | string,
  statuses: ChatReceiptStatusMap,
): number | null {
  if (kind === statuses.delivered || kind === 'DELIVERED') return statuses.delivered;
  if (kind === statuses.read || kind === 'READ') return statuses.read;
  return null;
}

export function applyChatMessageReceiptToList<T extends ChatStatusMessageLike>(
  messages: readonly T[] | undefined,
  messageUlid: string,
  nextStatus: number | null | undefined,
): T[] | null {
  if (!messages?.length || nextStatus == null) return null;

  let changed = false;
  const nextMessages = messages.map((message) => {
    if (message.ulid !== messageUlid || (message.status ?? 0) >= nextStatus) return message;
    changed = true;
    return { ...message, status: nextStatus } as T;
  });

  return changed ? nextMessages : null;
}

export function applyChatMessageMutationToList<T extends ChatMutableMessageLike>(
  messages: readonly T[] | undefined,
  messageUlid: string,
  mutation: ChatMessageMutationInput,
  options: ChatMessageMutationOptions = {},
): T[] | null {
  if (!messages?.length) return null;

  let changed = false;
  const emptyCiphertext = options.emptyCiphertext ?? (() => new Uint8Array());

  if (mutation.kind === 'DELETE') {
    const nextMessages = messages.filter((message) => {
      if (message.ulid !== messageUlid) return true;
      changed = true;
      return false;
    });
    return changed ? nextMessages : null;
  }

  const nextMessages = messages.map((message) => {
    if (message.ulid !== messageUlid) return message;
    if (options.canMutateMessage && !options.canMutateMessage(message)) return message;

    if (mutation.kind === 'RECALL') {
      if (message.recalled) return message;
      changed = true;
      return {
        ...message,
        recalled: true,
        content: '',
        encryptedPayload: emptyCiphertext(),
      } as T;
    }

    changed = true;
    const editedAtUnixMs = mutation.mutatedTsUnixMs ?? options.now?.() ?? Date.now();
    const editedAt = options.createEditedAt?.(editedAtUnixMs);
    return {
      ...message,
      content: mutation.newContent || message.content,
      encryptedPayload: mutation.newCiphertext?.byteLength
        ? mutation.newCiphertext
        : message.encryptedPayload ?? emptyCiphertext(),
      ...(editedAt === undefined ? {} : { editedAt }),
    } as T;
  });

  return changed ? nextMessages : null;
}

export function applyChatDecryptedContentToList<T extends ChatContentMessageLike>(
  messages: readonly T[] | undefined,
  messageUlid: string,
  plaintext: string,
): T[] | null {
  if (!messages?.length || !plaintext) return null;

  let changed = false;
  const nextMessages = messages.map((message) => {
    if (message.ulid !== messageUlid || message.content === plaintext) return message;
    changed = true;
    return { ...message, content: plaintext } as T;
  });

  return changed ? nextMessages : null;
}

export function applyChatTypingStateToMap<Peers extends ChatTypingPeers>(
  typingPeers: Peers,
  sessionUlid: string,
  fromActorId: string,
  typing: boolean,
  now = Date.now(),
): Peers | null {
  const sessionMap = typingPeers[sessionUlid] ?? {};
  const previous = sessionMap[fromActorId];
  if (!typing && !previous) return null;

  return {
    ...typingPeers,
    [sessionUlid]: {
      ...sessionMap,
      [fromActorId]: { typing, lastUpdate: now },
    },
  } as Peers;
}

export function pruneChatTypingPeers<Peers extends ChatTypingPeers>(
  typingPeers: Peers,
  staleBefore: number,
): Peers | null {
  let changed = false;
  const nextSessions: ChatTypingPeers = {};

  for (const [sessionUlid, byActor] of Object.entries(typingPeers)) {
    let sessionChanged = false;
    const nextActors: Record<string, ChatTypingEntry> = {};
    for (const [actorId, entry] of Object.entries(byActor)) {
      if (!entry.typing || entry.lastUpdate < staleBefore) {
        sessionChanged = true;
        continue;
      }
      nextActors[actorId] = entry;
    }
    if (sessionChanged) changed = true;
    if (Object.keys(nextActors).length > 0) {
      nextSessions[sessionUlid] = nextActors;
    } else if (Object.keys(byActor).length > 0) {
      changed = true;
    }
  }

  return changed ? nextSessions as Peers : null;
}

export function seedChatPresenceFromParticipants<T>(
  items: readonly T[],
  resolveParticipants: (item: T) => readonly ChatPresenceParticipant[],
): Record<string, boolean> {
  const presence: Record<string, boolean> = {};
  for (const item of items) {
    for (const participant of resolveParticipants(item)) {
      if (!participant.actorId) continue;
      if (presence[participant.actorId] !== undefined) continue;
      presence[participant.actorId] = participant.online;
    }
  }
  return presence;
}

export function applyChatPresenceToMap(
  presence: Record<string, boolean>,
  actorId: string,
  online: boolean,
): Record<string, boolean> | null {
  if (!actorId) return null;
  if (presence[actorId] === online) return null;
  return { ...presence, [actorId]: online };
}

export function mergeChatNotifications<T extends ChatNotificationLike>(
  current: readonly T[],
  incoming: readonly T[],
  {
    resolveCreatedAt,
    limit,
  }: ChatNotificationMergeOptions<T>,
): T[] {
  const byId = new Map<string, T>();
  for (const notification of [...current, ...incoming]) {
    if (!notification.id) continue;
    const existing = byId.get(notification.id);
    byId.set(notification.id, existing ? { ...existing, ...notification } as T : notification);
  }

  const merged = [...byId.values()].sort((a, b) => {
    const timestampDelta = resolveCreatedAt(b) - resolveCreatedAt(a);
    if (timestampDelta !== 0) return timestampDelta;
    return (b.id ?? '').localeCompare(a.id ?? '');
  });

  return limit ? merged.slice(0, limit) : merged;
}

export function filterUnreadChatNotifications<T extends ChatNotificationLike>(
  notifications: readonly T[],
  unreadStatus: number,
): T[] {
  return notifications.filter((notification) => notification.status === unreadStatus);
}

export function projectChatNotificationUnreadCount<T extends ChatNotificationLike>({
  notifications,
  unreadStatus,
  unreadTotal = 0,
}: ChatNotificationUnreadCountOptions<T>): number {
  return unreadTotal > 0 ? unreadTotal : filterUnreadChatNotifications(notifications, unreadStatus).length;
}

export function applyChatNotificationsRead<T extends ChatNotificationLike>(
  notifications: readonly T[],
  ids: readonly string[],
  readStatus: number,
  readAt: string,
): T[] {
  const targetIds = new Set(ids);
  if (targetIds.size === 0) return [...notifications];
  return notifications.map((notification) =>
    notification.id && targetIds.has(notification.id)
      ? { ...notification, status: readStatus, readAt } as T
      : notification,
  );
}

export function applyAllChatNotificationsRead<T extends ChatNotificationLike>(
  notifications: readonly T[],
  readStatus: number,
  readAt: string,
  category?: number | string,
): T[] {
  return notifications.map((notification) => {
    if (category !== undefined && notification.category !== category) return notification;
    return { ...notification, status: readStatus, readAt } as T;
  });
}

export function deleteChatNotifications<T extends ChatNotificationLike>(
  notifications: readonly T[],
  ids: readonly string[],
): T[] {
  const targetIds = new Set(ids);
  if (targetIds.size === 0) return [...notifications];
  return notifications.filter((notification) => !notification.id || !targetIds.has(notification.id));
}

export function sumChatUnreadCounters(counters: Record<string, number>): number {
  return Object.values(counters).reduce((sum, count) => sum + count, 0);
}

export function bumpChatUnreadCounter(
  counters: Record<string, number>,
  conversationId: string,
): Record<string, number> | null {
  if (!conversationId) return null;
  return {
    ...counters,
    [conversationId]: (counters[conversationId] ?? 0) + 1,
  };
}

export function clearChatUnreadCounter(
  counters: Record<string, number>,
  conversationId: string,
): Record<string, number> | null {
  if (!conversationId || !counters[conversationId]) return null;
  const { [conversationId]: _removed, ...rest } = counters;
  return rest;
}

export function chatUnreadForParticipant(
  session: ChatParticipantUnreadLike,
  viewerDid: string | null | undefined,
): number {
  const unreadA = session.unreadCountA ?? 0;
  const unreadB = session.unreadCountB ?? 0;
  if (!viewerDid) return Math.max(unreadA, unreadB);
  if (session.participantADid === viewerDid) return unreadA;
  if (session.participantBDid === viewerDid) return unreadB;
  return Math.max(unreadA, unreadB);
}

export function clearChatUnreadForParticipant<T extends ChatParticipantUnreadLike>(
  sessions: readonly T[],
  sessionUlid: string | null | undefined,
  viewerDid: string | null | undefined,
): T[] {
  if (!sessionUlid || !viewerDid) return [...sessions];
  return sessions.map((session) => {
    if (session.ulid !== sessionUlid) return session;
    if (session.participantADid === viewerDid) return { ...session, unreadCountA: 0 } as T;
    if (session.participantBDid === viewerDid) return { ...session, unreadCountB: 0 } as T;
    return session;
  });
}

export function chatConversationSuppressesAlerts(
  preference: Pick<ChatConversationPreferenceLike, 'muted' | 'alertEnabled'> | undefined,
): boolean {
  return Boolean(preference?.muted || preference?.alertEnabled === false);
}

export function visibleChatConversationUnread(
  unread: number,
  preference: Pick<ChatConversationPreferenceLike, 'muted' | 'alertEnabled'> | undefined,
): number {
  return chatConversationSuppressesAlerts(preference) ? 0 : unread;
}

export function buildChatConversationSurfaceItems<T>({
  conversations,
  query = '',
  resolvePreference,
  resolveSearchText,
  resolveUnread,
  resolveUpdatedAt,
}: ChatConversationSurfaceOptions<T>): ChatConversationSurfaceItem<T>[] {
  const normalizedQuery = query.trim().toLowerCase();

  return conversations
    .map((conversation, index) => {
      const preference = resolvePreference(conversation);
      const searchText = resolveSearchText(conversation);
      const unread = resolveUnread(conversation);
      return {
        kind: 'conversation' as const,
        conversation,
        index,
        preference,
        searchText,
        unread,
        updatedAt: resolveUpdatedAt(conversation),
        visibleUnread: visibleChatConversationUnread(unread, preference),
      };
    })
    .filter((item) => !normalizedQuery || item.searchText.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => {
      const stickyDelta = Number(Boolean(b.preference?.sticky)) - Number(Boolean(a.preference?.sticky));
      if (stickyDelta !== 0) return stickyDelta;
      return b.updatedAt - a.updatedAt;
    });
}

export function buildChatThreadSurface<T extends ChatMessageLike>({
  rootUlid,
  currentMessages,
  loadedThreadMessages,
}: ChatThreadSurfaceOptions<T>): ChatThreadSurface<T> {
  const loadedRoot = rootUlid
    ? loadedThreadMessages.find((message) => message.ulid === rootUlid) ?? null
    : null;
  const fallbackRoot = rootUlid
    ? currentMessages.find((message) => message.ulid === rootUlid) ?? null
    : null;
  const rootMessage = loadedRoot
    ?? fallbackRoot
    ?? loadedThreadMessages[0]
    ?? null;

  if (!rootMessage) {
    return {
      rootMessage: null,
      replies: [],
      displayMessages: [],
    };
  }

  const loadedReplies = loadedThreadMessages.filter((message) => message.ulid !== rootMessage.ulid);
  const replies = loadedReplies.length > 0
    ? loadedReplies
    : currentMessages.filter((message) =>
      message.ulid !== rootMessage.ulid && messageThreadRootUlid(message) === rootMessage.ulid,
    );

  return {
    rootMessage,
    replies,
    displayMessages: [rootMessage, ...replies],
  };
}

export function chatThreadReplyTargetUlid(
  rootMessage: ChatMessageLike | null | undefined,
  replyTarget?: ChatMessageLike | null,
): string {
  return replyTarget?.ulid || rootMessage?.ulid || '';
}

export function replyPreviewForChatMessage(
  message: ChatMessageLike | null | undefined,
  labels: ChatAttachmentPreviewLabels,
): string | undefined {
  if (!message) return undefined;
  const content = (message.content ?? '').trim();
  if (content) return content;
  const firstAttachment = message.attachments?.[0];
  if (!firstAttachment) return undefined;
  const mimeType = chatAttachmentMimeType(firstAttachment).toLowerCase();
  if (mimeType.startsWith('image/')) return labels.image;
  if (mimeType.startsWith('video/')) return labels.video;
  if (mimeType.startsWith('audio/')) return labels.audio;
  return firstAttachment.filename || labels.file;
}
