/**
 * nativeLifecycleBridge.ts — W7 TS-side lifecycle generation bridge.
 *
 * Listens to Rust-emitted lifecycle and reconciliation events, propagates
 * lifecycle generation to the kernel, and feeds reconciliation data into
 * the recovery projection.
 *
 * Design: WorkManager / BGTaskScheduler emit wakeups only. Rust performs
 * reconciliation. This bridge routes the reconciliation report to the
 * recovery projection and triggers kernel resume when appropriate.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

import { getRecoveryProjection } from './recoveryProjection';
import type { DraftProjection } from './commandRuntime';

// ---------------------------------------------------------------------------
// Event payload types (mirrored from Rust background_bridge.rs)
// ---------------------------------------------------------------------------

export interface LifecycleEventPayload {
  readonly source: string;
  readonly generation: number;
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

// ---------------------------------------------------------------------------
// Permission types (mirrored from Rust permission_bridge.rs)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Network types (mirrored from Rust network_bridge.rs)
// ---------------------------------------------------------------------------

export type NetworkType = 'none' | 'wifi' | 'cellular' | 'ethernet' | 'unknown';

export interface NetworkState {
  readonly connected: boolean;
  readonly networkType: NetworkType;
  readonly updatedAtMs: number;
}

// ---------------------------------------------------------------------------
// Lifecycle generation tracking
// ---------------------------------------------------------------------------

let currentGeneration = 0;

export function getLifecycleGeneration(): number {
  return currentGeneration;
}

// ---------------------------------------------------------------------------
// Tauri invoke wrappers
// ---------------------------------------------------------------------------

export async function fetchLifecycleGeneration(): Promise<number> {
  const gen = await invoke<number>('lifecycle_generation');
  currentGeneration = gen;
  return gen;
}

export async function advanceLifecycleGeneration(): Promise<number> {
  const gen = await invoke<number>('lifecycle_advance_generation');
  currentGeneration = gen;
  return gen;
}

export async function checkPermission(kind: PermissionKind): Promise<PermissionCheckResult> {
  return invoke<PermissionCheckResult>('permission_check', { kind });
}

export async function requestPermission(kind: PermissionKind): Promise<PermissionRequestResult> {
  return invoke<PermissionRequestResult>('permission_request', { kind });
}

export async function checkAllPermissions(): Promise<PermissionCheckResult[]> {
  return invoke<PermissionCheckResult[]>('permission_check_all');
}

export async function fetchNetworkState(): Promise<NetworkState> {
  return invoke<NetworkState>('network_state');
}

export async function isNetworkConnected(): Promise<boolean> {
  return invoke<boolean>('network_is_connected');
}

// ---------------------------------------------------------------------------
// Event listener installation
// ---------------------------------------------------------------------------

/**
 * Install the W7 native lifecycle bridge listeners.
 *
 * Returns an uninstall function that removes all listeners.
 */
export function installNativeLifecycleBridge(): () => void {
  let disposed = false;
  const unlisteners: UnlistenFn[] = [];

  // Listen for lifecycle generation events from Rust
  listen<LifecycleEventPayload>('mobile:lifecycle', (event) => {
    if (disposed) return;
    const payload = event.payload;
    currentGeneration = payload.generation;
  })
    .then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    })
    .catch(reportBridgeError('listen-lifecycle'));

  // Listen for reconciliation reports from Rust
  listen<ReconciliationReportPayload>('mobile:reconciliation', (event) => {
    if (disposed) return;
    processReconciliationReport(event.payload);
  })
    .then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    })
    .catch(reportBridgeError('listen-reconciliation'));

  return () => {
    disposed = true;
    unlisteners.splice(0).forEach((unlisten) => unlisten());
  };
}

// ---------------------------------------------------------------------------
// Reconciliation report processing
// ---------------------------------------------------------------------------

function processReconciliationReport(report: ReconciliationReportPayload): void {
  const projection = getRecoveryProjection();

  // Update generation
  currentGeneration = report.generation;

  // Report unknown-outcome commands if any
  if (report.ledgerUnknownCount > 0) {
    // The recovery projection will receive the actual command list
    // when the command runtime reads back unknown entries.
    // Here we trigger a readback signal through a custom event.
    window.dispatchEvent(
      new CustomEvent('recovery:reconciliation-readback', {
        detail: {
          ledgerUnknownCount: report.ledgerUnknownCount,
          draftCount: report.draftCount,
          generation: report.generation,
        },
      }),
    );
  }

  // Report session validity
  if (!report.sessionValid) {
    projection.reportDeviceLocalFlag('session-expired');
  }
}

function reportBridgeError(context: string): (error: unknown) => void {
  return (error: unknown) => {
    window.dispatchEvent(
      new CustomEvent('mobile-native-lifecycle-bridge:error', {
        detail: {
          context,
          message: error instanceof Error ? error.message : String(error),
        },
      }),
    );
  };
}
