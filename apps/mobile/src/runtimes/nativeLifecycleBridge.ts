/**
 * nativeLifecycleBridge.ts — W7 TS-side lifecycle generation bridge.
 *
 * Native wakeups are generation-fenced inputs. They can request runtime work,
 * but they cannot move the local generation backwards or mutate business
 * projections directly.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  addPluginListener,
  invoke,
  type PluginListener,
} from '@tauri-apps/api/core';

import { getRecoveryProjection } from './recoveryProjection';

export const MOBILE_NATIVE_LIFECYCLE_BRIDGE_ERROR_EVENT =
  'mobile-native-lifecycle-bridge:error';

const PLATFORM_PERMISSIONS_PLUGIN = 'peers-platform-permissions';
const PLATFORM_LIFECYCLE_EVENT = 'lifecycle';
const PLATFORM_NETWORK_EVENT = 'network';
const PLATFORM_PUSH_AVAILABLE_EVENT = 'pushAvailable';
const PLATFORM_SCHEDULED_AVAILABLE_EVENT = 'scheduledAvailable';

export type NativeLifecycleBridgeErrorCode =
  | 'MOBILE_NATIVE_INVOKE_FAILED'
  | 'MOBILE_NATIVE_LISTENER_INSTALL_FAILED'
  | 'MOBILE_NATIVE_LISTENER_TEARDOWN_FAILED'
  | 'MOBILE_NATIVE_READBACK_INVALID'
  | 'MOBILE_NATIVE_LIFECYCLE_TRANSITION_FAILED';

export interface NativeLifecycleBridgeErrorDetail {
  readonly code: NativeLifecycleBridgeErrorCode;
  readonly operation: string;
  readonly message: string;
}

export class NativeLifecycleBridgeError extends Error {
  readonly code: NativeLifecycleBridgeErrorCode;
  readonly operation: string;

  constructor(
    code: NativeLifecycleBridgeErrorCode,
    operation: string,
    cause?: unknown,
  ) {
    super(`${code}:${operation}`, { cause });
    this.name = 'NativeLifecycleBridgeError';
    this.code = code;
    this.operation = operation;
  }
}

export type NativeLifecycleSource =
  | 'android_activity'
  | 'ios_application'
  | 'work_manager_wakeup'
  | 'bg_task_wakeup'
  | 'push_wakeup'
  | 'deep_link_activation'
  | 'network_change';

export type NativeLifecycleState = 'foreground' | 'background' | 'wakeup';
export type NativeLifecyclePlatform = 'android' | 'ios';

export interface NativeLifecycleSignalPayload {
  readonly platform: NativeLifecyclePlatform;
  readonly state: Exclude<NativeLifecycleState, 'wakeup'>;
  readonly sequence: number;
  readonly timestampMs: number;
}

export interface LifecycleEventPayload {
  readonly source: NativeLifecycleSource;
  readonly state: NativeLifecycleState;
  readonly generation: number;
  readonly eventId: string;
  readonly timestampMs: number;
}

export interface ReconciliationReportPayload {
  readonly generation: number;
  readonly ledgerPendingCount: number;
  readonly ledgerUnknownCount: number;
  readonly draftCount: number;
  readonly sessionValid: boolean;
  readonly reconciledAtMs: number;
}

export type PermissionKind = 'camera' | 'microphone' | 'storage' | 'notifications';
export type PermissionStatus = 'not_determined' | 'granted' | 'denied' | 'restricted' | 'unsupported';

export interface PermissionCheckResult {
  readonly kind: PermissionKind;
  readonly status: PermissionStatus;
  readonly canRequest: boolean;
}

export interface PermissionRequestResult {
  readonly kind: PermissionKind;
  readonly status: PermissionStatus;
  readonly wasAlreadyGranted: boolean;
}

export type NetworkType = 'none' | 'wifi' | 'cellular' | 'ethernet' | 'unknown';

export interface NetworkState {
  readonly connected: boolean;
  readonly networkType: NetworkType;
  readonly updatedAtMs: number;
}

export interface NativeNetworkSignalPayload {
  readonly platform: NativeLifecyclePlatform;
  readonly connected: boolean;
  readonly networkType: NetworkType;
  readonly sequence: number;
  readonly timestampMs: number;
}

export interface NativeNetworkIngestResult {
  readonly accepted: boolean;
  readonly connectionRestored: boolean;
  readonly generation: number;
  readonly state: NetworkState;
}

export interface NativePushAvailabilitySignal {
  readonly lifecycleGeneration: number;
  readonly pendingCount: number;
}

export interface NativePushScope {
  readonly stationPeerId: string;
  readonly actorPtid: string;
  readonly sessionId: string;
  readonly environment: 'development' | 'production';
}

export interface NativePushActivationProjection {
  readonly armed: boolean;
  readonly lifecycleGeneration: number;
}

export interface NativePushDrainProjection {
  readonly acceptedCallbacks: number;
  readonly discardedCallbacks: number;
  readonly registrationUpdates: number;
  readonly reconcileEvents: number;
}

export interface NativePushDeactivationProjection {
  readonly locallyFenced: boolean;
  readonly unregisterAttempted: number;
  readonly unregisterFailed: number;
}

export interface ScheduledDrainProjection {
  readonly acceptedCallbacks: number;
  readonly discardedCallbacks: number;
  readonly failedCallbacks: number;
}

let currentGeneration = 0;
let lifecycleEventGeneration: number | null = null;
let lastReconciliation:
  | { readonly generation: number; readonly reconciledAtMs: number }
  | null = null;
let lastBridgeError: NativeLifecycleBridgeErrorDetail | null = null;
const lifecycleEventIds = new Set<string>();

interface NativeLifecycleBridgeHandlers {
  readonly onLifecycleEvent?: (
    payload: LifecycleEventPayload,
  ) => void | Promise<void>;
  readonly onNativeListenerReady?: () => void;
  readonly onNetworkStateChange?: (
    state: NetworkState,
    connectionRestored: boolean,
  ) => void | Promise<void>;
  readonly onNativeNetworkListenerReady?: () => void;
  readonly onPushCallbacksAvailable?: (
    payload: NativePushAvailabilitySignal,
  ) => void | Promise<void>;
  readonly onScheduledCallbacksAvailable?: (
    payload: NativePushAvailabilitySignal,
  ) => void | Promise<void>;
}

export interface NativeLifecycleBridgeInstallation {
  readonly ready: Promise<void>;
  teardown(): Promise<void>;
}

export function getLifecycleGeneration(): number {
  return currentGeneration;
}

export function readNativeLifecycleBridgeDiagnostic(): NativeLifecycleBridgeErrorDetail | null {
  return lastBridgeError ? { ...lastBridgeError } : null;
}

export async function fetchLifecycleGeneration(): Promise<number> {
  const generation = validateGeneration(
    await invokeNative<unknown>('lifecycle_generation'),
    'lifecycle-generation-read',
  );
  return observeGeneration(generation);
}

export async function advanceLifecycleGeneration(): Promise<number> {
  const generation = validateGeneration(
    await invokeNative<unknown>('lifecycle_advance_generation'),
    'lifecycle-generation-advance',
  );
  return observeGeneration(generation);
}

export async function checkPermission(kind: PermissionKind): Promise<PermissionCheckResult> {
  return invokeNative<PermissionCheckResult>('permission_check', { kind });
}

export async function requestPermission(kind: PermissionKind): Promise<PermissionRequestResult> {
  return invokeNative<PermissionRequestResult>('permission_request', { kind });
}

export async function checkAllPermissions(): Promise<PermissionCheckResult[]> {
  return invokeNative<PermissionCheckResult[]>('permission_check_all');
}

export async function fetchNetworkState(): Promise<NetworkState> {
  const state = await invokeNative<unknown>('network_state');
  return validateNetworkState(state);
}

export async function isNetworkConnected(): Promise<boolean> {
  return (await fetchNetworkState()).connected;
}

export async function reconcileNativeLifecycle(
  sessionValid: boolean,
): Promise<ReconciliationReportPayload> {
  const report = validateReconciliationReportPayload(
    await invokeNative<unknown>('lifecycle_reconcile', {
      input: { sessionValid },
    }),
  );
  processReconciliationReport(report);
  return report;
}

export async function activateNativePush(
  input: NativePushScope,
): Promise<NativePushActivationProjection> {
  return invokeNative<NativePushActivationProjection>('push_activate', { input });
}

export async function drainNativePush(
  input: NativePushScope,
): Promise<NativePushDrainProjection> {
  return invokeNative<NativePushDrainProjection>('push_drain', { input });
}

export async function deactivateNativePush(): Promise<NativePushDeactivationProjection> {
  return invokeNative<NativePushDeactivationProjection>('push_deactivate');
}

export async function drainScheduledReconcile(
  input: NativePushScope,
): Promise<ScheduledDrainProjection> {
  return invokeNative<ScheduledDrainProjection>(
    'scheduled_reconcile_drain',
    { input },
  );
}

/**
 * Install the W7 native lifecycle listeners and return an idempotent teardown.
 */
