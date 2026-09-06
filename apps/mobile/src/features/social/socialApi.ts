import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { encryptClientMediaBlob, encryptClientMediaBlobChunked, type ClientEncryptedMediaAsset } from '@peers-touch/client-media-security';

import type { MobileAuthSession } from '../auth/authSession';
import { mobileAuthScope, mobileAuthScopeKey } from '../auth/mobileAuthIdentity';
import { FriendshipStatus as FriendshipStatusCode } from '../../gen/proto/domain/chat/chat_pb';
import {
  ConversationCommandSchema,
  TypingCommandSchema,
} from '../../gen/proto/domain/chat/conversation_pb';
import { FriendMessageType } from '../../gen/proto/domain/chat/friend_chat_pb';
import { EncryptedMediaDescriptorSchema } from '../../gen/proto/domain/common/common_pb';
import {
  Audience,
  CreateImagePostRequestSchema,
  CreatePostRequestSchema,
  CreatePostResponseSchema,
  CreateTextPostRequestSchema,
  ImageAttachmentSchema,
  PostType,
  type CreatePostRequest,
  type CreatePostResponse,
  type ImageAttachment,
  type Mention,
  type Post,
} from '../../gen/proto/domain/social/post_pb';
import {
  SocialApiError,
  readableErrorMessage,
  type ActorSearchResult,
  type FederationResolveView,
  type FriendChatMessage,
  type FriendChatSession,
  type FriendRequest,
  type FriendshipStatus,
  type PeerProfile,
  type SocialNotification,
  type StationErrorEnvelope,
  type StationSuccessEnvelope,
  type UnreadCounts,
} from './socialTypes';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface SocialRequestOptions {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: Record<string, unknown>;
}

export type ChatAttachmentInput = {
  cid: string;
  filename: string;
  mime_type: string;
  size: number;
  thumbnail_cid?: string;
  visibility?: string;
  encryption_suite?: string;
  encryption_key_b64?: string;
  encryption_nonce_b64?: string;
  plaintext_sha256_b64?: string;
  ciphertext_sha256_b64?: string;
  plaintext_size?: number;
  ciphertext_size?: number;
  chunking?: string;
  chunk_size?: number;
  chunk_count?: number;
  tag_size?: number;
  nonce_strategy?: string;
};

export interface UploadedChatAttachment {
  key?: string;
  cid: string;
  url?: string;
  size: number;
  mime?: string;
  filename: string;
}

interface UploadedOssAttachment {
  key?: string;
  cid?: string;
  url?: string;
  size?: number;
  mime?: string;
  filename?: string;
}

interface MobileMomentDraftBase {
  audience: Audience;
  mentions?: Mention[];
  replyToPostId?: string;
}

export interface MobileTextMomentDraft extends MobileMomentDraftBase {
  kind: 'text';
  text: string;
}

export interface MobileImageMomentDraft extends MobileMomentDraftBase {
  kind: 'image';
  text: string;
  imageIds: string[];
  images?: ImageAttachment[];
}

export type MobileMomentDraft = MobileTextMomentDraft | MobileImageMomentDraft;

interface ListFriendRequestsPayload {
  requests?: FriendRequest[];
  total?: number;
}

interface ListSessionsPayload {
  sessions?: FriendChatSession[];
  total?: number;
}

interface ListBlockedUsersPayload {
  blockedUsers?: Array<{ actorPtid?: string; actor_ptid?: string; status?: number }>;
  blocked_users?: Array<{ actorPtid?: string; actor_ptid?: string; status?: number }>;
  total?: number;
}

interface ListMessagesPayload {
  messages?: FriendChatMessage[];
  hasMore?: boolean;
  has_more?: boolean;
}

export interface FriendConversationSettings {
  sessionUlid: string;
  isMuted: boolean;
  isPinned: boolean;
  alertEnabled: boolean;
  background: ChatBackgroundId;
  clearedAt: number;
}

export interface UpdateFriendConversationSettingsInput {
  isMuted?: boolean;
  isPinned?: boolean;
  alertEnabled?: boolean;
  background?: ChatBackgroundId;
  clearedAt?: number;
}

export const CHAT_BACKGROUND_OPTIONS = ['default', 'paper', 'mint', 'dusk', 'calm', 'graphite'] as const;
export type ChatBackgroundId = (typeof CHAT_BACKGROUND_OPTIONS)[number];

