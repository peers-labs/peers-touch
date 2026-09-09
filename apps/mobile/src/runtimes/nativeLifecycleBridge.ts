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

let currentGeneration = 0;
let lifecycleEventGeneration: number | null = null;
let lastReconciliation:
  | { readonly generation: number; readonly reconciledAtMs: number }
  | null = null;
const lifecycleEventIds = new Set<string>();

interface NativeLifecycleBridgeHandlers {
  readonly onLifecycleEvent?: (
    payload: LifecycleEventPayload,
  ) => void | Promise<void>;
  readonly onNativeListenerReady?: () => void;
}

export function getLifecycleGeneration(): number {
  return currentGeneration;
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

/**
 * Install the W7 native lifecycle listeners and return an idempotent teardown.
 */
export function installNativeLifecycleBridge(
  handlers: NativeLifecycleBridgeHandlers = {},
): () => void {
  let disposed = false;
  const unlisteners = new Set<UnlistenFn>();
  let nativeLifecycleListener: PluginListener | null = null;
  let nativeSignalQueue: Promise<void> = Promise.resolve();

  const installListener = <Payload>(
    eventName: string,
    operation: string,
    handle: (payload: Payload) => unknown | Promise<unknown>,
  ) => {
    Promise.resolve()
      .then(() => listen<Payload>(eventName, (event) => {
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
      }))
      .then((unlisten) => {
        if (disposed) {
          teardownListener(unlisten, operation);
          return;
        }
        unlisteners.add(unlisten);
      })
      .catch((error) => {
        reportBridgeError(
          toBridgeError('MOBILE_NATIVE_LISTENER_INSTALL_FAILED', operation, error),
        );
      });
  };

  installListener<LifecycleEventPayload>(
    'mobile:lifecycle',
    'listen-lifecycle',
    async (payload) => {
      if (!processLifecycleEvent(payload)) return;
      await handlers.onLifecycleEvent?.(payload);
    },
  );
  installListener<ReconciliationReportPayload>(
    'mobile:reconciliation',
    'listen-reconciliation',
    processReconciliationReport,
  );

  void addPluginListener<NativeLifecycleSignalPayload>(
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
  )
    .then((listener) => {
      if (disposed) {
        teardownPluginListener(listener, 'native-listener-late-teardown');
        return;
      }
      nativeLifecycleListener = listener;
      handlers.onNativeListenerReady?.();
    })
    .catch((error) => {
      reportBridgeError(
        toBridgeError(
          'MOBILE_NATIVE_LISTENER_INSTALL_FAILED',
          'listen-native-lifecycle',
          error,
        ),
      );
    });

  return () => {
    if (disposed) return;
    disposed = true;
    for (const unlisten of unlisteners) {
      teardownListener(unlisten, 'listener-teardown');
    }
    unlisteners.clear();
    if (nativeLifecycleListener) {
      teardownPluginListener(
        nativeLifecycleListener,
        'native-listener-teardown',
      );
      nativeLifecycleListener = null;
    }
  };
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

function teardownListener(unlisten: UnlistenFn, operation: string): void {
  try {
    unlisten();
  } catch (error) {
    reportBridgeError(
      toBridgeError('MOBILE_NATIVE_LISTENER_TEARDOWN_FAILED', operation, error),
    );
  }
}

function teardownPluginListener(
  listener: PluginListener,
  operation: string,
): void {
  void listener.unregister().catch((error) => {
    reportBridgeError(
      toBridgeError('MOBILE_NATIVE_LISTENER_TEARDOWN_FAILED', operation, error),
    );
  });
}

function reportBridgeError(error: NativeLifecycleBridgeError): void {
  const detail: NativeLifecycleBridgeErrorDetail = {
    code: error.code,
    operation: error.operation,
    message: error.message,
  };
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
  reset(): void {
    currentGeneration = 0;
    lifecycleEventGeneration = null;
    lastReconciliation = null;
    lifecycleEventIds.clear();
  },
};