export function installNativeLifecycleBridge(
  handlers: NativeLifecycleBridgeHandlers = {},
): NativeLifecycleBridgeInstallation {
  lastBridgeError = null;
  let disposed = false;
  const unlisteners = new Set<UnlistenFn>();
  let nativeLifecycleListener: PluginListener | null = null;
  let nativeNetworkListener: PluginListener | null = null;
  let nativePushListener: PluginListener | null = null;
  let nativeScheduledListener: PluginListener | null = null;
  let nativeSignalQueue: Promise<void> = Promise.resolve();
  let networkSignalQueue: Promise<void> = Promise.resolve();
  let resolveInitialNetworkObservation: () => void = () => undefined;
  let rejectInitialNetworkObservation: (reason?: unknown) => void = () => undefined;
  const initialNetworkObservation = new Promise<void>((resolve, reject) => {
    resolveInitialNetworkObservation = resolve;
    rejectInitialNetworkObservation = reject;
  });
  let initialNetworkObserved = false;

  const installListener = async <Payload>(
    eventName: string,
    operation: string,
    handle: (payload: Payload) => unknown | Promise<unknown>,
  ): Promise<void> => {
    try {
      const unlisten = await listen<Payload>(eventName, (event) => {
        if (disposed) return;
        try {
          void Promise.resolve(handle(event.payload)).catch((error) => {
            reportBridgeError(
              toBridgeError(
                'MOBILE_NATIVE_LIFECYCLE_TRANSITION_FAILED',
                operation,
                error,
              ),
            );
          });
        } catch (error) {
          reportBridgeError(
            toBridgeError('MOBILE_NATIVE_READBACK_INVALID', operation, error),
          );
        }
      });
      if (disposed) {
        teardownListener(unlisten, operation);
        return;
      }
      unlisteners.add(unlisten);
    } catch (error) {
      const bridgeError = toBridgeError(
        'MOBILE_NATIVE_LISTENER_INSTALL_FAILED',
        operation,
        error,
      );
      reportBridgeError(bridgeError);
      throw bridgeError;
    }
  };

  const canonicalLifecycleReady = installListener<LifecycleEventPayload>(
    'mobile:lifecycle',
    'listen-lifecycle',
    async (payload) => {
      if (!processLifecycleEvent(payload)) return;
      await handlers.onLifecycleEvent?.(payload);
    },
  );
  const reconciliationReady = installListener<ReconciliationReportPayload>(
    'mobile:reconciliation',
    'listen-reconciliation',
    processReconciliationReport,
  );

  const nativeLifecycleReady = (async (): Promise<void> => {
    try {
      const listener = await addPluginListener<NativeLifecycleSignalPayload>(
        PLATFORM_PERMISSIONS_PLUGIN,
        PLATFORM_LIFECYCLE_EVENT,
        (payload) => {
          if (disposed) return;
          let signal: NativeLifecycleSignalPayload;
          try {
            signal = validateNativeLifecycleSignal(payload);
          } catch (error) {
            reportBridgeError(
              toBridgeError(
                'MOBILE_NATIVE_READBACK_INVALID',
                'native-lifecycle-signal',
                error,
              ),
            );
            return;
          }

          nativeSignalQueue = nativeSignalQueue
            .then(async () => {
              if (disposed) return;
              await invokeNative('lifecycle_ingest_native_signal', {
                input: signal,
              });
            })
            .catch((error) => {
              reportBridgeError(
                toBridgeError(
                  'MOBILE_NATIVE_INVOKE_FAILED',
                  'lifecycle-ingest-native-signal',
                  error,
                ),
              );
            });
        },
      );
      if (disposed) {
        teardownPluginListener(listener, 'native-listener-late-teardown');
        return;
      }
      nativeLifecycleListener = listener;
      handlers.onNativeListenerReady?.();
    } catch (error) {
      const bridgeError = toBridgeError(
        'MOBILE_NATIVE_LISTENER_INSTALL_FAILED',
        'listen-native-lifecycle',
        error,
      );
      reportBridgeError(bridgeError);
      throw bridgeError;
    }
  })();

  const nativeNetworkReady = (async (): Promise<void> => {
    try {
      const listener = await addPluginListener<NativeNetworkSignalPayload>(
        PLATFORM_PERMISSIONS_PLUGIN,
        PLATFORM_NETWORK_EVENT,
        (payload) => {
          if (disposed) return;
          let signal: NativeNetworkSignalPayload;
          try {
            signal = validateNativeNetworkSignal(payload);
          } catch (error) {
            reportBridgeError(
              toBridgeError(
                'MOBILE_NATIVE_READBACK_INVALID',
                'native-network-signal',
                error,
              ),
            );
            return;
          }

          networkSignalQueue = networkSignalQueue
            .then(async () => {
              if (disposed) return;
              const result = validateNativeNetworkIngestResult(
                await invokeNative<unknown>('network_ingest_native_signal', {
                  input: signal,
                }),
              );
              if (!result.accepted || result.generation !== currentGeneration) return;
              await handlers.onNetworkStateChange?.(
                result.state,
                result.connectionRestored,
              );
              if (!initialNetworkObserved) {
                initialNetworkObserved = true;
                resolveInitialNetworkObservation();
              }
            })
            .catch((error) => {
              if (!initialNetworkObserved) rejectInitialNetworkObservation(error);
              reportBridgeError(
                toBridgeError(
                  'MOBILE_NATIVE_INVOKE_FAILED',
                  'network-ingest-native-signal',
                  error,
                ),
              );
            });
        },
      );
      if (disposed) {
        teardownPluginListener(listener, 'native-network-listener-late-teardown');
        return;
      }
      nativeNetworkListener = listener;
      const initial = validateNativeNetworkIngestResult(
        await invokeNative<unknown>('network_start_observation'),
      );
      if (
        initial.generation !== currentGeneration
        || initial.state.updatedAtMs === 0
      ) {
        throw new NativeLifecycleBridgeError(
          'MOBILE_NATIVE_READBACK_INVALID',
          'network-start-observation',
        );
      }
      if (initial.accepted) {
        await handlers.onNetworkStateChange?.(
          initial.state,
          initial.connectionRestored,
        );
      }
      if (!initialNetworkObserved) {
        initialNetworkObserved = true;
        resolveInitialNetworkObservation();
      }
      await initialNetworkObservation;
      if (disposed) return;
      handlers.onNativeNetworkListenerReady?.();
    } catch (error) {
      if (!initialNetworkObserved) {
        initialNetworkObserved = true;
        resolveInitialNetworkObservation();
      }
      const bridgeError = toBridgeError(
        'MOBILE_NATIVE_LISTENER_INSTALL_FAILED',
        'listen-native-network',
        error,
      );
      reportBridgeError(bridgeError);
      throw bridgeError;
    }
  })();

  const nativePushReady = (async (): Promise<void> => {
    try {
      const listener = await addPluginListener<NativePushAvailabilitySignal>(
        PLATFORM_PERMISSIONS_PLUGIN,
        PLATFORM_PUSH_AVAILABLE_EVENT,
        (payload) => {
          if (disposed) return;
          let signal: NativePushAvailabilitySignal;
          try {
            signal = validateNativePushAvailability(payload);
          } catch (error) {
            reportBridgeError(
              toBridgeError(
                'MOBILE_NATIVE_READBACK_INVALID',
                'native-push-availability',
                error,
              ),
            );
            return;
          }
          void Promise.resolve(handlers.onPushCallbacksAvailable?.(signal)).catch(
            (error) => {
              reportBridgeError(
                toBridgeError(
                  'MOBILE_NATIVE_LIFECYCLE_TRANSITION_FAILED',
                  'native-push-drain',
                  error,
                ),
              );
            },
          );
        },
      );
      if (disposed) {
        teardownPluginListener(listener, 'native-push-listener-late-teardown');
        return;
      }
      nativePushListener = listener;
    } catch (error) {
      const bridgeError = toBridgeError(
        'MOBILE_NATIVE_LISTENER_INSTALL_FAILED',
        'listen-native-push',
        error,
      );
      reportBridgeError(bridgeError);
      throw bridgeError;
    }
  })();

  const nativeScheduledReady = (async (): Promise<void> => {
    try {
      const listener = await addPluginListener<NativePushAvailabilitySignal>(
        PLATFORM_PERMISSIONS_PLUGIN,
        PLATFORM_SCHEDULED_AVAILABLE_EVENT,
        (payload) => {
          if (disposed) return;
          let signal: NativePushAvailabilitySignal;
          try {
            signal = validateNativePushAvailability(payload);
          } catch (error) {
            reportBridgeError(
              toBridgeError(
                'MOBILE_NATIVE_READBACK_INVALID',
                'native-scheduled-availability',
                error,
              ),
            );
            return;
          }
          void Promise.resolve(
            handlers.onScheduledCallbacksAvailable?.(signal),
          ).catch((error) => {
            reportBridgeError(
              toBridgeError(
                'MOBILE_NATIVE_LIFECYCLE_TRANSITION_FAILED',
                'native-scheduled-drain',
                error,
              ),
            );
          });
        },
      );
      if (disposed) {
        teardownPluginListener(
          listener,
          'native-scheduled-listener-late-teardown',
        );
        return;
      }
      nativeScheduledListener = listener;
    } catch (error) {
      const bridgeError = toBridgeError(
        'MOBILE_NATIVE_LISTENER_INSTALL_FAILED',
        'listen-native-scheduled',
        error,
      );
      reportBridgeError(bridgeError);
      throw bridgeError;
    }
  })();

  const ready = Promise.all([
    canonicalLifecycleReady,
    reconciliationReady,
    nativeLifecycleReady,
    nativeNetworkReady,
    nativePushReady,
    nativeScheduledReady,
  ]).then(() => undefined);

  async function teardown(): Promise<void> {
    if (disposed) return;
    disposed = true;
    if (!initialNetworkObserved) {
      initialNetworkObserved = true;
      resolveInitialNetworkObservation();
    }
    const pendingTeardown = [...unlisteners].map((unlisten) => (
      teardownListener(unlisten, 'listener-teardown')
    ));
    unlisteners.clear();
    if (nativeLifecycleListener) {
      pendingTeardown.push(teardownPluginListener(
        nativeLifecycleListener,
        'native-listener-teardown',
      ));
      nativeLifecycleListener = null;
    }
    if (nativeNetworkListener) {
      pendingTeardown.push(teardownPluginListener(
        nativeNetworkListener,
        'native-network-listener-teardown',
      ));
      nativeNetworkListener = null;
    }
    if (nativePushListener) {
      pendingTeardown.push(teardownPluginListener(
        nativePushListener,
        'native-push-listener-teardown',
      ));
      nativePushListener = null;
    }
    if (nativeScheduledListener) {
      pendingTeardown.push(teardownPluginListener(
        nativeScheduledListener,
        'native-scheduled-listener-teardown',
      ));
      nativeScheduledListener = null;
    }
    await Promise.all(pendingTeardown);
  }

  return { ready, teardown };
}