interface ListNotificationsPayload {
  notifications?: SocialNotification[];
  nextCursor?: string;
  next_cursor?: string;
  totalCount?: number;
  total_count?: number;
  unreadCount?: number;
  unread_count?: number;
}

interface ActorSearchPayload {
  items?: ActorSearchResult[];
  total?: number;
}

export interface SocialApiClient {
  listFriendRequests: (status?: number, limit?: number, offset?: number) => Promise<ListFriendRequestsPayload>;
  acceptFriendRequest: (requestId: string) => Promise<{ request?: FriendRequest; session?: FriendChatSession }>;
  rejectFriendRequest: (requestId: string) => Promise<{ request?: FriendRequest }>;
  sendFriendRequest: (receiverPtid: string, message?: string) => Promise<{ request?: FriendRequest }>;
  listSessions: (limit?: number, offset?: number) => Promise<ListSessionsPayload>;
  createSession: (participantPtid: string) => Promise<{ session?: FriendChatSession; created?: boolean }>;
  getConversationSettings: (sessionUlid: string) => Promise<FriendConversationSettings>;
  updateConversationSettings: (sessionUlid: string, input: UpdateFriendConversationSettingsInput) => Promise<FriendConversationSettings>;
  blockUser: (targetPtid: string) => Promise<Record<string, unknown>>;
  unblockUser: (targetPtid: string) => Promise<Record<string, unknown>>;
  listBlockedUsers: (limit?: number, offset?: number) => Promise<FriendshipStatus[]>;
  getFriendshipStatus: (targetPtid: string) => Promise<FriendshipStatus>;
  listMessages: (sessionUlid: string, beforeUlid?: string, limit?: number) => Promise<ListMessagesPayload>;
  sendMessage: (sessionUlid: string, receiverPtid: string, content: string, attachments?: ChatAttachmentInput[], messageType?: number) => Promise<{ message?: FriendChatMessage }>;
  sendEncryptedMessage: (sessionUlid: string, receiverPtid: string, encryptedPayload: Uint8Array, messageType?: number) => Promise<{ message?: FriendChatMessage }>;
  sendSenderKeyDistribution: (sessionUlid: string, receiverPtid: string, encryptedPayload: Uint8Array) => Promise<{ message?: FriendChatMessage }>;
  editMessage: (sessionUlid: string, messageUlid: string, newEncryptedPayload: Uint8Array) => Promise<Record<string, unknown>>;
  recallMessage: (sessionUlid: string, messageUlid: string) => Promise<Record<string, unknown>>;
  deleteMessage: (sessionUlid: string, messageUlid: string) => Promise<Record<string, unknown>>;
  ackMessages: (ulids: string[], status: number) => Promise<Record<string, unknown>>;
  markMessageRead: (sessionUlid: string, lastReadUlid?: string) => Promise<Record<string, unknown>>;
  sendTypingState: (conversationId: string, typing: boolean) => Promise<Record<string, unknown>>;
  listNotifications: (limit?: number, cursor?: string) => Promise<ListNotificationsPayload>;
  getUnreadCounts: () => Promise<UnreadCounts>;
  markNotificationsRead: (notificationIds: string[]) => Promise<Record<string, unknown>>;
  markAllNotificationsRead: (category?: number) => Promise<Record<string, unknown>>;
  deleteNotifications: (notificationIds: string[]) => Promise<Record<string, unknown>>;
  searchActors: (query: string) => Promise<ActorSearchPayload>;
  getPeerProfile: (ptid: string) => Promise<PeerProfile>;
  resolveFederationHandle: (handle: string) => Promise<FederationResolveView>;
  createMoment: (draft: MobileMomentDraft) => Promise<Post | undefined>;
}

