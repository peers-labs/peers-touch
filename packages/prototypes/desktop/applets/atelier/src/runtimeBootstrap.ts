import { sdk } from '@peers-touch/applet-sdk';
import type { AtelierRuntime } from './runtime';
import { createMockAtelierRuntime } from './runtime';
import { createAppletSdkAtelierBridge, type CreateAppletSdkAtelierBridgeOptions } from './appletBridge';
import { createBridgeAtelierRuntime } from './bridgeRuntime';
import { toProjectionSnapshot } from './projection';
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

  return createBridgeAtelierRuntime({
    bridge: createAppletSdkAtelierBridge(sdk, {
      projectionStream: readProjectionStreamConfig(),
    }),
    initialSnapshot: toProjectionSnapshot(emptyHostState()),
  });
}

function emptyHostState(): AtelierState {
  return {
    budgetSpent: 0,
    budgetCap: 1,
    model: 'openrouter-3o',
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
  if (globalConfig?.agentId) return globalConfig;

  if (typeof window === 'undefined') return undefined;

  const params = new URLSearchParams(window.location.search);
  const agentId = params.get('agentId')?.trim();
  if (!agentId) return undefined;

  const taskId = params.get('taskId')?.trim() || undefined;
  const afterEventSeqRaw = params.get('afterEventSeq');
  const afterEventSeq = afterEventSeqRaw ? Number(afterEventSeqRaw) : undefined;

  return {
    agentId,
    taskId,
    afterEventSeq: Number.isFinite(afterEventSeq) ? afterEventSeq : undefined,
  };
}
