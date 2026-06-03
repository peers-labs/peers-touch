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

export interface GroupApiClient {
  listGroups: (limit?: number, offset?: number) => Promise<ListGroupsPayload>;
  listMessages: (groupUlid: string, beforeUlid?: string, limit?: number) => Promise<ListGroupMessagesPayload>;
  listMembers: (groupUlid: string, limit?: number, offset?: number) => Promise<ListGroupMembersPayload>;
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
