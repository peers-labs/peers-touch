import type {
  AtelierArtifactProjection,
  AtelierGateProjection,
  AtelierProjectionEvent,
  AtelierProjectionSnapshot,
  AtelierStreamBlock,
} from '../domain/projection';

export interface AtelierProjectionRuntimeState {
  snapshot: AtelierProjectionSnapshot | null;
  selectedTaskId: string;
  seenEventKeys: string[];
  lastSeqByScope: Record<string, number>;
}

export type AtelierProjectionEventApplyOutcome =
  | 'applied'
  | 'reconcile'
  | 'gap'
  | 'duplicate'
  | 'stale'
  | 'unknown-task';

export interface AtelierProjectionEventApplyResult {
  state: AtelierProjectionRuntimeState;
  outcome: AtelierProjectionEventApplyOutcome;
}

export const MAX_ATELIER_EVENT_KEYS = 500;

export function createAtelierProjectionRuntimeState(): AtelierProjectionRuntimeState {
  return {
    snapshot: null,
    selectedTaskId: '',
    seenEventKeys: [],
    lastSeqByScope: {},
  };
}

export function stateFromAtelierSnapshot(snapshot: AtelierProjectionSnapshot): AtelierProjectionRuntimeState {
  return {
    snapshot,
    selectedTaskId: selectTaskId(snapshot, snapshot.selectedTaskId),
    seenEventKeys: [],
    lastSeqByScope: {},
  };
}

export function reconcileAtelierSnapshot(
  current: AtelierProjectionRuntimeState,
  snapshot: AtelierProjectionSnapshot,
): AtelierProjectionRuntimeState {
  return {
    snapshot,
    selectedTaskId: selectTaskId(snapshot, current.selectedTaskId),
    seenEventKeys: current.seenEventKeys,
    lastSeqByScope: current.lastSeqByScope,
  };
}

export function applyAtelierProjectionEvent(
  current: AtelierProjectionRuntimeState,
  event: AtelierProjectionEvent,
): AtelierProjectionRuntimeState {
  return applyAtelierProjectionEventWithResult(current, event).state;
}

export function applyAtelierProjectionEventWithResult(
  current: AtelierProjectionRuntimeState,
  event: AtelierProjectionEvent,
): AtelierProjectionEventApplyResult {
  if (hasSeenEvent(current, event)) return { state: current, outcome: 'duplicate' };
  if (isStaleEvent(current, event)) return { state: current, outcome: 'stale' };
  if (!canApplyPatchToKnownTask(current.snapshot, event.patch)) return { state: current, outcome: 'unknown-task' };

  const gap = hasSequenceGap(current, event);
  const invalidatesSnapshot = event.patch.kind === 'snapshot.invalidate';
  const snapshot = gap || invalidatesSnapshot
    ? current.snapshot
    : applyAtelierProjectionPatch(current.snapshot, event);
  const preferredSelectedTaskId =
    event.patch.kind === 'task.upsert' && event.patch.select
      ? event.patch.task.id
      : current.selectedTaskId;
  const selectedTaskId = snapshot ? selectTaskId(snapshot, preferredSelectedTaskId) : current.selectedTaskId;
  const scope = eventScope(event);

  return {
    state: {
      snapshot,
      selectedTaskId,
      seenEventKeys: rememberEventKey(current.seenEventKeys, eventKey(event)),
      lastSeqByScope: {
        ...current.lastSeqByScope,
        [scope]: event.seq,
      },
    },
    outcome: gap ? 'gap' : invalidatesSnapshot ? 'reconcile' : 'applied',
  };
}

