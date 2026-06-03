import type { MobileAuthSession } from '../auth/authSession';
import type { SocialApiErrorContext, StationErrorEnvelope, StationSuccessEnvelope } from '../social/socialTypes';
import { SocialApiError } from '../social/socialTypes';
import type { Group, GroupMember, GroupMessage } from '../../gen/proto/domain/chat/group_chat_pb';

type HttpMethod = 'GET' | 'POST' | 'PUT';

interface GroupRequestOptions {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: Record<string, unknown>;
}

export interface ListGroupsPayload {
  groups?: Group[];
  total?: number;
}

export interface ListGroupMessagesPayload {
  messages?: GroupMessage[];
  hasMore?: boolean;
  has_more?: boolean;
  nextCursor?: string;
  next_cursor?: string;
}

export interface ListGroupMembersPayload {
  members?: GroupMember[];
  total?: number;
}

export interface GroupUnreadCountPayload {
  unreadCount?: number;
  unread_count?: number;
}

export interface CreateGroupInput {
  name: string;
  description?: string;
  initialMemberDids: string[];
}

export interface UpdateGroupInput {
  name?: string;
  description?: string;
  muted?: boolean;
}

export interface GroupSettings {
  isMuted: boolean;
  isPinned: boolean;
  myNickname: string;
  showMemberNickname: boolean;
}

export interface UpdateGroupSettingsInput {
  isMuted?: boolean;
  isPinned?: boolean;
  showMemberNickname?: boolean;
}

export interface GroupApiClient {
  createGroup: (input: CreateGroupInput) => Promise<{ group?: Group }>;
  updateGroup: (groupUlid: string, input: UpdateGroupInput) => Promise<{ group?: Group }>;
  listGroups: (limit?: number, offset?: number) => Promise<ListGroupsPayload>;
  listMessages: (groupUlid: string, beforeUlid?: string, limit?: number) => Promise<ListGroupMessagesPayload>;
  listMembers: (groupUlid: string, limit?: number, offset?: number) => Promise<ListGroupMembersPayload>;
  inviteMembers: (groupUlid: string, inviteeDids: string[]) => Promise<Record<string, unknown>>;
  leaveGroup: (groupUlid: string) => Promise<Record<string, unknown>>;
  removeMember: (groupUlid: string, actorDid: string) => Promise<Record<string, unknown>>;
  sendMessage: (groupUlid: string, encryptedPayload: Uint8Array) => Promise<{ message?: GroupMessage }>;
  editMessage: (groupUlid: string, messageUlid: string, encryptedPayload: Uint8Array) => Promise<Record<string, unknown>>;
  recallMessage: (groupUlid: string, messageUlid: string) => Promise<Record<string, unknown>>;
  deleteMessage: (groupUlid: string, messageUlid: string) => Promise<Record<string, unknown>>;
  getMySettings: (groupUlid: string) => Promise<GroupSettings>;
  updateMySettings: (groupUlid: string, input: UpdateGroupSettingsInput) => Promise<Record<string, unknown>>;
  unreadCount: (groupUlid: string) => Promise<GroupUnreadCountPayload>;
  markRead: (groupUlid: string, upToUlid?: string) => Promise<Record<string, unknown>>;
}