function validateNativePushAvailability(
  value: unknown,
): NativePushAvailabilitySignal {
  if (!isRecord(value)) {
    throw new NativeLifecycleBridgeError(
      'MOBILE_NATIVE_READBACK_INVALID',
      'native-push-availability-shape',
    );
  }
  const lifecycleGeneration = validateGeneration(
    value.lifecycleGeneration,
    'native-push-availability-generation',
  );
  validateCount(value.pendingCount, 'native-push-availability-count');
  const pendingCount = value.pendingCount as number;
  if (pendingCount === 0 || pendingCount > 64) {
    throw new NativeLifecycleBridgeError(
      'MOBILE_NATIVE_READBACK_INVALID',
      'native-push-availability-count',
    );
  }
  return { lifecycleGeneration, pendingCount };
}

function processLifecycleEvent(payload: LifecycleEventPayload): boolean {
  if (!NATIVE_LIFECYCLE_SOURCES.has(payload?.source)) {
    throw new NativeLifecycleBridgeError(
      'MOBILE_NATIVE_READBACK_INVALID',
      'lifecycle-event-source',
    );
  }
  if (!NATIVE_LIFECYCLE_STATES.has(payload?.state)) {
    throw new NativeLifecycleBridgeError(
      'MOBILE_NATIVE_READBACK_INVALID',
      'lifecycle-event-state',
    );
  }
  const generation = validateGeneration(
    payload?.generation,
    'lifecycle-event-generation',
  );
  validateCount(payload?.timestampMs, 'lifecycle-event-timestamp');
  if (typeof payload?.eventId !== 'string' || payload.eventId.trim() === '') {
    throw new NativeLifecycleBridgeError(
      'MOBILE_NATIVE_READBACK_INVALID',
      'lifecycle-event-id',
    );
  }
  if (generation < currentGeneration) return false;

  observeGeneration(generation);
  if (lifecycleEventGeneration !== generation) {
    lifecycleEventGeneration = generation;
    lifecycleEventIds.clear();
  }
  if (lifecycleEventIds.has(payload.eventId)) return false;
  lifecycleEventIds.add(payload.eventId);
  return true;
}

