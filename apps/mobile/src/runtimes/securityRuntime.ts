import { useSyncExternalStore } from 'react';
import type { MobileRuntimeDescriptor } from '../app/lifecycle/types';
import { lockNativePin, pinErrorKey, readNativePin, requestNativePinReset, unlockNativePin, type NativePinStatus } from '../services/nativePin';
import { mobileEntryActions } from './entryRuntime';

interface SecurityProjection {
  readonly status: NativePinStatus | null;
  readonly busy: boolean;
  readonly errorKey: string | null;
}
const listeners = new Set<() => void>();
let projection: SecurityProjection = { status: null, busy: false, errorKey: null };
let unblock: (() => void) | null = null;
let cancelWait: (() => void) | null = null;
let gateCancelled = false;
let generation = 0;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const read = () => projection;
const publish = (patch: Partial<SecurityProjection>) => {
  projection = { ...projection, ...patch };
  listeners.forEach((listener) => listener());
};
export const useSecurityProjection = () => useSyncExternalStore(subscribe, read, read);

async function reconcile(): Promise<void> {
  gateCancelled = false;
  const current = ++generation;
  try {
    const status = await readNativePin();
    if (current !== generation) return;
    publish({ status, errorKey: null });
  } catch (error) {
    if (current === generation) publish({ errorKey: pinErrorKey(error) });
    throw error;
  }
}

export async function submitPinUnlock(pin: string): Promise<void> {
  if (projection.busy || !projection.status?.locked) return;
  const current = generation;
  const scope = projection.status;
  publish({ busy: true, errorKey: null });
  try {
    const status = await unlockNativePin({
      stationPeerId: scope.stationPeerId, actorPtid: scope.actorPtid, currentPin: pin,
    });
    if (current !== generation) return;
    publish({ status });
    unblock?.();
    unblock = null;
    cancelWait = null;
  } catch (error) {
    if (current !== generation) return;
    publish({ errorKey: pinErrorKey(error) });
    try {
      const status = await readNativePin();
      if (current === generation) publish({ status });
    } catch { /* Preserve the actionable verification failure. */ }
  } finally {
    if (current === generation) publish({ busy: false });
  }
}

export async function reauthenticatePin(): Promise<void> {
  const scope = projection.status;
  if (!scope?.locked || projection.busy) return;
  publish({ busy: true, errorKey: null });
  try {
    await requestNativePinReset({ stationPeerId: scope.stationPeerId, actorPtid: scope.actorPtid });
    await mobileEntryActions.reAuthenticatePin(scope.stationPeerId);
  } catch (error) {
    publish({ errorKey: pinErrorKey(error) });
  } finally {
    publish({ busy: false });
  }
}

/** Locks last on suspend and unlocks before authenticated runtimes resume. */
export function createSecurityRuntimeDescriptor(): MobileRuntimeDescriptor {
  return {
    id: 'security', title: 'Native application lock',
    responsibility: 'Owns native PIN admission and its foreground verification projection.',
    dependsOn: ['secure-storage'],
    userGate: {
      async wait() {
        if (gateCancelled) throw new Error('mobile.security.cancelled');
        if (!projection.status?.locked) return;
        await new Promise<void>((resolve, reject) => {
          unblock = resolve;
          cancelWait = () => reject(new Error('mobile.security.cancelled'));
        });
      },
      cancel() {
        gateCancelled = true;
        cancelWait?.();
        cancelWait = null;
        unblock = null;
      },
    },
    bootstrap: reconcile,
    async suspend() {
      const status = await lockNativePin();
      publish({ status, errorKey: null });
    },
    resume: reconcile,
    async teardown() {
      generation++;
      unblock?.();
      unblock = null;
      cancelWait = null;
      publish({ status: null, busy: false, errorKey: null });
      return { runtimeId: 'security', success: true, durationMs: 0 };
    },
  };
}