export function createSocialApiClient(session: MobileAuthSession): SocialApiClient {
  const stationUrl = session.stationUrl.replace(/\/+$/, '');

  async function request<T>(options: SocialRequestOptions): Promise<T> {
    const url = buildUrl(stationUrl, options.path, options.query);
    let response: Response;

    try {
      response = await fetch(url, {
        method: options.method,
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (error) {
      throw new SocialApiError({
        method: options.method,
        path: options.path,
        message: readableErrorMessage(error),
      });
    }

    const payload = await readJson(response);
    if (!response.ok) {
      throw buildApiError(options.method, options.path, response.status, payload);
    }

    return unwrapPayload<T>(payload);
  }

  async function createMoment(draft: MobileMomentDraft): Promise<Post | undefined> {
    const req = buildMobileCreatePostRequest(draft);
    let response: Response;

    try {
      response = await fetch(buildUrl(stationUrl, '/api/v1/social/moments'), {
        method: 'POST',
        cache: 'no-store',
        headers: {
          Accept: 'application/x-protobuf',
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/x-protobuf',
        },
        body: toBinary(CreatePostRequestSchema, req),
      });
    } catch (error) {
      throw new SocialApiError({
        method: 'POST',
        path: '/api/v1/social/moments',
        message: readableErrorMessage(error),
      });
    }

    if (!response.ok) {
      const payload = await readJson(response);
      throw buildApiError('POST', '/api/v1/social/moments', response.status, payload);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const created: CreatePostResponse = fromBinary(CreatePostResponseSchema, bytes);
    return created.post;
  }

  async function sendTypingState(
    conversationId: string,
    typing: boolean,
  ): Promise<Record<string, unknown>> {
    const senderPtid = mobileAuthScope(session).ptid;
    const deviceId = `mobile-web-${mobileAuthScopeKey(session)}`;
    if (!senderPtid || !conversationId.trim()) {
      throw new SocialApiError({
        method: 'POST',
        path: '/conversation/typing',
        message: 'authenticated actor and conversation are required',
      });
    }
    const command = create(ConversationCommandSchema, {
      conversationId,
      senderPtid,
      senderDeviceId: deviceId,
      payload: {
        case: 'typing',
        value: create(TypingCommandSchema, { isTyping: typing }),
      },
    });
    const response = await fetch(buildUrl(stationUrl, '/conversation/typing'), {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Accept: 'application/x-protobuf',
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/x-protobuf',
        'X-Device-ID': deviceId,
      },
      body: toBinary(ConversationCommandSchema, command),
    });
    if (!response.ok) {
      const payload = await readJson(response);
      throw buildApiError('POST', '/conversation/typing', response.status, payload);
    }
    return {};
  }

  return {
    listFriendRequests: (status = 0, limit = 50, offset = 0) =>
      request<ListFriendRequestsPayload>({
        method: 'GET',
        path: '/friend-chat/friend-requests',
        query: { status, limit, offset },
      }),
    acceptFriendRequest: (requestId) =>
      request({
        method: 'POST',
        path: '/friend-chat/friend-request/accept',
        body: { request_id: requestId },
      }),
    rejectFriendRequest: (requestId) =>
      request({
        method: 'POST',
        path: '/friend-chat/friend-request/reject',
        body: { request_id: requestId },
      }),
    sendFriendRequest: (receiverPtid, message = '') =>
      request({
        method: 'POST',
        path: '/friend-chat/friend-request/send',
        body: { receiver_ptid: receiverPtid, message },
      }),
    listSessions: (limit = 50, offset = 0) =>
      request<ListSessionsPayload>({
        method: 'GET',
        path: '/friend-chat/sessions',
        query: { limit, offset },
      }),
    createSession: (participantPtid) =>
      request({
        method: 'POST',
        path: '/friend-chat/session/create',
        body: { participant_ptid: participantPtid },
      }),
    getConversationSettings: (sessionUlid) =>
      request<{ settings?: unknown }>({
        method: 'GET',
        path: '/friend-chat/settings',
        query: { session_ulid: sessionUlid },
      }).then((payload) => normalizeFriendConversationSettings(payload.settings ?? payload)),
    updateConversationSettings: (sessionUlid, input) =>
      request<{ settings?: unknown }>({
        method: 'PUT',
        path: '/friend-chat/settings',
        body: {
          session_ulid: sessionUlid,
          ...(input.isMuted !== undefined ? { is_muted: input.isMuted } : {}),
          ...(input.isPinned !== undefined ? { is_pinned: input.isPinned } : {}),
          ...(input.alertEnabled !== undefined ? { alert_enabled: input.alertEnabled } : {}),
          ...(input.background !== undefined ? { background: input.background } : {}),
          ...(input.clearedAt !== undefined ? { cleared_at_unix_ms: input.clearedAt } : {}),
        },
      }).then((payload) => normalizeFriendConversationSettings(payload.settings ?? payload)),
    blockUser: (targetPtid) =>
      request({
        method: 'POST',
        path: '/friend-chat/block',
        body: { target_ptid: targetPtid },
      }),
    unblockUser: (targetPtid) =>
      request({
        method: 'DELETE',
        path: '/friend-chat/block',
        body: { target_ptid: targetPtid },
      }),
    listBlockedUsers: (limit = 100, offset = 0) =>
      request<ListBlockedUsersPayload>({
        method: 'GET',
        path: '/friend-chat/blocked',
        query: { limit, offset },
      }).then((payload) => {
        const blockedUsers = payload.blockedUsers ?? payload.blocked_users ?? [];
        return blockedUsers
          .map((item) => normalizeFriendshipStatus({ friend: item }))
          .filter((item) => item.targetPtid);
      }),
    getFriendshipStatus: (targetPtid) =>
      request<{ friend?: { actorPtid?: string; actor_ptid?: string; status?: number } }>({
        method: 'GET',
        path: '/friend-chat/friendship/status',
        query: { target_ptid: targetPtid },
      }).then((payload) => normalizeFriendshipStatus(payload, targetPtid)),
    listMessages: (sessionUlid, beforeUlid, limit = 50) =>
      request<ListMessagesPayload>({
        method: 'GET',
        path: '/friend-chat/messages',
        query: { session_ulid: sessionUlid, before_ulid: beforeUlid, limit },
      }),
    sendMessage: (sessionUlid, receiverPtid, content, attachments, messageType = 1) =>
      request({
        method: 'POST',
        path: '/friend-chat/message/send',
        body: {
          session_ulid: sessionUlid,
          receiver_ptid: receiverPtid,
          content,
          type: messageType,
          ...(attachments?.length ? { attachments } : {}),
        },
      }),
    sendEncryptedMessage: (sessionUlid, receiverPtid, encryptedPayload, messageType = 1) =>
      request({
        method: 'POST',
        path: '/friend-chat/message/send',
        body: {
          session_ulid: sessionUlid,
          receiver_ptid: receiverPtid,
          content: '',
          type: messageType,
          encrypted_payload: bytesToBase64(encryptedPayload),
        },
      }),
    sendSenderKeyDistribution: (sessionUlid, receiverPtid, encryptedPayload) =>
      request({
        method: 'POST',
        path: '/friend-chat/message/send',
        body: {
          session_ulid: sessionUlid,
          receiver_ptid: receiverPtid,
          content: '',
          type: FriendMessageType.SENDER_KEY_DISTRIBUTION,
          encrypted_payload: bytesToBase64(encryptedPayload),
        },
      }),
    editMessage: (sessionUlid, messageUlid, newEncryptedPayload) =>
      request({
        method: 'POST',
        path: '/friend-chat/message/edit',
        body: {
          session_ulid: sessionUlid,
          message_ulid: messageUlid,
          new_content: '',
          new_encrypted_payload: bytesToBase64(newEncryptedPayload),
        },
      }),
    recallMessage: (sessionUlid, messageUlid) =>
      request({
        method: 'POST',
        path: '/friend-chat/message/recall',
        body: { session_ulid: sessionUlid, message_ulid: messageUlid },
      }),
    deleteMessage: (sessionUlid, messageUlid) =>
      request({
        method: 'POST',
        path: '/friend-chat/message/delete',
        body: { session_ulid: sessionUlid, message_ulid: messageUlid },
      }),
    markMessageRead: (sessionUlid, lastReadUlid) =>
      request({
        method: 'POST',
        path: '/friend-chat/message/read',
        body: { session_ulid: sessionUlid, last_read_ulid: lastReadUlid },
      }),
    ackMessages: (ulids, status) =>
      request({
        method: 'POST',
        path: '/friend-chat/message/ack',
        body: { ulids, status },
      }),
    sendTypingState,
    listNotifications: (limit = 30, cursor) =>
      request<ListNotificationsPayload>({
        method: 'GET',
        path: '/notification/list',
        query: { limit, cursor },
      }),
    getUnreadCounts: () =>
      request<UnreadCounts>({
        method: 'GET',
        path: '/notification/unread-counts',
      }),
    markNotificationsRead: (notificationIds) =>
      request({
        method: 'POST',
        path: '/notification/mark-read',
        body: { notification_ids: notificationIds },
      }),
    markAllNotificationsRead: (category = 0) =>
      request({
        method: 'POST',
        path: '/notification/mark-all-read',
        body: { category },
      }),
    deleteNotifications: (notificationIds) =>
      request({
        method: 'POST',
        path: '/notification/delete',
        body: { notification_ids: notificationIds },
      }),
    searchActors: (query) =>
      request<ActorSearchPayload>({
        method: 'GET',
        path: '/api/v1/social/users/search',
        query: { q: query },
      }),
    getPeerProfile: (ptid) =>
      request<PeerProfile>({
        method: 'GET',
        path: `/actor/actors/${encodeURIComponent(ptid)}/profile`,
      }),
    resolveFederationHandle: (handle) =>
      request<FederationResolveView>({
        method: 'GET',
        path: '/actor/federation/resolve',
        query: { handle },
      }),
    createMoment,
  };
}

export function buildMobileCreatePostRequest(draft: MobileMomentDraft): CreatePostRequest {
  const base = {
    audience: draft.audience,
    ...(draft.mentions?.length ? { mentions: draft.mentions } : {}),
    ...(draft.replyToPostId ? { replyToPostId: draft.replyToPostId } : {}),
  };

  switch (draft.kind) {
    case 'text':
      return create(CreatePostRequestSchema, {
        ...base,
        type: PostType.TEXT,
        content: {
          case: 'text',
          value: create(CreateTextPostRequestSchema, { text: draft.text }),
        },
      });
    case 'image': {
      const typedImages = draft.images ?? [];
      return create(CreatePostRequestSchema, {
        ...base,
        type: PostType.IMAGE,
        content: {
          case: 'image',
          value: create(CreateImagePostRequestSchema, {
            text: draft.text,
            imageIds: typedImages.length > 0 ? [] : draft.imageIds,
            images: typedImages,
          }),
        },
      });
    }
  }
}

export async function uploadMobileChatAttachment(
  session: MobileAuthSession,
  file: File,
  conversationId: string,
): Promise<ChatAttachmentInput> {
  const encrypted = await encryptClientMediaBlob(file);
  const uploaded = await uploadMobileEncryptedAttachment(session, file, encrypted, {
    bucket: 'chat',
    visibility: 'chat',
    chatSessionId: conversationId,
  });

  return {
    cid: String(uploaded.cid ?? ''),
    filename: String(uploaded.filename ?? file.name),
    mime_type: String(uploaded.mime ?? file.type ?? 'application/octet-stream'),
    size: file.size,
    thumbnail_cid: '',
    visibility: 'chat',
    encryption_suite: encrypted.descriptor.suite,
    encryption_key_b64: encrypted.descriptor.keyB64,
    encryption_nonce_b64: encrypted.descriptor.nonceB64,
    plaintext_sha256_b64: encrypted.descriptor.plaintextSha256B64,
    ciphertext_sha256_b64: encrypted.descriptor.ciphertextSha256B64,
    plaintext_size: encrypted.descriptor.plaintextSize,
    ciphertext_size: Number(uploaded.size ?? encrypted.descriptor.ciphertextSize),
    chunking: encrypted.descriptor.chunking,
    chunk_size: encrypted.descriptor.chunkSize,
    chunk_count: encrypted.descriptor.chunkCount,
    tag_size: encrypted.descriptor.tagSize,
    nonce_strategy: encrypted.descriptor.nonceStrategy,
  };
}

export async function uploadMobileMomentImage(
  session: MobileAuthSession,
  file: File,
): Promise<ImageAttachment> {
  const encrypted = await encryptClientMediaBlobChunked(file);
  const uploaded = await uploadMobileEncryptedAttachment(session, file, encrypted, {
    bucket: 'moments',
    visibility: 'public',
  });

  const cid = String(uploaded.cid ?? uploaded.url ?? '');
  if (!cid) {
    throw new SocialApiError({
      method: 'POST',
      path: '/sub-oss/upload',
      message: 'upload returned no cid',
    });
  }

  return create(ImageAttachmentSchema, {
    id: cid,
    url: cid,
    sizeBytes: BigInt(encrypted.descriptor.plaintextSize),
    mediaEncryption: create(EncryptedMediaDescriptorSchema, {
      encrypted: encrypted.descriptor.encrypted,
      version: encrypted.descriptor.version,
      suite: encrypted.descriptor.suite,
      keyB64: encrypted.descriptor.keyB64,
      nonceB64: encrypted.descriptor.nonceB64,
      plaintextSha256B64: encrypted.descriptor.plaintextSha256B64,
      ciphertextSha256B64: encrypted.descriptor.ciphertextSha256B64,
      plaintextSize: BigInt(encrypted.descriptor.plaintextSize),
      ciphertextSize: BigInt(Number(uploaded.size ?? encrypted.descriptor.ciphertextSize)),
      chunking: encrypted.descriptor.chunking ?? '',
      chunkSize: encrypted.descriptor.chunkSize ?? 0,
      chunkCount: encrypted.descriptor.chunkCount ?? 0,
      tagSize: encrypted.descriptor.tagSize ?? 0,
      nonceStrategy: encrypted.descriptor.nonceStrategy ?? '',
    }),
  });
}

async function uploadMobileEncryptedAttachment(
  session: MobileAuthSession,
  file: File,
  encrypted: ClientEncryptedMediaAsset,
  scope: { bucket: string; visibility: string; chatSessionId?: string },
): Promise<UploadedOssAttachment> {
  const stationUrl = session.stationUrl.replace(/\/+$/, '');
  const encryptedFile = new File([encrypted.encryptedBlob], file.name, { type: 'application/octet-stream' });
  const form = new FormData();
  form.set('file', encryptedFile, file.name);
  form.set('bucket', scope.bucket);
  form.set('visibility', scope.visibility);
  if (scope.chatSessionId) form.set('chat_session_id', scope.chatSessionId);

  let response: Response;
  try {
    response = await fetch(`${stationUrl}/sub-oss/upload`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: form,
    });
  } catch (error) {
    throw new SocialApiError({
      method: 'POST',
      path: '/sub-oss/upload',
      message: readableErrorMessage(error),
    });
  }

  const payload = await readJson(response);
  if (!response.ok) {
    throw buildApiError('POST', '/sub-oss/upload', response.status, payload);
  }

  return payload as UploadedOssAttachment;
}

function normalizeFriendConversationSettings(payload: unknown): FriendConversationSettings {
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  return {
    sessionUlid: String(record.sessionUlid ?? record.session_ulid ?? ''),
    isMuted: Boolean(record.isMuted ?? record.is_muted),
    isPinned: Boolean(record.isPinned ?? record.is_pinned),
    alertEnabled: (record.alertEnabled ?? record.alert_enabled) !== false,
    background: normalizeChatBackgroundId(record.background),
    clearedAt: Number(record.clearedAtUnixMs ?? record.cleared_at_unix_ms ?? 0),
  };
}

export function normalizeChatBackgroundId(value: unknown): ChatBackgroundId {
  if (typeof value === 'string' && (CHAT_BACKGROUND_OPTIONS as readonly string[]).includes(value)) {
    return value as ChatBackgroundId;
  }
  return 'default';
}

function normalizeFriendshipStatus(
  payload: { friend?: { actorPtid?: string; actor_ptid?: string; status?: number } },
  fallbackTargetPtid = '',
): FriendshipStatus {
  const friend = payload.friend;
  return {
    targetPtid: String(friend?.actor_ptid ?? friend?.actorPtid ?? fallbackTargetPtid),
    blocked: Number(friend?.status ?? 0) === FriendshipStatusCode.BLOCKED,
  };
}

function buildUrl(stationUrl: string, path: string, query?: SocialRequestOptions['query']): string {
  const url = new URL(path, `${stationUrl}/`);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === '') return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function unwrapPayload<T>(payload: unknown): T {
  const envelope = payload as StationSuccessEnvelope<T>;
  if (envelope && typeof envelope === 'object' && 'data' in envelope) {
    return (envelope.data ?? {}) as T;
  }
  return (payload ?? {}) as T;
}

function buildApiError(method: HttpMethod, path: string, status: number, payload: unknown): SocialApiError {
  const envelope = payload as StationErrorEnvelope;
  const message = envelope?.message || envelope?.msg || envelope?.detail || envelope?.code || 'request_failed';
  return new SocialApiError({
    method,
    path,
    status,
    code: envelope?.code ? String(envelope.code) : undefined,
    message: readableErrorMessage(message),
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}