function validateNativeLifecycleSignal(
  value: unknown,
): NativeLifecycleSignalPayload {
  if (!isRecord(value)) {
    throw new NativeLifecycleBridgeError(
      'MOBILE_NATIVE_READBACK_INVALID',
      'native-lifecycle-signal-shape',
    );
  }
  if (
    !NATIVE_LIFECYCLE_PLATFORMS.has(
      value.platform as NativeLifecyclePlatform,
    )
    || !NATIVE_CALLBACK_STATES.has(
      value.state as Exclude<NativeLifecycleState, 'wakeup'>,
    )
  ) {
    throw new NativeLifecycleBridgeError(
      'MOBILE_NATIVE_READBACK_INVALID',
      'native-lifecycle-signal-value',
    );
  }
  validateCount(value.sequence, 'native-lifecycle-sequence');
  if (value.sequence === 0) {
    throw new NativeLifecycleBridgeError(
      'MOBILE_NATIVE_READBACK_INVALID',
      'native-lifecycle-sequence',
    );
  }
  validateCount(value.timestampMs, 'native-lifecycle-timestamp');

  return {
    platform: value.platform as NativeLifecyclePlatform,
    state: value.state as Exclude<NativeLifecycleState, 'wakeup'>,
    sequence: value.sequence as number,
    timestampMs: value.timestampMs as number,
  };
}