function applyAtelierProjectionPatch(
  current: AtelierProjectionSnapshot | null,
  event: AtelierProjectionEvent,
): AtelierProjectionSnapshot | null {
  const patch = event.patch;
  if (patch.kind === 'snapshot') return cloneSnapshot(patch.snapshot);
  if (!current) return current;

  const next = cloneSnapshot(current);
  switch (patch.kind) {
    case 'snapshot.invalidate':
      break;
    case 'task.upsert': {
      const exists = next.workspace.tasks.some((task) => task.id === patch.task.id);
      next.workspace.tasks = exists
        ? next.workspace.tasks.map((task) => (task.id === patch.task.id ? patch.task : task))
        : [patch.task, ...next.workspace.tasks];
      if (patch.select) next.selectedTaskId = patch.task.id;
      break;
    }
    case 'task.status':
      next.workspace.tasks = next.workspace.tasks.map((task) =>
        task.id === patch.taskId ? { ...task, status: patch.status } : task,
      );
      break;
    case 'stream.append':
      next.workspace.streams[patch.taskId] = appendUniqueById(
        next.workspace.streams[patch.taskId] ?? [],
        patch.blocks,
      );
      break;
    case 'decision.resolved':
      next.workspace.streams[patch.taskId] = (next.workspace.streams[patch.taskId] ?? []).map((block) =>
        block.kind === 'decision' && block.id === patch.blockId
          ? { ...block, chosen: patch.choice }
          : block,
      );
      break;
    case 'artifact.upsert':
      next.workspace.artifacts[patch.taskId] = upsertById(
        next.workspace.artifacts[patch.taskId] ?? [],
        patch.artifact,
      );
      break;
    case 'gate.upsert':
      next.workspace.gates = next.workspace.gates ?? {};
      next.workspace.gates[patch.taskId] = upsertById(next.workspace.gates[patch.taskId] ?? [], patch.gate);
      break;
    case 'context.replace':
      next.workspace.contexts[patch.taskId] = patch.context;
      break;
    case 'todo.replace':
      next.workspace.todos[patch.taskId] = patch.todos;
      break;
    default:
      assertNever(patch);
  }

  return next;
}

function canApplyPatchToKnownTask(
  current: AtelierProjectionSnapshot | null,
  patch: AtelierProjectionEvent['patch'],
): boolean {
  if (
    patch.kind === 'snapshot'
    || patch.kind === 'snapshot.invalidate'
    || patch.kind === 'task.upsert'
  ) return true;
  if (!current) return true;
  return current.workspace.tasks.some((task) => task.id === patch.taskId);
}

function hasSeenEvent(current: AtelierProjectionRuntimeState, event: AtelierProjectionEvent): boolean {
  return current.seenEventKeys.includes(eventKey(event));
}

function isStaleEvent(current: AtelierProjectionRuntimeState, event: AtelierProjectionEvent): boolean {
  const lastSeq = current.lastSeqByScope[eventScope(event)];
  return lastSeq !== undefined && event.seq <= lastSeq;
}

function hasSequenceGap(current: AtelierProjectionRuntimeState, event: AtelierProjectionEvent): boolean {
  const lastSeq = current.lastSeqByScope[eventScope(event)];
  return lastSeq !== undefined && event.seq > lastSeq + 1;
}

function rememberEventKey(keys: string[], key: string): string[] {
  const next = [...keys, key];
  return next.length > MAX_ATELIER_EVENT_KEYS ? next.slice(next.length - MAX_ATELIER_EVENT_KEYS) : next;
}

function eventKey(event: AtelierProjectionEvent): string {
  return event.id ? `id:${event.id}` : `seq:${eventScope(event)}:${event.seq}`;
}

function eventScope(event: AtelierProjectionEvent): string {
  if (event.patch.kind === 'snapshot.invalidate') {
    return event.patch.taskId
      ? `task:${event.patch.taskId}`
      : `goal:${event.patch.goalId}`;
  }
  return event.taskId ?? 'workspace';
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Atelier projection patch: ${JSON.stringify(value)}`);
}

function selectTaskId(snapshot: AtelierProjectionSnapshot, preferredTaskId: string): string {
  if (preferredTaskId && snapshot.workspace.tasks.some((task) => task.id === preferredTaskId)) return preferredTaskId;
  return snapshot.selectedTaskId || snapshot.workspace.tasks[0]?.id || '';
}

function appendUniqueById<TItem extends AtelierStreamBlock>(current: TItem[], incoming: TItem[]): TItem[] {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map((item) => item.id));
  const unique = incoming.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return unique.length > 0 ? [...current, ...unique] : current;
}

function upsertById<TItem extends AtelierArtifactProjection | AtelierGateProjection>(
  current: TItem[],
  incoming: TItem,
): TItem[] {
  return current.some((item) => item.id === incoming.id)
    ? current.map((item) => (item.id === incoming.id ? incoming : item))
    : [...current, incoming];
}

function cloneSnapshot(snapshot: AtelierProjectionSnapshot): AtelierProjectionSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as AtelierProjectionSnapshot;
}
