import type {
  AtelierRuntime,
  AtelierRuntimeSnapshot,
  CreateProjectFromGoalInput,
  ResolveDecisionInput,
  SendMessageInput,
  SetTaskStatusInput,
} from './runtime';
import type {
  AtelierProjectionEvent,
  AtelierProjectionPatch,
  AtelierProjectionSnapshot,
  AtelierRuntimeCall,
  AtelierRuntimeMethod,
  AtelierRuntimePayloadByMethod,
} from './projection';
import { fromProjectionSnapshot } from './projection';

export interface AtelierRuntimeBridge {
  call<M extends AtelierRuntimeMethod>(
    request: AtelierRuntimeCall<M>,
  ): Promise<AtelierProjectionSnapshot>;
  subscribeProjection?(listener: (event: AtelierProjectionEvent) => void): () => void;
}

export function createBridgeAtelierRuntime({
  bridge,
  initialSnapshot,
}: {
  bridge: AtelierRuntimeBridge;
  initialSnapshot: AtelierProjectionSnapshot;
}): AtelierRuntime {
  let snapshot = toRuntimeSnapshot(initialSnapshot);
  const listeners = new Set<(snapshot: AtelierRuntimeSnapshot) => void>();
  const seenEventKeys = new Set<string>();
  const seenEventOrder: string[] = [];
  let unsubscribeBridge: (() => void) | undefined;

  const emit = () => {
    const next = cloneSnapshot(snapshot);
    listeners.forEach((listener) => listener(next));
  };

  const setFromProjection = (projection: AtelierProjectionSnapshot) => {
    snapshot = toRuntimeSnapshot(projection);
    emit();
    return cloneSnapshot(snapshot);
  };

  const ensureBridgeSubscription = () => {
    if (unsubscribeBridge || !bridge.subscribeProjection) return;
    unsubscribeBridge = bridge.subscribeProjection((event) => {
      if (!rememberProjectionEvent(event, seenEventKeys, seenEventOrder)) return;
      snapshot = applyPatch(snapshot, event.patch);
      emit();
    });
  };

  const releaseBridgeSubscription = () => {
    unsubscribeBridge?.();
    unsubscribeBridge = undefined;
  };

  const call = async <M extends AtelierRuntimeMethod>(
    method: M,
    payload: AtelierRuntimePayloadByMethod[M],
  ) => setFromProjection(await bridge.call({ method, payload }));

  return {
    getSnapshot() {
      return cloneSnapshot(snapshot);
    },
    subscribe(listener) {
      listeners.add(listener);
      ensureBridgeSubscription();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) releaseBridgeSubscription();
      };
    },
    loadWorkspace() {
      return call('atelier.workspace.load', {});
    },
    createProjectFromGoal(input: CreateProjectFromGoalInput) {
      return call('atelier.project.createFromGoal', input);
    },
    sendMessage(input: SendMessageInput) {
      return call('atelier.message.send', input);
    },
    resolveDecision(input: ResolveDecisionInput) {
      return call('atelier.escalation.resolve', input);
    },
    setTaskStatus(input: SetTaskStatusInput) {
      return call('atelier.task.setStatus', input);
    },
    purgeTask(taskId: string) {
      return call('atelier.task.purge', { taskId });
    },
    async setModel(model: string) {
      snapshot = {
        ...snapshot,
        state: {
          ...snapshot.state,
          model,
        },
      };
      emit();
      return cloneSnapshot(snapshot);
    },
  };
}

function toRuntimeSnapshot(projection: AtelierProjectionSnapshot): AtelierRuntimeSnapshot {
  return fromProjectionSnapshot(projection);
}

function applyPatch(snapshot: AtelierRuntimeSnapshot, patch: AtelierProjectionPatch): AtelierRuntimeSnapshot {
  if (patch.kind === 'snapshot') return toRuntimeSnapshot(patch.snapshot);

  const state = cloneSnapshot(snapshot).state;
  switch (patch.kind) {
    case 'task.upsert': {
      const exists = state.tasks.some((task) => task.id === patch.task.id);
      state.tasks = exists
        ? state.tasks.map((task) => (task.id === patch.task.id ? patch.task : task))
        : [patch.task, ...state.tasks];
      if (patch.select) state.selectedTaskId = patch.task.id;
      break;
    }
    case 'task.status':
      state.tasks = state.tasks.map((task) =>
        task.id === patch.taskId ? { ...task, status: patch.status } : task,
      );
      break;
    case 'stream.append':
      state.stream[patch.taskId] = appendUniqueBlocks(state.stream[patch.taskId] ?? [], patch.blocks);
      break;
    case 'decision.resolved':
      state.stream[patch.taskId] = (state.stream[patch.taskId] ?? []).map((block) =>
        block.kind === 'decision' && block.id === patch.blockId
          ? { ...block, chosen: patch.choice }
          : block,
      );
      break;
    case 'artifact.upsert': {
      state.artifacts[patch.taskId] = upsertById(state.artifacts[patch.taskId] ?? [], patch.artifact);
      break;
    }
    case 'gate.upsert': {
      state.gates[patch.taskId] = upsertById(state.gates[patch.taskId] ?? [], patch.gate);
      break;
    }
    case 'context.replace':
      state.context[patch.taskId] = patch.context;
      break;
    case 'todo.replace':
      state.todos[patch.taskId] = patch.todos;
      break;
  }

  return { state, selectedTaskId: state.selectedTaskId };
}

function cloneSnapshot(snapshot: AtelierRuntimeSnapshot): AtelierRuntimeSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as AtelierRuntimeSnapshot;
}

const MAX_SEEN_EVENT_KEYS = 500;

function rememberProjectionEvent(
  event: AtelierProjectionEvent,
  seenEventKeys: Set<string>,
  seenEventOrder: string[],
): boolean {
  const key = projectionEventKey(event);
  if (seenEventKeys.has(key)) return false;

  seenEventKeys.add(key);
  seenEventOrder.push(key);

  while (seenEventOrder.length > MAX_SEEN_EVENT_KEYS) {
    const stale = seenEventOrder.shift();
    if (stale) seenEventKeys.delete(stale);
  }

  return true;
}

function projectionEventKey(event: AtelierProjectionEvent): string {
  if (event.id) return `id:${event.id}`;
  return `seq:${event.taskId ?? 'workspace'}:${event.seq}`;
}

function appendUniqueBlocks<TBlock extends { id: string }>(current: TBlock[], incoming: TBlock[]): TBlock[] {
  if (incoming.length === 0) return current;

  const existingIds = new Set(current.map((block) => block.id));
  const uniqueIncoming = incoming.filter((block) => {
    if (existingIds.has(block.id)) return false;
    existingIds.add(block.id);
    return true;
  });

  return uniqueIncoming.length > 0 ? [...current, ...uniqueIncoming] : current;
}

function upsertById<TItem extends { id: string }>(current: TItem[], incoming: TItem): TItem[] {
  const exists = current.some((item) => item.id === incoming.id);
  return exists
    ? current.map((item) => (item.id === incoming.id ? incoming : item))
    : [...current, incoming];
}
