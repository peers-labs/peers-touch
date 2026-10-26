import type { MobileRuntimeDescriptor } from '../app/lifecycle/types';
import { getMobileLifecycleKernel } from '../app/lifecycle/MobileLifecycleKernel';
import { isAccessGranted, startStationAccessAttempt } from '../features/auth/authSession';
import { useDeviceLinkStore } from '../features/auth/deviceLinkStore';
import { DeviceLinkState } from '../gen/proto/domain/auth/device_link_pb';
import { addStationRoute } from '../features/station/stationRegistry';
import {
  cancelDeviceLink,
  readDeviceLink,
  scanDeviceLink,
  submitDeviceLink,
  type DeviceLinkProjection,
} from '../services/deviceLink';
import type { NativeAccessSubmitInput } from '../services/mobileCommands';
import { updateStationRegistryProjection } from './stationRuntime';
import { applyAccessGateRuntimeResult } from './accessRuntime';
import { activateNativeSessionRuntime } from './sessionRuntime';
import { activeStationEntry } from '../features/station/stationRegistry';

let epoch = 0;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let emptyRetries = 0;

export function hasPendingDeviceLink(): boolean {
  const { phase } = useDeviceLinkStore.getState();
  return phase === 'scanning' || phase === 'linking' || phase === 'cancelling'
    || (phase === 'failed' && (!useDeviceLinkStore.getState().projection
      || useDeviceLinkStore.getState().projection!.state < DeviceLinkState.DENIED));
}

function stopTimer() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function schedule() {
  stopTimer();
  if (!running || !hasPendingDeviceLink()) return;
  if (useDeviceLinkStore.getState().errorKey === 'mobile.deviceLink.comparisonChanged') return;
  if (!useDeviceLinkStore.getState().projection && emptyRetries >= 8) return;
  timer = setTimeout(() => void refreshMobileDeviceLink(), 2_500);
}

function errorKey(error: unknown): string {
  const message = typeof error === 'object' && error && 'message' in error
    ? String(error.message) : '';
  const code = /deviceLink\.([A-Za-z]+)/.exec(message)?.[1];
  switch (code) {
    case 'cameraDenied': return 'mobile.deviceLink.cameraDenied';
    case 'nativeCameraRequired':
    case 'cameraUnavailable': return 'mobile.deviceLink.cameraUnavailable';
    case 'scanCancelled':
    case 'cancelled': return 'mobile.deviceLink.scanCancelled';
    case 'comparisonChanged': return 'mobile.deviceLink.comparisonChanged';
    case 'invalidQr':
    case 'offerExpired': return 'mobile.deviceLink.invalidQr';
    case 'sessionScopeChanged': return 'mobile.deviceLink.scopeChanged';
    default: return 'mobile.deviceLink.retry';
  }
}

async function apply(projection: DeviceLinkProjection, observed: number) {
  if (observed !== epoch) return;
  if (projection.phase === 'committed') {
    if (!projection.route || !projection.session
      || projection.session.stationPeerId !== projection.stationPeerId
      || projection.session.actorPtid !== projection.actorPtid
      || projection.session.deviceId !== projection.deviceId
      || projection.route.stationPeerId !== projection.stationPeerId
      || !projection.routeRevision) {
      throw new Error('deviceLink.sessionScopeChanged');
    }
    const registry = await updateStationRegistryProjection((current) => {
      if (observed !== epoch) return current;
      const next = addStationRoute(current, {
        identity: { stationPeerId: projection.stationPeerId, url: projection.stationOrigin },
        stationRootPublicKey: projection.route!.stationRootPublicKey,
        route: projection.route!,
      }, { online: true });
      if (!next.ok) throw new Error('deviceLink.sessionScopeChanged');
      return {
        ...next.registry,
        entries: next.registry.entries.map((entry) => entry.stationPeerId !== projection.stationPeerId
          ? entry : { ...entry, routeRevision: projection.routeRevision }),
      };
    });
    if (observed !== epoch) return;
    const station = activeStationEntry(registry);
    if (!station || station.stationPeerId !== projection.stationPeerId) {
      throw new Error('deviceLink.sessionScopeChanged');
    }
    // COMMITTED deliberately contains no pending Access decision. Revalidate
    // the canonical Session through the ordinary Access owner, including any
    // policy change since delivery; an earlier grant cannot admit the Session.
    const decision = await startStationAccessAttempt(
      station.stationPeerId, station.url, projection.session.sessionId,
    );
    if (observed !== epoch) return;
    if (isAccessGranted(decision)) {
      await activateNativeSessionRuntime(station, decision);
      if (observed !== epoch) return;
    }
    applyAccessGateRuntimeResult(decision);
    const kernel = getMobileLifecycleKernel();
    if (kernel.getState().phase === 'ACTIVE') {
      // The kernel may already be tearing down this owner. Never wait on its
      // queue from work that teardown itself must drain.
      void kernel.reconcileLaunchState(
        isAccessGranted(decision) ? 'access-granted' : 'reliability-recovery',
      ).catch(() => {
        if (observed === epoch) useDeviceLinkStore.setState({ errorKey: 'mobile.deviceLink.retry' });
      });
    }
  }
  emptyRetries = 0;
  const terminal = projection.state >= DeviceLinkState.DENIED;
  useDeviceLinkStore.setState({
    projection: projection.phase === 'idle' ? null : projection,
    phase: terminal ? 'failed' : projection.phase,
    errorKey: terminal ? 'mobile.deviceLink.ended' : null,
  });
}

