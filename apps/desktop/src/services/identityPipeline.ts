import { log } from '../utils/logger';

export type IdentityChangeReason = 'login' | 'logout' | 'switch' | 'unlock' | 'oauth_bridge';

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
    try {
      await fn(payload);
      const ms = Math.round(performance.now() - t0);
      log.info('identity', `identity pipeline handler ok: ${name}`, { ms, reason: payload.reason });
    } catch (error) {
      const ms = Math.round(performance.now() - t0);
      log.error('identity', `identity pipeline handler failed: ${name}`, { ms, reason: payload.reason, error: String(error) });
      failures.push({ handlerName: name, error, durationMs: ms });
    }
  }
  return {
    ok: failures.length === 0,
    failures,
  };
}
