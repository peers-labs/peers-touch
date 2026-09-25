/**
 * gatewayTypes.ts — Shared types for domain API gateways
 *
 * Provides the JSON quarantine boundary, command outcome adapters,
 * and readback contract for all domain gateways.
 */

import {
  fromJson,
  type DescMessage,
  type JsonValue,
  type MessageShape,
} from '@bufbuild/protobuf';

import type { MobileAuthSession } from '../../features/auth/authSession';
import { mobileAuthScopeKey } from '../../features/auth/mobileAuthIdentity';
import { SocialApiError, readableErrorMessage } from '../../features/social/socialTypes';
import type { StationErrorEnvelope, StationSuccessEnvelope } from '../../features/social/socialTypes';
import {
  MobileMutationAdmissionError,
  requireMobileMutationAdmission,
  type MobileMutationDomain,
} from '../../runtimes/mutationAdmission';
import {
  executeStationOperation,
  responseJson,
  type StationTransportOperation,
} from '../stationTransport';

// ---------------------------------------------------------------------------
// Gateway request infrastructure
// ---------------------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface GatewayRequestOptions {
  readonly method: HttpMethod;
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  readonly body?: Readonly<Record<string, unknown>>;
  readonly accept?: string;
}

/**
 * Command outcome: every gateway command returns a typed outcome
 * that distinguishes success from domain-level failure, keeping
 * callers free from try/catch boilerplate for expected error paths.
 */
export type CommandOutcome<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: GatewayError };

export interface GatewayError {
  readonly code: string;
  readonly message: string;
  readonly status?: number;
  readonly method: string;
  readonly path: string;
}

export interface ProtoJsonDecodeContext {
  readonly code: string;
  readonly message: string;
  readonly method: HttpMethod;
  readonly path: string;
}

/**
 * Readback adapter: after a successful command, some callers need to
 * refetch the resource to confirm server-side state.  This standardizes
 * the pattern across all gateways.
 */
export interface ReadbackAdapter<T> {
  /** Re-read the resource after a write to confirm server-side state. */
  readback: () => Promise<T>;
}

export type CommandWithReadback<T> = CommandOutcome<T> & {
  readonly readback?: ReadbackAdapter<T>;
};