function validateNativeNetworkSignal(
  value: unknown,
): NativeNetworkSignalPayload {
  if (!isRecord(value)) {
    throw new NativeLifecycleBridgeError(
      'MOBILE_NATIVE_READBACK_INVALID',
      'native-network-signal-shape',
    );
  }
  if (!NATIVE_LIFECYCLE_PLATFORMS.has(value.platform as NativeLifecyclePlatform)) {
    throw new NativeLifecycleBridgeError(
      'MOBILE_NATIVE_READBACK_INVALID',
      'native-network-signal-platform',
    );
  }
  validateCount(value.sequence, 'native-network-sequence');
  validateCount(value.timestampMs, 'native-network-timestamp');
  if (value.sequence === 0 || value.timestampMs === 0) {
    throw new NativeLifecycleBridgeError(
      'MOBILE_NATIVE_READBACK_INVALID',
      'native-network-signal-ordering',
    );
  }

  const state = validateNetworkState({
    connected: value.connected,
    networkType: value.networkType,
    updatedAtMs: value.timestampMs,
  });
  return {
    platform: value.platform as NativeLifecyclePlatform,
    connected: state.connected,
    networkType: state.networkType,
    sequence: value.sequence as number,
    timestampMs: state.updatedAtMs,
  };
}

function validateNativeNetworkIngestResult(
  value: unknown,
): NativeNetworkIngestResult {
  if (
    !isRecord(value)
    || typeof value.accepted !== 'boolean'
    || typeof value.connectionRestored !== 'boolean'
  ) {
    throw new NativeLifecycleBridgeError(
      'MOBILE_NATIVE_READBACK_INVALID',
      'native-network-ingest-result',
    );
  }
  const generation = validateGeneration(
    value.generation,
    'native-network-ingest-generation',
  );
  return {
    accepted: value.accepted,
    connectionRestored: value.connectionRestored,
    generation,
    state: validateNetworkState(value.state),
  };
}

