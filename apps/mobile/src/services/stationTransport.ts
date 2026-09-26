import { invoke } from '@tauri-apps/api/core';

import type { MobileAuthSession } from '../features/auth/authSession';
import {
  assertSessionReadAdmission,
  assertSessionWriteAdmission,
  runAfterAuthenticated401,
  type SessionAdmission,
} from '../runtimes/sessionRuntime';

export type StationTransportOperation =
  | { operationId: 'actor_profile_get' }
  | {
    operationId: 'actor_profile_update';
    input: {
      display_name?: string;
      note?: string;
      avatar?: string;
      header?: string;
      region?: string;
      timezone?: string;
      default_visibility?: string;
      manually_approves_followers?: boolean;
      message_permission?: string;
      auto_expire_days?: number;
      discoverability?: string;
      observed_revision: string;
    };
  }
  | { operationId: 'actor_profile_get_peer'; ptid: string }
  | { operationId: 'actor_search'; query: string }
  | { operationId: 'federation_contexts_list' }
  | { operationId: 'federation_resolve'; federation_id: string; handle: string }
  | { operationId: 'federation_catalog_search'; federation_id: string; prefix: string; page_size: number }
  | { operationId: 'notification_list'; limit: number; cursor?: string }
  | { operationId: 'notification_unread_counts' }
  | { operationId: 'notification_mark_read'; notification_ids: string[] }
  | { operationId: 'notification_mark_all_read'; category: number }
  | { operationId: 'notification_delete'; notification_ids: string[] }
  | { operationId: 'notification_preferences_get' }
  | {
    operationId: 'notification_preferences_update';
    input: {
      updates: {
        category: number;
        enabled: boolean;
        push_enabled: boolean;
        sound_enabled: boolean;
      }[];
      observed_revision: string;
    };
  }
  | { operationId: 'conversation_members_list'; conversation_id: string }
  | { operationId: 'conversation_member_settings_get'; conversation_id: string }
  | {
    operationId: 'conversation_member_settings_update';
    input: {
      conversation_id: string;
      settings: {
        nickname?: string;
        muted?: boolean;
        pinned?: boolean;
        alert_enabled?: boolean;
        background?: string;
        cleared_at_ms?: number;
      };
    };
  }
  | {
    operationId: 'social_friend_requests_list';
    state: number;
    limit: number;
    offset: number;
  }
  | { operationId: 'social_blocked_list'; limit: number; cursor?: string }
  | { operationId: 'social_friendship_status'; target_ptid: string }
  | {
    operationId: 'moments_timeline';
    timeline_type: number;
    cursor?: string;
    limit: number;
  }
  | { operationId: 'moments_post_get'; post_id: string }
  | { operationId: 'moments_react'; post_id: string; reaction_kind: number }
  | { operationId: 'moments_unreact'; post_id: string; reaction_kind: number }
  | {
    operationId: 'moments_comments_list';
    post_id: string;
    cursor?: string;
    limit: number;
  }
  | {
    operationId: 'moments_comment_create';
    post_id: string;
    content: string;
    reply_to_comment_id?: string;
  }
  | { operationId: 'moments_comment_delete'; comment_id: string }
  | { operationId: 'moments_create'; body_bytes: number[] }
  | { operationId: 'oss_download'; key: string }
  | { operationId: 'presence_heartbeat'; reason: string }
  | { operationId: 'presence_offline'; reason: string }
  | {
    operationId: 'realtime_signal_send';
    recipient_ptid: string;
    session_ulid: string;
    kind: string;
    payload_b64: string;
    call_id: string;
    device_id: string;
  }
  | {
    operationId: 'realtime_call_resolution_get';
    call_id: string;
    peer_actor_ptid: string;
  }
  | { operationId: 'turn_ice_servers' };

export interface StationTransportResponse {
  readonly status: number;
  readonly contentType: string;
  readonly bodyBytes: number[];
}

export interface StationRealtimeHandle {
  readonly streamId: number;
}

export interface StationRealtimeEvent {
  readonly streamId: number;
  readonly kind: 'connected' | 'chunk' | 'closed' | 'error';
  readonly chunkBytes: number[];
}

export const MOBILE_STATION_REALTIME_EVENT = 'mobile:station-realtime';

export class StationTransportHttpError extends Error {
  readonly response: StationTransportResponse;

  constructor(response: StationTransportResponse) {
    super(`mobile.stationTransport.http.${response.status}`);
    this.name = 'StationTransportHttpError';
    this.response = response;
  }
}