export function decodeProtoJsonOutcome<Desc extends DescMessage>(
  outcome: CommandOutcome<JsonValue>,
  schema: Desc,
  context: ProtoJsonDecodeContext,
): CommandOutcome<MessageShape<Desc>> {
  if (!outcome.ok) return outcome;
  try {
    return { ok: true, data: fromJson(schema, outcome.data) };
  } catch {
    return {
      ok: false,
      error: {
        code: context.code,
        message: context.message,
        method: context.method,
        path: context.path,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// JSON quarantine: all JSON decode/normalize happens inside the gateway.
// The rest of the app sees typed domain objects.
// ---------------------------------------------------------------------------

/**
 * Creates the standard gateway request function scoped to a session.
 * This quarantines all JSON serialization and envelope unwrapping inside
 * the gateway layer.
 */
export function createGatewayTransport(
  session: MobileAuthSession,
  mutationDomain: MobileMutationDomain,
) {
  async function request<T>(options: GatewayRequestOptions): Promise<T> {
    if (options.method !== 'GET') {
      requireMobileMutationAdmission(
        mobileAuthScopeKey(session),
        mutationDomain,
      );
    }

    try {
      const response = await executeStationOperation(
        session,
        resolveGatewayOperation(options),
      );
      const payload = responseJson(response);
      if (response.status < 200 || response.status >= 300) {
        throw buildGatewayApiError(
          options.method,
          options.path,
          response.status,
          payload,
        );
      }
      return unwrapEnvelope<T>(payload);
    } catch (error) {
      if (error instanceof SocialApiError) throw error;
      throw new SocialApiError({
        method: options.method,
        path: options.path,
        message: readableErrorMessage(error),
      });
    }
  }

  /**
   * Execute a command and wrap the result in a CommandOutcome,
   * catching expected API errors as domain failures.
   */
  async function command<T>(options: GatewayRequestOptions): Promise<CommandOutcome<T>> {
    try {
      const data = await request<T>(options);
      return { ok: true, data };
    } catch (error) {
      if (error instanceof MobileMutationAdmissionError) {
        return {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            method: options.method,
            path: options.path,
          },
        };
      }
      if (error instanceof SocialApiError) {
        return {
          ok: false,
          error: {
            code: error.context.code ?? 'GATEWAY_ERROR',
            message: error.context.message,
            status: error.context.status,
            method: error.context.method,
            path: error.context.path,
          },
        };
      }
      return {
        ok: false,
        error: {
          code: 'GATEWAY_TRANSPORT_ERROR',
          message: readableErrorMessage(error),
          method: options.method,
          path: options.path,
        },
      };
    }
  }

  return { request, command };
}

// ---------------------------------------------------------------------------
// Internal helpers (JSON quarantine boundary)
// ---------------------------------------------------------------------------

function unwrapEnvelope<T>(payload: unknown): T {
  const envelope = payload as StationSuccessEnvelope<T>;
  if (envelope && typeof envelope === 'object' && 'data' in envelope) {
    return (envelope.data ?? {}) as T;
  }
  return (payload ?? {}) as T;
}

function resolveGatewayOperation(
  options: GatewayRequestOptions,
): StationTransportOperation {
  const query = options.query ?? {};
  const body = options.body ?? {};
  const exact = `${options.method} ${options.path}`;
  switch (exact) {
    case 'GET /actor/profile':
      return { operationId: 'actor_profile_get' };
    case 'POST /actor/profile':
      return {
        operationId: 'actor_profile_update',
        input: body as Extract<
          StationTransportOperation,
          { operationId: 'actor_profile_update' }
        >['input'],
      };
    case 'GET /api/v1/social/users/search':
      return {
        operationId: 'actor_search',
        query: requiredString(query.q, 'q'),
      };
    case 'GET /sub-federation/federations':
      return { operationId: 'federation_list' };
    case 'GET /actor/federation/resolve':
      return {
        operationId: 'federation_resolve',
        handle: requiredString(query.handle, 'handle'),
      };
    case 'GET /notification/list':
      return {
        operationId: 'notification_list',
        limit: requiredNumber(query.limit, 'limit'),
        cursor: optionalString(query.cursor),
      };
    case 'GET /notification/unread-counts':
      return { operationId: 'notification_unread_counts' };
    case 'POST /notification/mark-read':
      return {
        operationId: 'notification_mark_read',
        notification_ids: requiredStringList(body.notification_ids, 'notification_ids'),
      };
    case 'POST /notification/mark-all-read':
      return {
        operationId: 'notification_mark_all_read',
        category: requiredNumber(body.category, 'category'),
      };
    case 'POST /notification/delete':
      return {
        operationId: 'notification_delete',
        notification_ids: requiredStringList(body.notification_ids, 'notification_ids'),
      };
    case 'GET /notification/preferences':
      return { operationId: 'notification_preferences_get' };
    case 'POST /notification/preferences':
      return {
        operationId: 'notification_preferences_update',
        input: requireNotificationPreferences(body),
      };
    case 'GET /conversation/members':
      return {
        operationId: 'conversation_members_list',
        conversation_id: requiredString(query.conversation_id, 'conversation_id'),
      };
    case 'GET /conversation/member/settings':
      return {
        operationId: 'conversation_member_settings_get',
        conversation_id: requiredString(query.conversation_id, 'conversation_id'),
      };
    case 'PUT /conversation/member/settings':
      return {
        operationId: 'conversation_member_settings_update',
        input: requireConversationMemberSettings(body),
      };
    case 'GET /api/v1/social/friend-requests':
      return {
        operationId: 'social_friend_requests_list',
        state: requiredNumber(query.state, 'state'),
        limit: requiredNumber(query.limit, 'limit'),
        offset: requiredNumber(query.offset, 'offset'),
      };
    case 'GET /api/v1/social/relationships/blocked':
      return {
        operationId: 'social_blocked_list',
        limit: requiredNumber(query.limit, 'limit'),
        cursor: optionalString(query.cursor),
      };
    case 'GET /api/v1/social/relationships/status':
      return {
        operationId: 'social_friendship_status',
        target_ptid: requiredString(query.target_ptid, 'target_ptid'),
      };
    case 'GET /api/v1/social/timeline':
      return {
        operationId: 'moments_timeline',
        timeline_type: requiredNumber(query.type, 'type'),
        cursor: optionalString(query.cursor),
        limit: requiredNumber(query.limit, 'limit'),
      };
    default:
      return resolveParameterizedGatewayOperation(options);
  }
}

function resolveParameterizedGatewayOperation(
  options: GatewayRequestOptions,
): StationTransportOperation {
  const postAction = matchPath(
    options.path,
    /^\/api\/v1\/social\/posts\/([^/]+)\/(react|unreact)$/,
  );
  if (options.method === 'POST' && postAction) {
    return {
      operationId: postAction[2] === 'react' ? 'moments_react' : 'moments_unreact',
      post_id: decodePathValue(postAction[1]),
      reaction_kind: requiredNumber(options.body?.kind, 'kind'),
    };
  }
  const postComments = matchPath(
    options.path,
    /^\/api\/v1\/social\/posts\/([^/]+)\/comments$/,
  );
  if (postComments && options.method === 'GET') {
    return {
      operationId: 'moments_comments_list',
      post_id: decodePathValue(postComments[1]),
      cursor: optionalString(options.query?.cursor),
      limit: requiredNumber(options.query?.limit, 'limit'),
    };
  }
  if (postComments && options.method === 'POST') {
    return {
      operationId: 'moments_comment_create',
      post_id: decodePathValue(postComments[1]),
      content: requiredString(options.body?.content, 'content'),
      reply_to_comment_id: optionalString(options.body?.reply_to_comment_id),
    };
  }
  const post = matchPath(options.path, /^\/api\/v1\/social\/posts\/([^/]+)$/);
  if (post && options.method === 'GET') {
    return {
      operationId: 'moments_post_get',
      post_id: decodePathValue(post[1]),
    };
  }
  const comment = matchPath(
    options.path,
    /^\/api\/v1\/social\/comments\/([^/]+)$/,
  );
  if (comment && options.method === 'DELETE') {
    return {
      operationId: 'moments_comment_delete',
      comment_id: decodePathValue(comment[1]),
    };
  }
  const peerProfile = matchPath(
    options.path,
    /^\/actor\/actors\/([^/]+)\/profile$/,
  );
  if (peerProfile && options.method === 'GET') {
    return {
      operationId: 'actor_profile_get_peer',
      ptid: decodePathValue(peerProfile[1]),
    };
  }
  throw new Error(`mobile.stationTransport.operationUnsupported:${options.method}`);
}

function matchPath(path: string, pattern: RegExp): RegExpMatchArray | null {
  return path.match(pattern);
}

function decodePathValue(value: string): string {
  const decoded = decodeURIComponent(value).trim();
  if (!decoded) throw new Error('mobile.stationTransport.pathParameterInvalid');
  return decoded;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`mobile.stationTransport.${field}Invalid`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function requiredNumber(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`mobile.stationTransport.${field}Invalid`);
  }
  return number;
}

function requiredStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`mobile.stationTransport.${field}Invalid`);
  }
  return value;
}