function processReconciliationReport(report: ReconciliationReportPayload): boolean {
  const generation = validateReconciliationReport(report);
  if (generation < currentGeneration) return false;
  if (
    lastReconciliation
    && (
      generation < lastReconciliation.generation
      || (
        generation === lastReconciliation.generation
        && report.reconciledAtMs <= lastReconciliation.reconciledAtMs
      )
    )
  ) {
    return false;
  }

  observeGeneration(generation);
  lastReconciliation = {
    generation,
    reconciledAtMs: report.reconciledAtMs,
  };
  const projection = getRecoveryProjection();

  if (report.ledgerUnknownCount > 0) {
    window.dispatchEvent(
      new CustomEvent('recovery:reconciliation-readback', {
        detail: {
          ledgerUnknownCount: report.ledgerUnknownCount,
          draftCount: report.draftCount,
          generation,
        },
      }),
    );
  }

  if (!report.sessionValid) {
    projection.reportDeviceLocalFlag('session-expired');
  } else {
    projection.clearDeviceLocalFlag('session-expired');
  }
  return true;
}

function validateReconciliationReportPayload(
  value: unknown,
): ReconciliationReportPayload {
  if (!isRecord(value)) {
    throw new NativeLifecycleBridgeError(
      'MOBILE_NATIVE_READBACK_INVALID',
      'reconciliation-report-shape',
    );
  }
  const report = value as unknown as ReconciliationReportPayload;
  validateReconciliationReport(report);
  return {
    generation: report.generation,
    ledgerPendingCount: report.ledgerPendingCount,
    ledgerUnknownCount: report.ledgerUnknownCount,
    draftCount: report.draftCount,
    sessionValid: report.sessionValid,
    reconciledAtMs: report.reconciledAtMs,
  };
}

