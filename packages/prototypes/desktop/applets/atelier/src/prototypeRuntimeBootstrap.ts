import type { CreateAppletSdkAtelierBridgeOptions } from './appletBridge';
import {
  ATELIER_DEFAULT_DIRECT_RUN_MODEL,
  ATELIER_PROJECTION_CONTRACT,
} from './projection.contract.generated';
import type { AtelierProjectionSnapshot } from './projection';
import type { AtelierState } from './types';

export const ATELIER_PROTOTYPE_HOST_RUNTIMES = ['lynx', 'web-host'] as const;

export type PrototypeProjectionStreamConfig = CreateAppletSdkAtelierBridgeOptions['projectionStream'];
type ProjectionTaskIdSource = (typeof ATELIER_PROJECTION_CONTRACT.eventSubscription.taskIdSourcePriority)[number];

type ProjectionStreamTaskContext = {
  initialSnapshot?: AtelierProjectionSnapshot;
  selectedTaskId?: string;
};

export function isPrototypeHostRuntime(runtime: string): boolean {
  return ATELIER_PROTOTYPE_HOST_RUNTIMES.includes(runtime as (typeof ATELIER_PROTOTYPE_HOST_RUNTIMES)[number]);
}

export function buildPrototypeEmptyHostState(): AtelierState {
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

export function buildPrototypeProjectionStreamConfig(input: {
  globalConfig?: unknown;
  search?: string;
  initialSnapshot?: AtelierProjectionSnapshot;
  selectedTaskId?: string;
}): PrototypeProjectionStreamConfig {
  const context = {
    initialSnapshot: input.initialSnapshot,
    selectedTaskId: input.selectedTaskId,
  };
  const normalizedGlobalConfig = normalizePrototypeProjectionStreamConfig(input.globalConfig, context);
  if (normalizedGlobalConfig) return normalizedGlobalConfig;
  if (input.search === undefined) return undefined;

  const params = new URLSearchParams(input.search);
  return normalizePrototypeProjectionStreamConfig({
    agentId: params.get('agentId'),
    agentIds: params.getAll('agentIds'),
    taskId: params.get('taskId'),
    certificationMode: params.get('certificationMode'),
    createGoal: params.get('createGoal'),
    afterEventSeq: params.get('afterEventSeq'),
  }, context);
}

export function normalizePrototypeProjectionStreamConfig(
  input: unknown,
  taskContext: ProjectionStreamTaskContext = {},
): PrototypeProjectionStreamConfig {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  const agentId = resolvePrototypeProjectionStreamAgentId(record);
  if (!agentId) return undefined;
  const taskId = resolvePrototypeProjectionStreamTaskId(record, taskContext);
  const preserveZeroCursor = shouldPreserveExplicitZeroCursor(record);
  const afterEventSeq = normalizeAfterEventSeq(record.afterEventSeq, preserveZeroCursor);
  return {
    agentId,
    ...(taskId ? { taskId } : {}),
    ...(afterEventSeq !== undefined ? { afterEventSeq } : {}),
    ...(afterEventSeq === 0 && preserveZeroCursor ? { preserveZeroCursor: true } : {}),
  };
}

function resolvePrototypeProjectionStreamAgentId(record: Record<string, unknown>): string {
  for (const source of ATELIER_PROJECTION_CONTRACT.eventSubscription.agentIdSourcePriority) {
    if (source === 'agentId' && typeof record.agentId === 'string') {
      const agentId = record.agentId.trim();
      if (agentId) return agentId;
    }
    if (source === 'agentIds[0]' && Array.isArray(record.agentIds) && typeof record.agentIds[0] === 'string') {
      const agentId = record.agentIds[0].trim();
      if (agentId) return agentId;
    }
  }
  return '';
}

const projectionTaskIdResolvers = {
  certificationCreatedSelectedTaskId: ({ record, initialSnapshot }: ProjectionStreamTaskContext & { record: Record<string, unknown> }) =>
    record.certificationMode === 'product-window-e2e' &&
    typeof record.createGoal === 'string' &&
    record.createGoal.trim().length > 0
      ? initialSnapshot?.selectedTaskId
      : undefined,
  explicitTaskId: ({ record }: ProjectionStreamTaskContext & { record: Record<string, unknown> }) =>
    typeof record.taskId === 'string' ? record.taskId : undefined,
  controllerSelectedTaskId: ({ selectedTaskId }: ProjectionStreamTaskContext & { record: Record<string, unknown> }) =>
    selectedTaskId,
  snapshotSelectedTaskId: ({ initialSnapshot }: ProjectionStreamTaskContext & { record: Record<string, unknown> }) =>
    initialSnapshot?.selectedTaskId,
  snapshotFirstTaskId: ({ initialSnapshot }: ProjectionStreamTaskContext & { record: Record<string, unknown> }) =>
    initialSnapshot?.workspace.tasks[0]?.id,
} satisfies Record<ProjectionTaskIdSource, (input: ProjectionStreamTaskContext & { record: Record<string, unknown> }) => string | undefined>;

function resolvePrototypeProjectionStreamTaskId(
  record: Record<string, unknown>,
  context: ProjectionStreamTaskContext,
): string {
  const input = { ...context, record };
  for (const source of ATELIER_PROJECTION_CONTRACT.eventSubscription.taskIdSourcePriority) {
    const taskId = projectionTaskIdResolvers[source](input)?.trim();
    if (taskId) return taskId;
  }
  return '';
}

function shouldPreserveExplicitZeroCursor(record: Record<string, unknown>): boolean {
  const exception = ATELIER_PROJECTION_CONTRACT.eventSubscription.zeroCursorException;
  return (
    exception.explicitZeroCursorPolicy === 'preserve' &&
    record.certificationMode === exception.certificationMode
  );
}

function normalizeAfterEventSeq(value: unknown, preserveExplicitZeroCursor = false): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : undefined;
  return isProjectionCursorNumber(parsed) && (parsed > 0 || (preserveExplicitZeroCursor && parsed === 0))
    ? parsed
    : undefined;
}

function isProjectionCursorNumber(value: unknown): value is number {
  return (
    ATELIER_PROJECTION_CONTRACT.eventSubscription.cursorNumberPolicy === 'safe_integer' &&
    typeof value === 'number' &&
    Number.isSafeInteger(value)
  );
}