function requireNotificationPreferences(body: Readonly<Record<string, unknown>>) {
  if (!Array.isArray(body.updates) || body.updates.length === 0) {
    throw new Error('mobile.stationTransport.preferenceUpdatesInvalid');
  }
  return {
    updates: body.updates.map((update) => {
      if (!update || typeof update !== 'object' || Array.isArray(update)) {
        throw new Error('mobile.stationTransport.preferenceUpdateInvalid');
      }
      const fields = update as Readonly<Record<string, unknown>>;
      return {
        category: requiredNumber(fields.category, 'category'),
        enabled: requiredBoolean(fields.enabled, 'enabled'),
        push_enabled: requiredBoolean(fields.push_enabled, 'push_enabled'),
        sound_enabled: requiredBoolean(fields.sound_enabled, 'sound_enabled'),
      };
    }),
    observed_revision: requiredRevisionString(
      body.observed_revision,
      'observed_revision',
    ),
  };
}

function requiredRevisionString(value: unknown, field: string): string {
  const encoded = typeof value === 'number' || typeof value === 'bigint'
    ? String(value)
    : value;
  if (typeof encoded !== 'string' || !/^[1-9]\d*$/.test(encoded)) {
    throw new Error(`mobile.stationTransport.${field}Invalid`);
  }
  const revision = BigInt(encoded);
  if (revision > 18_446_744_073_709_551_615n) {
    throw new Error(`mobile.stationTransport.${field}Invalid`);
  }
  return encoded;
}

function requireConversationMemberSettings(
  body: Readonly<Record<string, unknown>>,
) {
  const settings = body.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('mobile.stationTransport.settingsInvalid');
  }
  return {
    conversation_id: requiredString(body.conversation_id, 'conversation_id'),
    settings: settings as {
      nickname?: string;
      muted?: boolean;
      pinned?: boolean;
      alert_enabled?: boolean;
      background?: string;
      cleared_at_ms?: number;
    },
  };
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`mobile.stationTransport.${field}Invalid`);
  }
  return value;
}

function buildGatewayApiError(
  method: string,
  path: string,
  status: number,
  payload: unknown,
): SocialApiError {
  const envelope = (payload && typeof payload === 'object' ? payload : {}) as StationErrorEnvelope;
  const message = envelope.message ?? envelope.msg ?? envelope.detail ?? 'gateway_request_failed';
  return new SocialApiError({
    method,
    path,
    status,
    code: envelope.code ? String(envelope.code) : undefined,
    message: readableErrorMessage(message),
  });
}

/**
 * Unwrap a CommandOutcome, returning the data on success or throwing
 * a SocialApiError on failure.  Allows store actions to keep their
 * existing try/catch pattern while consuming gateway results.
 */
export function unwrapOutcome<T>(outcome: CommandOutcome<T>): T {
  if (!outcome.ok) {
    throw new SocialApiError({
      method: outcome.error.method,
      path: outcome.error.path,
      status: outcome.error.status,
      code: outcome.error.code,
      message: outcome.error.message,
    });
  }
  return outcome.data;
}