function validateReconciliationReport(
  report: ReconciliationReportPayload,
): number {
  const generation = validateGeneration(
    report?.generation,
    'reconciliation-generation',
  );
  validateCount(report?.ledgerPendingCount, 'reconciliation-ledger-pending');
  validateCount(report?.ledgerUnknownCount, 'reconciliation-ledger-unknown');
  validateCount(report?.draftCount, 'reconciliation-draft-count');
  validateCount(report?.reconciledAtMs, 'reconciliation-timestamp');
  if (typeof report?.sessionValid !== 'boolean') {
    throw new NativeLifecycleBridgeError(
      'MOBILE_NATIVE_READBACK_INVALID',
      'reconciliation-session-valid',
    );
  }
  return generation;
}

function validateGeneration(value: unknown, operation: string): number {
  validateCount(value, operation);
  return value as number;
}

function validateCount(value: unknown, operation: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new NativeLifecycleBridgeError(
      'MOBILE_NATIVE_READBACK_INVALID',
      operation,
    );
  }
}

function validateNetworkState(value: unknown): NetworkState {
  if (!isRecord(value)) {
    throw new NativeLifecycleBridgeError(
      'MOBILE_NATIVE_READBACK_INVALID',
      'network-state-shape',
    );
  }
  const networkType = value.networkType;
  const connected = value.connected;
  validateCount(value.updatedAtMs, 'network-state-timestamp');
  if (
    typeof connected !== 'boolean'
    || typeof networkType !== 'string'
    || !NETWORK_TYPES.has(networkType as NetworkType)
    || (!connected && networkType !== 'none')
    || (connected && networkType === 'none')
  ) {
    throw new NativeLifecycleBridgeError(
      'MOBILE_NATIVE_READBACK_INVALID',
      'network-state-value',
    );
  }
  return {
    connected,
    networkType: networkType as NetworkType,
    updatedAtMs: value.updatedAtMs as number,
  };
}

