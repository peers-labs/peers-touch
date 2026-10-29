import { createMobileActorStorageRuntime } from '../storage/mobileClientStorage';
import {
  assertSessionWriteAdmission,
  readActiveSessionProjection,
  subscribeSessionRuntime,
  type MobileSessionProjection,
} from './sessionRuntime';

/** One identity/generation owner for every Mobile L2 preference operation. */
function createPersonalizationScope() {
  let session = readActiveSessionProjection();
  let generation = 0;
  let operations = Promise.resolve();
  let release: (() => void) | null = null;
  let retainCount = 0;
  const listeners = new Set<() => void>();
  const identity = (value: MobileSessionProjection | null) => value
    ? JSON.stringify([value.stationPeerId, value.actorPtid, value.sessionId, value.lifecycleGeneration])
    : null;
  const invalidate = () => {
    generation += 1;
    operations = Promise.resolve();
    listeners.forEach((listener) => listener());
  };
  const synchronize = () => {
    const next = readActiveSessionProjection();
    if (identity(next) === identity(session)) return;
    session = next;
    invalidate();
  };

  return {
    capture() {
      synchronize();
      const observed = generation;
      const captured = session;
      const current = () => {
        synchronize();
        return observed === generation;
      };
      const assertCurrent = () => {
        if (!current()) throw new Error('mobile.auth.sessionChanged');
      };
      const repository = captured ? createMobileActorStorageRuntime(
        captured.stationPeerId, captured.actorPtid,
      ).repositories.chatPreferences : null;
      return {
        current,
        authenticated: captured !== null,
        read: async (key: string) => {
          assertCurrent();
          const value = repository ? await repository.readValue(key) : null;
          assertCurrent();
          return value;
        },
        write: async (key: string, value: Record<string, unknown>) => {
          assertCurrent();
          if (!captured || !repository) throw new Error('mobile.auth.sessionRequired');
          const admitted = assertSessionWriteAdmission();
          if (identity(admitted) !== identity(captured)) throw new Error('mobile.auth.sessionChanged');
          await repository.write(key, value);
          assertCurrent();
        },
      };
    },
    enqueue<T>(operation: () => Promise<T>): Promise<T> {
      const result = operations.then(operation, operation);
      operations = result.then(() => undefined, () => undefined);
      return result;
    },
    retain() {
      synchronize();
      retainCount += 1;
      if (!release) release = subscribeSessionRuntime(synchronize);
      return () => {
        retainCount -= 1;
        if (retainCount !== 0) return;
        release?.();
        release = null;
        invalidate();
      };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export const mobilePersonalizationScope = createPersonalizationScope();
