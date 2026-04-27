import { log } from '../utils/logger';

export type IdentityChangeReason = 'login' | 'logout' | 'switch' | 'unlock' | 'oauth_bridge';

export interface IdentityChangePayload {
  reason: IdentityChangeReason;
  /** `null` only for logout. */
  actorId: string | null;
  loginMethod: string | null;
}

const orderedHandlers: Array<{
  name: string;
  fn: (payload: IdentityChangePayload) => void | Promise<void>;
}> = [];

/** Register a callback that runs on every identity change, in registration order. */
export function registerIdentityHandler(
  name: string,
  fn: (payload: IdentityChangePayload) => void | Promise<void>,
): void {
  orderedHandlers.push({ name, fn });
}

/** Invoke the pipeline. Throws if any handler throws. */
export async function runIdentityPipeline(payload: IdentityChangePayload): Promise<void> {
  for (const { name, fn } of orderedHandlers) {
    const t0 = performance.now();
    try {
      await fn(payload);
      const ms = Math.round(performance.now() - t0);
      log.warn('identity', `identity pipeline handler ok: ${name}`, { ms, reason: payload.reason });
    } catch (error) {
      const ms = Math.round(performance.now() - t0);
      log.warn('identity', `identity pipeline handler failed: ${name}`, { ms, reason: payload.reason, error: String(error) });
      throw error;
    }
  }
}