function operate(action: () => Promise<DeviceLinkProjection>): Promise<void> {
  if (inFlight) return inFlight;
  const observed = epoch;
  stopTimer();
  useDeviceLinkStore.setState({ busy: true, errorKey: null });
  const operation = (async () => {
    try {
      await apply(await action(), observed);
    } catch (error) {
      if (observed === epoch) {
        emptyRetries += 1;
        const current = useDeviceLinkStore.getState();
        useDeviceLinkStore.setState({
          phase: current.phase === 'scanning' ? 'failed' : current.phase,
          errorKey: current.phase === 'idle' ? null : errorKey(error),
        });
      }
    } finally {
      if (observed === epoch) useDeviceLinkStore.setState({ busy: false });
    }
  })();
  const pending = operation.finally(() => {
    if (inFlight === pending) inFlight = null;
    schedule();
  });
  inFlight = pending;
  return pending;
}

export function refreshMobileDeviceLink(): Promise<void> {
  return operate(readDeviceLink);
}

export function wakeMobileDeviceLink(): void {
  if (running) void refreshMobileDeviceLink();
}

export function fenceMobileDeviceLink(): void {
  epoch += 1;
  stopTimer();
}

export function startMobileDeviceLink(): Promise<void> {
  if (inFlight || hasPendingDeviceLink()) return Promise.resolve();
  useDeviceLinkStore.setState({ phase: 'scanning', projection: null });
  return operate(scanDeviceLink);
}

export function cancelMobileDeviceLink(): Promise<void> {
  if (useDeviceLinkStore.getState().phase === 'cancelling' && inFlight) return inFlight;
  epoch += 1;
  stopTimer();
  useDeviceLinkStore.setState({ phase: 'cancelling', busy: true, errorKey: null });
  // Native cancellation must run while a camera/request is in flight.
  const observed = epoch;
  const previous = inFlight;
  const cancellation = (async () => {
    try {
      const projection = await cancelDeviceLink();
      await previous;
      await apply(projection, observed);
    } catch (error) {
      if (observed === epoch) useDeviceLinkStore.setState({ errorKey: errorKey(error) });
    } finally {
      if (observed === epoch) useDeviceLinkStore.setState({ busy: false });
    }
  })();
  const pending = cancellation.finally(() => {
    if (inFlight === pending) inFlight = null;
    schedule();
  });
  inFlight = pending;
  return pending;
}

export function submitMobileDeviceLink(input: NativeAccessSubmitInput): Promise<void> {
  if (inFlight) return Promise.resolve();
  return operate(() => submitDeviceLink(input));
}

export function createDeviceLinkRuntimeDescriptor(): MobileRuntimeDescriptor {
  return {
    id: 'device-link',
    title: 'Device Link',
    responsibility: 'Owns camera intent, restart reconciliation and redacted pre-login projections.',
    dependsOn: ['secure-storage'],
    async bootstrap() {
      epoch += 1;
      running = true;
      await inFlight;
      await refreshMobileDeviceLink();
    },
    async suspend() {
      running = false;
      epoch += 1;
      stopTimer();
    },
    async resume() {
      epoch += 1;
      running = true;
      await inFlight;
      await refreshMobileDeviceLink();
    },
    async teardown() {
      running = false;
      epoch += 1;
      stopTimer();
      await inFlight;
      useDeviceLinkStore.setState({ phase: 'idle', projection: null, busy: false, errorKey: null });
      return { runtimeId: 'device-link', success: true, durationMs: 0 };
    },
  };
}
