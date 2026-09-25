import type {
  LifecycleKernelState,
  RuntimeLifecycleSnapshot,
} from './types';

/** Availability is derived; it never changes resource lifecycle ownership. */
export function readRuntimeAvailability(
  state: LifecycleKernelState,
  runtimeId: string,
): RuntimeLifecycleSnapshot | undefined {
  const entry = state.runtimes.get(runtimeId);
  if (!entry) return undefined;
  const result: RuntimeLifecycleSnapshot = {
    id: runtimeId,
    status: entry.status,
    errorKey: entry.lastError
      ? publicRuntimeErrorKey(entry.lastError)
      : null,
  };
  if (entry.status !== 'ready') return result;

  if (entry.readiness && entry.readiness.status !== 'ready') {
    return {
      id: runtimeId,
      status: entry.readiness.status === 'pending' ? 'bootstrapping' : 'failed',
      errorKey: entry.readiness.errorKey,
    };
  }
  for (const dependencyId of entry.descriptor.dependsOn) {
    const dependency = readRuntimeAvailability(state, dependencyId);
    if (!dependency || dependency.status !== 'ready') {
      return {
        id: runtimeId,
        status: dependency?.status === 'pending'
          || dependency?.status === 'bootstrapping'
          || dependency?.status === 'resuming'
          ? 'bootstrapping'
          : 'failed',
        errorKey: `mobile.lifecycle.dependencyFailed:${dependencyId}`,
      };
    }
  }
  return result;
}

export function publicRuntimeErrorKey(error: string): string {
  return error.startsWith('mobile.lifecycle.')
    ? error
    : 'mobile.lifecycle.runtimeFailed';
}
