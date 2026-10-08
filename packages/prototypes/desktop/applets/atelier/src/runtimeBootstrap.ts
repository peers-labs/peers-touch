import { sdk } from '@peers-touch/applet-sdk';
import type { AtelierRuntime } from './runtime';
import { createMockAtelierRuntime } from './runtime';
import { createAppletSdkAtelierBridge } from './appletBridge';
import { createBridgeAtelierRuntime } from './bridgeRuntime';
import { toProjectionSnapshot } from './projection';
import { ATELIER_DEFAULT_DIRECT_RUN_MODEL } from './projection.contract.generated';
import type { AtelierState } from './types';

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
    bridge: createAppletSdkAtelierBridge(sdk),
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
