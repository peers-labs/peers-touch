import type { AtelierProjectionSnapshot } from './projection';
import { ATELIER_PROJECTION_CONTRACT } from './projection.contract.generated';

export type ProjectionTaskIdSource =
  (typeof ATELIER_PROJECTION_CONTRACT.eventSubscription.taskIdSourcePriority)[number];

export type ProjectionStreamPayload = {
  agentId: string;
  taskId?: string;
  afterEventSeq?: number;
};

export type ProjectionTaskIdResolverInput = {
  explicitTaskId?: string;
  certificationMode?: string;
  createGoal?: string;
  selectedTaskId?: string;
  initialSnapshot?: AtelierProjectionSnapshot;
};

const projectionTaskIdResolvers = {
  certificationCreatedSelectedTaskId: ({ certificationMode, createGoal, initialSnapshot }: ProjectionTaskIdResolverInput) =>
    certificationMode === 'product-window-e2e' && typeof createGoal === 'string' && createGoal.trim().length > 0
      ? initialSnapshot?.selectedTaskId
      : undefined,
  explicitTaskId: ({ explicitTaskId }: ProjectionTaskIdResolverInput) => explicitTaskId,
  controllerSelectedTaskId: ({ selectedTaskId }: ProjectionTaskIdResolverInput) => selectedTaskId,
  snapshotSelectedTaskId: ({ initialSnapshot }: ProjectionTaskIdResolverInput) => initialSnapshot?.selectedTaskId,
  snapshotFirstTaskId: ({ initialSnapshot }: ProjectionTaskIdResolverInput) => initialSnapshot?.workspace.tasks[0]?.id,
} satisfies Record<ProjectionTaskIdSource, (input: ProjectionTaskIdResolverInput) => string | undefined>;

export function projectionTaskIdFromSubscription(input: ProjectionTaskIdResolverInput): string | undefined {
  for (const sourceKey of ATELIER_PROJECTION_CONTRACT.eventSubscription.taskIdSourcePriority) {
    const taskId = projectionTaskIdResolvers[sourceKey](input)?.trim();
    if (taskId) return taskId;
  }
  return undefined;
}

export function projectionAfterEventSeqFromSnapshot(
  snapshot: AtelierProjectionSnapshot | undefined,
  taskId: string | undefined,
): number {
  if (!snapshot || !taskId) return 0;
  const nextEventSeq = snapshot.workspace.replay?.[taskId]?.nextEventSeq;
  return isProjectionCursorNumber(nextEventSeq) && nextEventSeq > 0 ? nextEventSeq : 0;
}

export function compactProjectionStreamPayload(
  input: ProjectionStreamPayload & { preserveZeroCursor?: boolean },
): ProjectionStreamPayload | undefined {
  const agentId = input.agentId.trim();
  if (!agentId) return undefined;
  const payload: ProjectionStreamPayload = {
    agentId,
  };
  const taskId = input.taskId?.trim();
  if (taskId) payload.taskId = taskId;
  if (
    typeof input.afterEventSeq === 'number' &&
    isProjectionCursorNumber(input.afterEventSeq) &&
    (input.afterEventSeq > 0 || (input.preserveZeroCursor === true && input.afterEventSeq === 0))
  ) {
    payload.afterEventSeq = input.afterEventSeq;
  }
  return payload;
}

function isProjectionCursorNumber(value: unknown): value is number {
  return (
    ATELIER_PROJECTION_CONTRACT.eventSubscription.cursorNumberPolicy === 'safe_integer' &&
    typeof value === 'number' &&
    Number.isSafeInteger(value)
  );
}

export function buildPrototypeProjectionStreamPayload(input: {
  agentId: string;
  explicitTaskId?: string;
  certificationMode?: string;
  createGoal?: string;
  selectedTaskId?: string;
  explicitAfterEventSeq?: number;
  preserveZeroCursor?: boolean;
  initialSnapshot?: AtelierProjectionSnapshot;
}): ProjectionStreamPayload | undefined {
  const taskId = projectionTaskIdFromSubscription({
    explicitTaskId: input.explicitTaskId,
    certificationMode: input.certificationMode,
    createGoal: input.createGoal,
    selectedTaskId: input.selectedTaskId,
    initialSnapshot: input.initialSnapshot,
  });
  const afterEventSeq =
    input.explicitAfterEventSeq ?? projectionAfterEventSeqFromSnapshot(input.initialSnapshot, taskId);

  return compactProjectionStreamPayload({
    agentId: input.agentId,
    taskId,
    afterEventSeq,
    preserveZeroCursor: input.preserveZeroCursor,
  });
}
