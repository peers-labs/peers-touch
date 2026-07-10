import type { AtelierRuntimeSnapshot } from './runtime';
import type {
  AtelierProjectionEvent,
  AtelierProjectionPatch,
} from './projection';
import { fromProjectionSnapshot } from './projection';
import { ATELIER_VIEW_SURFACE } from './projection.contract.generated';

export const MAX_PROTOTYPE_BRIDGE_PROJECTION_EVENT_KEYS = 500;

export interface PrototypeBridgeProjectionEventMemory {
  seenEventKeys: Set<string>;
  seenEventOrder: string[];
  lastSeqByScope: Map<string, number>;
}

export function createPrototypeBridgeProjectionEventMemory(): PrototypeBridgeProjectionEventMemory {
  return {
    seenEventKeys: new Set<string>(),
    seenEventOrder: [],
    lastSeqByScope: new Map<string, number>(),
  };
}

export function applyPrototypeBridgeProjectionPatch(
  snapshot: AtelierRuntimeSnapshot,
  patch: AtelierProjectionPatch,
): AtelierRuntimeSnapshot {
  const ownedPatch = cloneProjectionPatch(patch);

  if (ownedPatch.kind === 'snapshot') {
    return cloneSnapshot(fromProjectionSnapshot(ownedPatch.snapshot));
  }

  const state = cloneSnapshot(snapshot).state;
  switch (ownedPatch.kind) {
    case 'task.upsert': {
      const exists = state.tasks.some((task) => task.id === ownedPatch.task.id);
      state.tasks = exists
        ? state.tasks.map((task) => (task.id === ownedPatch.task.id ? ownedPatch.task : task))
        : [ownedPatch.task, ...state.tasks];
      if (ownedPatch.select) state.selectedTaskId = ownedPatch.task.id;
      break;
    }
    case 'task.status':
      state.tasks = state.tasks.map((task) =>
        task.id === ownedPatch.taskId ? { ...task, status: ownedPatch.status } : task,
      );
      break;
    case 'stream.append':
      state.stream[ownedPatch.taskId] = appendUniqueBlocks(state.stream[ownedPatch.taskId] ?? [], ownedPatch.blocks);
      break;
    case 'decision.resolved':
      state.stream[ownedPatch.taskId] = (state.stream[ownedPatch.taskId] ?? []).map((block) =>
        block.kind === 'decision' && block.id === ownedPatch.blockId
          ? { ...block, chosen: ownedPatch.choice }
          : block,
      );
      break;
    case 'artifact.upsert':
      state.artifacts[ownedPatch.taskId] = upsertById(state.artifacts[ownedPatch.taskId] ?? [], ownedPatch.artifact);
      break;
    case 'gate.upsert':
      state.gates[ownedPatch.taskId] = upsertById(state.gates[ownedPatch.taskId] ?? [], ownedPatch.gate);
      break;
    case 'context.replace':
      state.context[ownedPatch.taskId] = ownedPatch.context;
      break;
    case 'todo.replace':
      state.todos[ownedPatch.taskId] = ownedPatch.todos;
      break;
    default:
      assertNever(ownedPatch);
  }

  return { state, selectedTaskId: state.selectedTaskId };
}

export function canApplyPrototypeBridgeProjectionPatch(
  snapshot: AtelierRuntimeSnapshot,
  patch: AtelierProjectionPatch,
): boolean {
  if (patch.kind === 'snapshot' || patch.kind === 'task.upsert') return true;
  return snapshot.state.tasks.some((task) => task.id === patch.taskId);
}

export function rememberPrototypeBridgeProjectionEvent(
  event: AtelierProjectionEvent,
  memory: Pick<PrototypeBridgeProjectionEventMemory, 'seenEventKeys' | 'seenEventOrder'>,
): boolean {
  const key = prototypeBridgeProjectionEventKey(event);
  if (memory.seenEventKeys.has(key)) return false;

  memory.seenEventKeys.add(key);
  memory.seenEventOrder.push(key);

  while (memory.seenEventOrder.length > MAX_PROTOTYPE_BRIDGE_PROJECTION_EVENT_KEYS) {
    const stale = memory.seenEventOrder.shift();
    if (stale) memory.seenEventKeys.delete(stale);
  }

  return true;
}

export function rememberPrototypeBridgeProjectionSeq(
  event: AtelierProjectionEvent,
  memory: Pick<PrototypeBridgeProjectionEventMemory, 'lastSeqByScope'>,
): boolean {
  const scope = event.taskId ?? 'workspace';
  const lastSeq = memory.lastSeqByScope.get(scope);
  if (lastSeq !== undefined && event.seq <= lastSeq) return false;
  memory.lastSeqByScope.set(scope, event.seq);
  return true;
}

export function prototypeBridgeProjectionEventKey(event: AtelierProjectionEvent): string {
  if (event.id) return `id:${event.id}`;
  return `seq:${event.taskId ?? 'workspace'}:${event.seq}`;
}

export function prototypeBridgeProjectionSubscriptionRejectedError(value: unknown): Error | undefined {
  if (!isRecord(value) || value.kind !== 'atelier.projection.subscription-rejected') {
    return undefined;
  }
  const method = typeof value.method === 'string' && value.method.length > 0
    ? value.method
    : 'unknown';
  const reason = typeof value.reason === 'string' && value.reason.length > 0
    ? sanitizePrototypeProjectionSubscriptionReason(value.reason)
    : 'unknown rejection';
  const sanitizedCause: Record<string, unknown> = {
    kind: 'atelier.projection.subscription-rejected',
    method,
    reason,
  };
  const code = typeof value.code === 'string' && value.code.length > 0
    ? sanitizePrototypeProjectionSubscriptionCode(value.code)
    : undefined;
  if (code) {
    sanitizedCause.code = code;
  }
  return new Error(`Atelier projection stream subscription ${method} rejected: ${reason}`, {
    cause: sanitizedCause,
  });
}

const forbiddenPrototypeProjectionSubscriptionReasonPatterns = [
  /provider\.invoke/i,
  /providerInvoke/i,
  /runtime\.execute/i,
  /runtimeExecute/i,
  /shell/i,
  /shellExecute/i,
  /memory\.write/i,
  /input_snapshot/i,
  /run\.execute/i,
];

function sanitizePrototypeProjectionSubscriptionReason(reason: string): string {
  if (!reason.trim()) return 'Host projection subscription rejected';
  if (forbiddenPrototypeProjectionSubscriptionReasonPatterns.some((pattern) => pattern.test(reason))) {
    return 'Host projection subscription rejected';
  }
  return reason;
}

function sanitizePrototypeProjectionSubscriptionCode(code: string): string | undefined {
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) return undefined;
  return Object.prototype.hasOwnProperty.call(
    ATELIER_VIEW_SURFACE.bridgeRuntimeRecoveryCodeKindByCode,
    normalizedCode,
  )
    ? normalizedCode
    : undefined;
}

function cloneSnapshot(snapshot: AtelierRuntimeSnapshot): AtelierRuntimeSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as AtelierRuntimeSnapshot;
}

function cloneProjectionPatch(patch: AtelierProjectionPatch): AtelierProjectionPatch {
  return JSON.parse(JSON.stringify(patch)) as AtelierProjectionPatch;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Atelier projection patch: ${JSON.stringify(value)}`);
}