function observeGeneration(generation: number): number {
  if (generation > currentGeneration) currentGeneration = generation;
  return currentGeneration;
}

async function invokeNative<Result>(
  command: string,
  args?: Record<string, unknown>,
): Promise<Result> {
  try {
    return await invoke<Result>(command, args);
  } catch (error) {
    throw toBridgeError('MOBILE_NATIVE_INVOKE_FAILED', command, error);
  }
}

async function teardownListener(
  unlisten: UnlistenFn,
  operation: string,
): Promise<void> {
  try {
    await Promise.resolve(unlisten());
  } catch (error) {
    reportBridgeError(
      toBridgeError('MOBILE_NATIVE_LISTENER_TEARDOWN_FAILED', operation, error),
    );
  }
}

async function teardownPluginListener(
  listener: PluginListener,
  operation: string,
): Promise<void> {
  try {
    await listener.unregister();
  } catch (error) {
    reportBridgeError(
      toBridgeError('MOBILE_NATIVE_LISTENER_TEARDOWN_FAILED', operation, error),
    );
  }
}

function reportBridgeError(error: NativeLifecycleBridgeError): void {
  const detail: NativeLifecycleBridgeErrorDetail = {
    code: error.code,
    operation: error.operation,
    message: error.message,
  };
  lastBridgeError = detail;
  window.dispatchEvent(
    new CustomEvent(MOBILE_NATIVE_LIFECYCLE_BRIDGE_ERROR_EVENT, { detail }),
  );
}

function toBridgeError(
  code: NativeLifecycleBridgeErrorCode,
  operation: string,
  error: unknown,
): NativeLifecycleBridgeError {
  return error instanceof NativeLifecycleBridgeError
    ? error
    : new NativeLifecycleBridgeError(code, operation, error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const NETWORK_TYPES: ReadonlySet<NetworkType> = new Set([
  'none',
  'wifi',
  'cellular',
  'ethernet',
  'unknown',
]);

const NATIVE_LIFECYCLE_SOURCES: ReadonlySet<NativeLifecycleSource> = new Set([
  'android_activity',
  'ios_application',
  'work_manager_wakeup',
  'bg_task_wakeup',
  'push_wakeup',
  'deep_link_activation',
  'network_change',
]);

const NATIVE_LIFECYCLE_STATES: ReadonlySet<NativeLifecycleState> = new Set([
  'foreground',
  'background',
  'wakeup',
]);

const NATIVE_LIFECYCLE_PLATFORMS: ReadonlySet<NativeLifecyclePlatform> = new Set([
  'android',
  'ios',
]);

const NATIVE_CALLBACK_STATES: ReadonlySet<
  Exclude<NativeLifecycleState, 'wakeup'>
> = new Set([
  'foreground',
  'background',
]);

export const nativeLifecycleBridgeTestContract = {
  acceptLifecycleEvent: processLifecycleEvent,
  validateNativeLifecycleSignal,
  validateNativeNetworkSignal,
  validateNativeNetworkIngestResult,
  reset(): void {
    currentGeneration = 0;
    lifecycleEventGeneration = null;
    lastReconciliation = null;
    lastBridgeError = null;
    lifecycleEventIds.clear();
  },
};
