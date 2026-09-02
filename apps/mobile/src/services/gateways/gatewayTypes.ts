/**
 * gatewayTypes.ts — Shared types for domain API gateways
 *
 * Provides the JSON quarantine boundary, command outcome adapters,
 * and readback contract for all domain gateways.
 */

import type { MobileAuthSession } from '../../features/auth/authSession';
import { SocialApiError, readableErrorMessage } from '../../features/social/socialTypes';
import type { StationErrorEnvelope, StationSuccessEnvelope } from '../../features/social/socialTypes';

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

// ---------------------------------------------------------------------------
// JSON quarantine: all JSON decode/normalize happens inside the gateway.
// The rest of the app sees typed domain objects.
// ---------------------------------------------------------------------------

/**
 * Creates the standard gateway request function scoped to a session.
 * This quarantines all JSON serialization and envelope unwrapping inside
 * the gateway layer.
 */
export function createGatewayTransport(session: MobileAuthSession) {
  const stationUrl = session.stationUrl.replace(/\/+$/, '');

  async function request<T>(options: GatewayRequestOptions): Promise<T> {
    const url = buildGatewayUrl(stationUrl, options.path, options.query);
    let response: Response;

    try {
      response = await fetch(url, {
        method: options.method,
        cache: 'no-store',
        headers: {
          Accept: options.accept ?? 'application/json',
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

    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw buildGatewayApiError(options.method, options.path, response.status, payload);
    }

    return unwrapEnvelope<T>(payload);
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

  return { request, command, stationUrl };
}

// ---------------------------------------------------------------------------
// Internal helpers (JSON quarantine boundary)
// ---------------------------------------------------------------------------

function buildGatewayUrl(
  baseUrl: string,
  path: string,
  query?: Readonly<Record<string, string | number | undefined>>,
): string {
  const url = new URL(path, `${baseUrl}/`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === '') return;
      url.searchParams.set(key, String(value));
    });
  }
  return url.toString();
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function unwrapEnvelope<T>(payload: unknown): T {
  const envelope = payload as StationSuccessEnvelope<T>;
  if (envelope && typeof envelope === 'object' && 'data' in envelope) {
    return (envelope.data ?? {}) as T;
  }
  return (payload ?? {}) as T;
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

/**
 * Convert a Uint8Array to base64 string.
 * Shared across gateways that send encrypted payloads.
 */
export function gatewayBytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return globalThis.btoa(binary);
}