export function createGroupApiClient(session: MobileAuthSession): GroupApiClient {
  const stationUrl = session.stationUrl.replace(/\/+$/, '');

  async function request<T>(options: GroupRequestOptions): Promise<T> {
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
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const payload = await readJson(response);
    if (!response.ok) {
      throw buildApiError(options.method, options.path, response.status, payload);
    }

    return unwrapPayload<T>(payload);
  }

  return {
    createGroup: (input) =>
      request({
        method: 'POST',
        path: '/group-chat/create',
        body: {
          name: input.name,
          description: input.description ?? '',
          type: 1,
          visibility: 2,
          initial_member_dids: input.initialMemberDids,
        },
      }),
    updateGroup: (groupUlid, input) =>
      request({
        method: 'PUT',
        path: '/group-chat/update',
        body: {
          group_ulid: groupUlid,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.muted !== undefined ? { muted: input.muted } : {}),
        },
      }),
    listGroups: (limit = 50, offset = 0) =>
      request<ListGroupsPayload>({
        method: 'GET',
        path: '/group-chat/list',
        query: { limit, offset },
      }),
    listMessages: (groupUlid, beforeUlid, limit = 50) =>
      request<ListGroupMessagesPayload>({
        method: 'GET',
        path: '/group-chat/messages',
        query: { group_ulid: groupUlid, before_ulid: beforeUlid, limit },
      }),
    listMembers: (groupUlid, limit = 100, offset = 0) =>
      request<ListGroupMembersPayload>({
        method: 'GET',
        path: '/group-chat/members',
        query: { group_ulid: groupUlid, limit, offset },
      }),
    inviteMembers: (groupUlid, inviteeDids) =>
      request({
        method: 'POST',
        path: '/group-chat/invite',
        body: { group_ulid: groupUlid, invitee_dids: inviteeDids },
      }),
    leaveGroup: (groupUlid) =>
      request({
        method: 'POST',
        path: '/group-chat/leave',
        body: { group_ulid: groupUlid },
      }),
    removeMember: (groupUlid, actorDid) =>
      request({
        method: 'POST',
        path: '/group-chat/member/remove',
        body: { group_ulid: groupUlid, actor_did: actorDid },
      }),
    sendMessage: (groupUlid, encryptedPayload) =>
      request({
        method: 'POST',
        path: '/group-chat/message/send',
        body: {
          group_ulid: groupUlid,
          content: '',
          type: 1,
          encrypted_payload: bytesToBase64(encryptedPayload),
        },
      }),
    editMessage: (groupUlid, messageUlid, encryptedPayload) =>
      request({
        method: 'POST',
        path: '/group-chat/message/edit',
        body: {
          group_ulid: groupUlid,
          message_ulid: messageUlid,
          new_content: '',
          new_encrypted_payload: bytesToBase64(encryptedPayload),
        },
      }),
    recallMessage: (groupUlid, messageUlid) =>
      request({
        method: 'POST',
        path: '/group-chat/message/recall',
        body: { group_ulid: groupUlid, message_ulid: messageUlid },
      }),
    deleteMessage: (groupUlid, messageUlid) =>
      request({
        method: 'POST',
        path: '/group-chat/message/delete',
        body: { group_ulid: groupUlid, message_ulid: messageUlid },
      }),
    getMySettings: (groupUlid) =>
      request<GroupSettings>({
        method: 'GET',
        path: '/group-chat/my-settings',
        query: { group_ulid: groupUlid },
      }).then(normalizeSettings),
    updateMySettings: (groupUlid, input) =>
      request({
        method: 'PUT',
        path: '/group-chat/my-settings',
        body: {
          group_ulid: groupUlid,
          ...(input.isMuted !== undefined ? { is_muted: input.isMuted } : {}),
          ...(input.isPinned !== undefined ? { is_pinned: input.isPinned } : {}),
          ...(input.showMemberNickname !== undefined ? { show_member_nickname: input.showMemberNickname } : {}),
        },
      }),
    unreadCount: (groupUlid) =>
      request<GroupUnreadCountPayload>({
        method: 'GET',
        path: '/group-chat/unread-count',
        query: { group_ulid: groupUlid },
      }),
    markRead: (groupUlid, upToUlid) =>
      request({
        method: 'POST',
        path: '/group-chat/mark-read',
        body: { group_ulid: groupUlid, up_to_ulid: upToUlid },
      }),
  };
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(path, `${baseUrl}/`);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
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
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return ((payload as StationSuccessEnvelope<T>).data ?? {}) as T;
  }
  return payload as T;
}

function buildApiError(method: string, path: string, status: number, payload: unknown): SocialApiError {
  const envelope = (payload && typeof payload === 'object' ? payload : {}) as StationErrorEnvelope;
  const context: SocialApiErrorContext = {
    method,
    path,
    status,
    code: envelope.code,
    message: envelope.msg ?? envelope.message ?? envelope.detail ?? 'group api request failed',
  };
  return new SocialApiError(context);
}

function normalizeSettings(payload: unknown): GroupSettings {
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  return {
    isMuted: Boolean(record.isMuted ?? record.is_muted),
    isPinned: Boolean(record.isPinned ?? record.is_pinned),
    myNickname: String(record.myNickname ?? record.my_nickname ?? ''),
    showMemberNickname: Boolean(record.showMemberNickname ?? record.show_member_nickname),
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}