export async function executeStationOperation(
  session: MobileAuthSession,
  operation: StationTransportOperation,
  signal?: AbortSignal,
): Promise<StationTransportResponse> {
  throwIfAborted(signal);
  const admission = operationAdmission(operation);
  const response = await runAfterAuthenticated401(
    async () => {
      throwIfAborted(signal);
      const active = requireCurrentSession(session, admission);
      const response = await invokeCancellable<StationTransportResponse>(
        'station_transport_execute',
        {
          stationPeerId: active.stationPeerId,
          actorPtid: active.actorPtid,
          sessionId: active.sessionId,
          operation,
        },
        signal,
      );
      if (response.status === 401) {
        throw new StationTransportHttpError(response);
      }
      return response;
    },
    (error) => error instanceof StationTransportHttpError
      && error.response.status === 401,
    admission,
  );
  throwIfAborted(signal);
  return response;
}

export async function startStationRealtime(
  session: MobileAuthSession,
  resumeCursor: string,
  signal?: AbortSignal,
): Promise<StationRealtimeHandle> {
  return runAfterAuthenticated401(
    async () => {
      const active = requireCurrentSession(session, 'read');
      return invokeCancellable<StationRealtimeHandle>(
        'station_realtime_start',
        {
          stationPeerId: active.stationPeerId,
          actorPtid: active.actorPtid,
          sessionId: active.sessionId,
          resumeCursor,
        },
        signal,
      );
    },
    isNativeAuthenticated401,
    'read',
  );
}

export function stopStationRealtime(streamId: number): Promise<void> {
  return invoke<void>('station_realtime_stop', { input: { streamId } });
}

export function responseBytes(response: StationTransportResponse): Uint8Array {
  return Uint8Array.from(response.bodyBytes);
}

export function responseArrayBuffer(
  response: StationTransportResponse,
): ArrayBuffer {
  const bytes = responseBytes(response);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export function responseText(response: StationTransportResponse): string {
  return new TextDecoder().decode(responseBytes(response));
}

export function responseJson(response: StationTransportResponse): unknown {
  const text = responseText(response);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function requireCurrentSession(
  session: MobileAuthSession,
  admission: SessionAdmission,
) {
  const active = admission === 'write'
    ? assertSessionWriteAdmission()
    : assertSessionReadAdmission();
  if (
    active.stationPeerId !== session.stationPeerId
    || active.actorPtid !== session.actorRef.ptid
    || active.deviceId !== session.deviceId
    || active.lifecycleGeneration !== session.lifecycleGeneration
  ) {
    throw new Error('mobile.stationTransport.sessionScopeMismatch');
  }
  return active;
}

async function invokeCancellable<T>(
  command: 'station_transport_execute' | 'station_realtime_start',
  input: Readonly<Record<string, unknown>>,
  signal: AbortSignal | undefined,
): Promise<T> {
  throwIfAborted(signal);
  const requestId = globalThis.crypto.randomUUID();
  const cancel = () => {
    void invoke<void>('station_transport_cancel', {
      input: { requestId },
    }).catch(() => undefined);
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await invoke<T>(command, {
      input: { requestId, ...input },
    });
    throwIfAborted(signal);
    return result;
  } catch (error) {
    if (signal?.aborted) {
      throw abortError();
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

function operationAdmission(
  operation: StationTransportOperation,
): SessionAdmission {
  switch (operation.operationId) {
    case 'actor_profile_get':
    case 'actor_profile_get_peer':
    case 'actor_search':
    case 'federation_contexts_list':
    case 'federation_resolve':
    case 'federation_catalog_search':
    case 'notification_list':
    case 'notification_unread_counts':
    case 'notification_preferences_get':
    case 'conversation_members_list':
    case 'conversation_member_settings_get':
    case 'social_friend_requests_list':
    case 'social_blocked_list':
    case 'social_friendship_status':
    case 'moments_timeline':
    case 'moments_post_get':
    case 'moments_comments_list':
    case 'oss_download':
    case 'realtime_call_resolution_get':
    case 'turn_ice_servers':
      return 'read';
    case 'actor_profile_update':
    case 'notification_mark_read':
    case 'notification_mark_all_read':
    case 'notification_delete':
    case 'notification_preferences_update':
    case 'conversation_member_settings_update':
    case 'moments_react':
    case 'moments_unreact':
    case 'moments_comment_create':
    case 'moments_comment_delete':
    case 'moments_create':
    case 'presence_heartbeat':
    case 'presence_offline':
    case 'realtime_signal_send':
      return 'write';
  }
  const exhaustive: never = operation;
  return exhaustive;
}

function isNativeAuthenticated401(error: unknown): boolean {
  const value = error as Partial<{ code: string; message: string }>;
  const text = `${value?.code ?? ''} ${value?.message ?? String(error)}`;
  return /MOBILE_STATION_TRANSPORT/.test(text)
    && /http_401|http\.401/.test(text);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw abortError();
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}
