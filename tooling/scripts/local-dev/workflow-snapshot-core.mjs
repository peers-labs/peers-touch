import {
  validateWorkflowBindingProjection,
} from './workflow-binding-projection.mjs';

export function projectStages(planStatus) {
  const terminal = ['completed', 'superseded'].includes(planStatus);
  const executeState =
    terminal
      ? 'done'
      : planStatus === 'blocked'
        ? 'blocked'
        : planStatus === 'active'
          ? 'active'
          : 'pending';
  return [
    { id: 'PRODUCT', state: 'done' },
    { id: 'DESIGN', state: 'done' },
    { id: 'PLAN', state: 'done' },
    { id: 'EXECUTE', state: executeState },
    {
      id: 'DELIVER',
      state:
        planStatus === 'completed'
          ? 'active'
          : planStatus === 'superseded'
            ? 'not_required'
            : 'pending',
    },
  ];
}

export function projectWorkflowContext(binding, inspection) {
  validateWorkflowBindingProjection(binding);
  const tasks = inspection.planPackage?.manifest?.tasks ?? [];
  const completed = tasks.filter((task) => task.status === 'done').length;
  const total = tasks.length;
  const current = tasks.find((task) => task.status === 'in_progress') ?? null;
  const planStatus = inspection.planPackage?.manifest?.status ?? null;
  const sessionState = inspection.session?.state?.state ?? null;
  const drift = inspection.status === 'HARD_BLOCK';
  const blocked =
    planStatus === 'blocked' ||
    ['BLOCKED', 'FAILED', 'STALE'].includes(sessionState);
  const complete =
    ['completed', 'superseded'].includes(planStatus) ||
    (inspection.status === 'READY' && inspection.tracked === false);
  return {
    verdict: drift ? 'DRIFT' : blocked ? 'BLOCKED' : 'HEALTHY',
    continuation: drift || blocked
      ? 'HARD_BLOCK'
      : complete
        ? 'COMPLETE'
        : 'CONTINUE',
    workspaceId: binding.workspaceId,
    branch: inspection.branch ?? null,
    head: inspection.head ?? null,
    initialHead: inspection.planPackage?.manifest?.binding?.initialHead ?? null,
    planId: inspection.binding?.planId ?? null,
    planPath: inspection.binding?.planPath ?? null,
    planStatus,
    stages: planStatus ? projectStages(planStatus) : [],
    progress: {
      completed,
      total,
      percentage:
        total === 0 ? 0 : Math.round((10000 * completed) / total) / 100,
    },
    taskId:
      inspection.currentTask?.taskId ??
      current?.id ??
      inspection.declaration?.taskId ??
      null,
    sessionState,
    workItemId: inspection.declaration?.workItemId ?? null,
    binding: {
      role: binding.role,
      bindingDigest: binding.bindingDigest,
      rootBindingDigest: binding.rootBindingDigest,
      parentBindingDigest: binding.parentBindingDigest,
      assignmentDigest: binding.assignmentDigest,
      released: binding.released,
      childState: binding.childState,
    },
  };
}
