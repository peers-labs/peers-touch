import { sdk } from '@peers-touch/applet-sdk';
import type { AtelierRuntime } from './runtime';
import { createMockAtelierRuntime } from './runtime';
import { createAppletSdkAtelierBridge, type CreateAppletSdkAtelierBridgeOptions } from './appletBridge';
import { createBridgeAtelierRuntime } from './bridgeRuntime';
import { toProjectionSnapshot } from './projection';
import { ATELIER_DEFAULT_DIRECT_RUN_MODEL } from './projection.contract.generated';
import type { AtelierState } from './types';

declare global {
  interface Window {
    __ATELIER_PROJECTION_STREAM__?: CreateAppletSdkAtelierBridgeOptions['projectionStream'];
  }
}

const HOST_RUNTIMES = new Set(['lynx', 'web-host']);

/**
 * Builds the runtime used by the prototype entry.
 * Host containers get the real applet-sdk bridge; plain browser previews keep
 * the mock runtime so design review and Vite dev never depend on Station.
 */
export function createAtelierRuntimeForEnvironment(): AtelierRuntime {
  if (!HOST_RUNTIMES.has(sdk.runtime)) {
    return createMockAtelierRuntime();
  }
  const initialSnapshot = toProjectionSnapshot(emptyHostState());

  return createBridgeAtelierRuntime({
    bridge: createAppletSdkAtelierBridge(sdk, {
      projectionStream: readProjectionStreamConfig(),
      initialSnapshot,
    }),
    initialSnapshot,
  });
}

function emptyHostState(): AtelierState {
  return {
    budgetSpent: 0,
    budgetCap: 1,
    model: ATELIER_DEFAULT_DIRECT_RUN_MODEL,
    tasks: [],
    selectedTaskId: '',
    stream: {},
    todos: {},
    context: {},
    artifacts: {},
    gates: {},
  };
}

function readProjectionStreamConfig(): CreateAppletSdkAtelierBridgeOptions['projectionStream'] {
  const globalConfig = typeof window !== 'undefined' ? window.__ATELIER_PROJECTION_STREAM__ : undefined;
  const normalizedGlobalConfig = normalizeProjectionStreamConfig(globalConfig);
  if (normalizedGlobalConfig) return normalizedGlobalConfig;

  if (typeof window === 'undefined') return undefined;

  const params = new URLSearchParams(window.location.search);
  return normalizeProjectionStreamConfig({
    agentId: params.get('agentId'),
    taskId: params.get('taskId'),
    afterEventSeq: params.get('afterEventSeq'),
  });
}

export function normalizeProjectionStreamConfig(input: unknown): CreateAppletSdkAtelierBridgeOptions['projectionStream'] {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  const agentId = typeof record.agentId === 'string' ? record.agentId.trim() : '';
  if (!agentId) return undefined;
  const taskId = typeof record.taskId === 'string' ? record.taskId.trim() : '';
  const afterEventSeq = normalizeAfterEventSeq(record.afterEventSeq);
  return {
    agentId,
    ...(taskId ? { taskId } : {}),
    ...(afterEventSeq !== undefined ? { afterEventSeq } : {}),
  };
}

function normalizeAfterEventSeq(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : undefined;
  return parsed !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
