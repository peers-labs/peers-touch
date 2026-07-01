import type {
  AtelierProjectionEvent,
  AtelierProjectionSnapshot,
  AtelierRuntimeCall,
} from './projection';
import type { AtelierRuntimeBridge } from './bridgeRuntime';

export interface AtelierAppletBridgeHost {
  invoke<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  onEvent?(topic: string, handler: (payload: unknown) => void): () => void;
}

export interface CreateAppletSdkAtelierBridgeOptions {
  projectionEventTopic?: string;
  projectionStream?: {
    agentId: string;
    taskId?: string;
    afterEventSeq?: number;
  };
}

const DEFAULT_PROJECTION_EVENT_TOPIC = 'atelier.projection.event';

/**
 * Adapts the applet-sdk host shape to Atelier's projection runtime bridge.
 * The applet stays ignorant of Tauri/Station transport details.
 */
export function createAppletSdkAtelierBridge(
  host: AtelierAppletBridgeHost,
  options: CreateAppletSdkAtelierBridgeOptions = {},
): AtelierRuntimeBridge {
  const projectionEventTopic = options.projectionEventTopic ?? DEFAULT_PROJECTION_EVENT_TOPIC;

  return {
    async call(request) {
      const snapshot = await host.invoke<AtelierProjectionSnapshot>(
        request.method,
        request.payload as Record<string, unknown>,
      );
      return assertProjectionSnapshot(snapshot, request);
    },
    subscribeProjection(listener) {
      if (!host.onEvent) return () => {};
      void host.invoke('events.subscribe', { topic: projectionEventTopic });
      if (options.projectionStream) {
        void host.invoke('atelier.events.subscribe', {
          agentId: options.projectionStream.agentId,
          taskId: options.projectionStream.taskId,
          afterEventSeq: options.projectionStream.afterEventSeq ?? 0,
        });
      }
      const unsubscribeEvent = host.onEvent(projectionEventTopic, (payload) => {
        const event = parseProjectionEvent(payload);
        if (event) listener(event);
      });
      return () => {
        unsubscribeEvent();
        void host.invoke('events.unsubscribe', { topic: projectionEventTopic });
      };
    },
  };
}

function assertProjectionSnapshot(
  value: unknown,
  request: AtelierRuntimeCall,
): AtelierProjectionSnapshot {
  if (isProjectionSnapshot(value)) return value;
  throw new Error(`Atelier bridge method ${request.method} did not return a projection snapshot`);
}

function parseProjectionEvent(value: unknown): AtelierProjectionEvent | null {
  if (typeof value === 'string') {
    try {
      return parseProjectionEvent(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }

  if (!isObject(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.seq !== 'number') return null;
  if (typeof value.receivedAt !== 'string') return null;
  if (!isObject(value.patch) || typeof value.patch.kind !== 'string') return null;

  return value as unknown as AtelierProjectionEvent;
}

function isProjectionSnapshot(value: unknown): value is AtelierProjectionSnapshot {
  return (
    isObject(value) &&
    value.version === 'atelier-projection/v0' &&
    typeof value.selectedTaskId === 'string' &&
    isObject(value.workspace) &&
    Array.isArray(value.workspace.tasks)
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
