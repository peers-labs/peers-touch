import { log } from '../utils/logger';

export type IdentityChangeReason =
  | 'login'
  | 'logout'
  | 'revoked'
  | 'switch'
  | 'unlock'
  | 'oauth_bridge';

export interface IdentityChangePayload {
  reason: IdentityChangeReason;
  /** `null` only for logout. */
  actorPtid: string | null;
  loginMethod: string | null;
}

export interface IdentityHandlerFailure {
  handlerName: string;
  error: unknown;
  durationMs: number;
}

export interface IdentityPipelineResult {
  ok: boolean;
  failures: ReadonlyArray<IdentityHandlerFailure>;
}

export class IdentityPipelineError extends Error {
  readonly failures: ReadonlyArray<IdentityHandlerFailure>;
  constructor(failures: IdentityHandlerFailure[]) {
    const names = failures.map((f) => f.handlerName).join(', ');
    super(`identity pipeline failed for handlers: ${names}`);
    this.name = 'IdentityPipelineError';
    this.failures = failures;
  }
}

const orderedHandlers: Array<{
  name: string;
  fn: (payload: IdentityChangePayload) => void | Promise<void>;
}> = [];

// #region debug-point F:foundation-cleanup-identity-pipeline
function reportFoundationCleanupIdentityHandler(
  stage: string,
  handlerName: string,
  durationMs?: number,
): void {
  if (typeof fetch !== 'function') return;
  void fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'as-f07-revision-flow',
      runId: 'pre-fix-logout',
      hypothesisId: 'F',
      location: 'identityPipeline.ts:runIdentityPipeline',
      msg: `[DEBUG] ${stage}`,
      data: {
        handlerName,
        ...(durationMs === undefined ? {} : { durationMs }),
      },
      ts: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

export function registerIdentityHandler(
  name: string,
  fn: (payload: IdentityChangePayload) => void | Promise<void>,
): void {
  orderedHandlers.push({ name, fn });
}

export async function runIdentityPipeline(payload: IdentityChangePayload): Promise<IdentityPipelineResult> {
  if (payload.reason !== 'logout' && !payload.actorPtid?.startsWith('ptid:')) {
    throw new IdentityPipelineError([{
      handlerName: 'validate-actor-ptid',
      error: new Error('identity change requires canonical actor PTID'),
      durationMs: 0,
    }]);
  }
  const failures: IdentityHandlerFailure[] = [];
  for (const { name, fn } of orderedHandlers) {
    const t0 = performance.now();
    // #region debug-point E-G:identity-handler-start
    void fetch('http://127.0.0.1:7781/event', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'foundation-login-readiness',
        runId: 'post-fix-2',
        hypothesisId: 'E-G',
        location: 'identityPipeline.ts:handler-start',
        msg: '[DEBUG] identity handler started',
        data: {
          handlerName: name,
          reason: payload.reason,
        },
        ts: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    if (payload.reason === 'logout') {
      reportFoundationCleanupIdentityHandler('handler-started', name);
    }
    try {
      await fn(payload);
      const ms = Math.round(performance.now() - t0);
      // #region debug-point E-G:identity-handler-finish
      void fetch('http://127.0.0.1:7781/event', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'foundation-login-readiness',
          runId: 'post-fix-2',
          hypothesisId: 'E-G',
          location: 'identityPipeline.ts:handler-finish',
          msg: '[DEBUG] identity handler finished',
          data: {
            handlerName: name,
            reason: payload.reason,
          },
          ts: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      if (payload.reason === 'logout') {
        reportFoundationCleanupIdentityHandler('handler-finished', name, ms);
      }
      log.info('identity', `identity pipeline handler ok: ${name}`, { ms, reason: payload.reason });
    } catch (error) {
      const ms = Math.round(performance.now() - t0);
      if (payload.reason === 'logout') {
        reportFoundationCleanupIdentityHandler('handler-failed', name, ms);
      }
      log.error('identity', `identity pipeline handler failed: ${name}`, { ms, reason: payload.reason, error: String(error) });
      failures.push({ handlerName: name, error, durationMs: ms });
    }
  }
  return {
    ok: failures.length === 0,
    failures,
  };
}
