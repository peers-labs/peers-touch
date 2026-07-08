import type { Artifact, AtelierState, Block, BudgetProjection, GateResult, Task, TaskContext, TaskStatus, TodoItem } from './types';
import type {
  AtelierRunTarget,
  ConfirmMemoryCandidateInput,
  ConfirmMemoryCandidateResponse,
  ConfirmRerunInput,
  ConfirmRerunResponse,
  FetchArtifactBodyInput,
  FetchArtifactBodyResponse,
  AtelierProviderCapabilitiesResponse,
  CreateProjectFromGoalInput,
  ListProviderCapabilitiesInput,
  OpenArtifactPreviewInput,
  OpenArtifactPreviewResponse,
  OpenWorkspaceInput,
  OpenWorkspaceResponse,
  ResolveDecisionInput,
  SendMessageInput,
  SetTaskStatusInput,
  SubmitFeedbackInput,
  SubmitFeedbackResponse,
} from './runtime';
import {
  ATELIER_ARTIFACT_FORBIDDEN_BODY_FIELDS,
  ATELIER_ARTIFACT_BODY_REF_SHAPE,
  ATELIER_ARTIFACT_BODY_KINDS,
  ATELIER_ARTIFACT_KINDS,
  ATELIER_ARTIFACT_SANDBOX_REF_SHAPE,
  ATELIER_ARTIFACT_PREVIEW_HINTS,
  ATELIER_ARTIFACT_PREVIEW_TARGET_FIELDS,
  ATELIER_ARTIFACT_PREVIEW_TARGET_MODES,
  ATELIER_BUDGET_STATUSES,
  ATELIER_BLOCKER_SEVERITIES,
  ATELIER_BLOCKER_STATES,
  ATELIER_DEFECT_SOURCES,
  ATELIER_DEFECT_STATES,
  ATELIER_DEPENDENCY_EDGE_TYPES,
  ATELIER_DIFF_STREAM_SUMMARY_FIELDS,
  ATELIER_DEFAULT_AGENT_FLOW_ID,
  ATELIER_DEFAULT_DIRECT_RUN_MODEL,
  ATELIER_MEMORY_CANDIDATE_FEEDS,
  ATELIER_MEMORY_CANDIDATE_SCOPES,
  ATELIER_MEMORY_CANDIDATE_TYPES,
  ATELIER_MILESTONE_STATES,
  ATELIER_POLICY_RULE_SCOPES,
  ATELIER_PROJECTION_CONTRACT,
  ATELIER_CONTEXT_FILE_GROUPS,
  ATELIER_GATE_CHECK_STATUSES,
  ATELIER_GATE_STATUSES,
  ATELIER_PROJECT_STATES,
  ATELIER_RESIDUAL_RISK_STATES,
  ATELIER_STREAM_BLOCK_KINDS,
  ATELIER_STREAM_BLOCK_REQUIRED_FIELDS_BY_KIND,
  ATELIER_TASK_INTENT_PRESETS,
  ATELIER_TASK_GRAPH_NODE_STATES,
  ATELIER_TASK_GRAPH_PARALLEL_POLICIES,
  ATELIER_TASK_LIFECYCLE_STATES,
  ATELIER_TODO_STATUSES,
  ATELIER_WORKSPACE_OPEN_URI_SHAPE,
  ATELIER_WORKSPACE_OPEN_URI_SCHEMES,
  type AtelierBudgetStatus,
  type AtelierProjectionVersion,
} from './projection.contract.generated';

export const ATELIER_PROJECTION_VERSION: AtelierProjectionVersion = ATELIER_PROJECTION_CONTRACT.version;

export const ATELIER_RUNTIME_METHODS = ATELIER_PROJECTION_CONTRACT.runtimeMethods;

export const ATELIER_PROJECTION_PATCH_KINDS = ATELIER_PROJECTION_CONTRACT.patchKinds;

export interface AtelierProjectionSnapshot {
  version: AtelierProjectionVersion;
  workspace: AtelierWorkspaceProjection;
  selectedTaskId: string;
}

export interface AtelierWorkspaceProjection {
  budgetSpent: number;
  budgetCap: number;
  budget?: BudgetProjection;
  model: string;
  tasks: Task[];
  projects?: AtelierProjectProjection[];
  streams: Record<string, Block[]>;
  todos: Record<string, TodoItem[]>;
  contexts: Record<string, TaskContext>;
  artifacts: Record<string, Artifact[]>;
  gates?: Record<string, GateResult[]>;
  replay?: Record<string, AtelierReplayState>;
}

export interface AtelierProjectProjection {
  id: string;
  goal: string;
  title: string;
  state: string;
  workspaceRef: string;
  traceRoot?: string;
  goalOwnerSignoff: boolean;
  residualRisks: AtelierResidualRisk[];
  openBlockers: AtelierProjectBlocker[];
  memoryCandidates: AtelierMemoryCandidateRef[];
  completion: AtelierProjectCompletion;
  milestoneTree: AtelierMilestoneTree;
  taskGraph: AtelierTaskGraph;
  policy?: AtelierPolicyProjection;
  defects: AtelierDefectProjection[];
}

export interface AtelierProjectCompletion {
  noOpenBlockers: boolean;
  l0L1AcceptancePassed: boolean;
  l2HumanSignoffComplete: boolean;
  residualRisksLogged: boolean;
  memoryCandidatesGenerated: boolean;
}

export interface AtelierProjectBlocker {
  id: string;
  owner: string;
  severity: string;
  state: string;
  evidenceRef: string;
  reason: string;
}

export interface AtelierResidualRisk {
  id: string;
  desc: string;
  state: string;
  evidenceRef: string;
  owner: string;
}

export interface AtelierMemoryCandidateRef {
  id: string;
  type: string;
  content: string;
  evidenceRefs: string[];
  scope: string;
  confirmed: boolean;
  feeds: string[];
}

export interface AtelierMilestoneTree {
  rootId: string;
  milestones: AtelierMilestoneProjection[];
  edges: AtelierDependencyEdge[];
}

export interface AtelierMilestoneProjection {
  id: string;
  title: string;
  state: string;
  taskIds: string[];
  acceptancePredicateIds: string[];
  openBlockers: AtelierProjectBlocker[];
}

export interface AtelierTaskGraph {
  rootTaskIds: string[];
  tasks: AtelierTaskNodeProjection[];
  edges: AtelierDependencyEdge[];
  parallelPolicy: string;
}

export interface AtelierTaskNodeProjection {
  id: string;
  title: string;
  state: string;
  agentRole: string;
  artifactIds: string[];
  gateIds: string[];
}

export interface AtelierDependencyEdge {
  from: string;
  to: string;
  type: string;
}

export interface AtelierPolicyProjection {
  id: string;
  rules: AtelierPolicyRule[];
  hardDeny: boolean;
}

export interface AtelierPolicyRule {
  id: string;
  scope: string;
  expr: string;
  severity: string;
}

export interface AtelierDefectProjection {
  id: string;
  taskId: string;
  source: string;
  state: string;
  evidenceRef: string;
  proposal: AtelierDefectProposal;
}

export interface AtelierDefectProposal {
  summary: string;
  expectedChange: string;
  targetRefs: string[];
}

export interface AtelierReplayState {
  source: 'event-window' | 'checkpoint-anchor+event-window' | string;
  eventCount: number;
  replayedEventCount: number;
  nextEventSeq: number;
  hasMore: boolean;
  checkpointId?: string;
  checkpointEventSeq?: number;
}

export type AtelierProjectionPatch =
  | { kind: 'snapshot'; snapshot: AtelierProjectionSnapshot }
  | { kind: 'task.upsert'; task: Task; select?: boolean }
  | { kind: 'task.status'; taskId: string; status: TaskStatus }
  | { kind: 'stream.append'; taskId: string; blocks: Block[] }
  | { kind: 'decision.resolved'; taskId: string; blockId: string; choice: string }
  | { kind: 'artifact.upsert'; taskId: string; artifact: Artifact }
  | { kind: 'gate.upsert'; taskId: string; gate: GateResult }
  | { kind: 'context.replace'; taskId: string; context: TaskContext }
  | { kind: 'todo.replace'; taskId: string; todos: TodoItem[] };

export type AtelierRuntimeMethod =
  (typeof ATELIER_RUNTIME_METHODS)[number];

export type AtelierRuntimePayloadByMethod = {
  'atelier.workspace.load': Record<string, never>;
  'atelier.project.createFromGoal': CreateProjectFromGoalInput;
  'atelier.message.send': SendMessageInput;
  'atelier.escalation.resolve': ResolveDecisionInput;
  'atelier.task.setStatus': SetTaskStatusInput;
  'atelier.task.purge': { taskId: string };
  'atelier.provider.capabilities': ListProviderCapabilitiesInput;
  'atelier.feedback.submit': SubmitFeedbackInput;
  'atelier.memory.confirmCandidate': ConfirmMemoryCandidateInput;
  'atelier.feedback.confirmRerun': ConfirmRerunInput;
  'atelier.workspace.open': OpenWorkspaceInput;
  'atelier.artifact.body.fetch': FetchArtifactBodyInput;
  'atelier.artifact.preview.open': OpenArtifactPreviewInput;
};

export type AtelierRuntimeResponseByMethod = {
  'atelier.workspace.load': AtelierProjectionSnapshot;
  'atelier.project.createFromGoal': AtelierProjectionSnapshot;
  'atelier.message.send': AtelierProjectionSnapshot;
  'atelier.escalation.resolve': AtelierProjectionSnapshot;
  'atelier.task.setStatus': AtelierProjectionSnapshot;
  'atelier.task.purge': AtelierProjectionSnapshot;
  'atelier.provider.capabilities': AtelierProviderCapabilitiesResponse;
  'atelier.feedback.submit': SubmitFeedbackResponse;
  'atelier.memory.confirmCandidate': ConfirmMemoryCandidateResponse;
  'atelier.feedback.confirmRerun': ConfirmRerunResponse;
  'atelier.workspace.open': OpenWorkspaceResponse;
  'atelier.artifact.body.fetch': FetchArtifactBodyResponse;
  'atelier.artifact.preview.open': OpenArtifactPreviewResponse;
};

export interface AtelierRuntimeCall<M extends AtelierRuntimeMethod = AtelierRuntimeMethod> {
  method: M;
  payload: AtelierRuntimePayloadByMethod[M];
}

export interface AtelierProjectionEvent {
  id: string;
  seq: number;
  taskId?: string;
  patch: AtelierProjectionPatch;
  receivedAt: string;
}

export function toProjectionSnapshot(state: AtelierState, selectedTaskId = state.selectedTaskId): AtelierProjectionSnapshot {
  return {
    version: ATELIER_PROJECTION_VERSION,
    selectedTaskId,
    workspace: {
      budgetSpent: state.budgetSpent,
      budgetCap: state.budgetCap,
      budget: state.budget,
      model: state.model,
      tasks: state.tasks,
      projects: state.projects,
      streams: state.stream,
      todos: state.todos,
      contexts: state.context,
      artifacts: state.artifacts,
      gates: state.gates,
    },
  };
}

export function fromProjectionSnapshot(snapshot: AtelierProjectionSnapshot): { state: AtelierState; selectedTaskId: string } {
  return {
    selectedTaskId: snapshot.selectedTaskId,
    state: {
      budgetSpent: snapshot.workspace.budgetSpent,
      budgetCap: snapshot.workspace.budgetCap,
      budget: snapshot.workspace.budget,
      model: snapshot.workspace.model,
      tasks: snapshot.workspace.tasks,
      projects: snapshot.workspace.projects,
      selectedTaskId: snapshot.selectedTaskId,
      stream: snapshot.workspace.streams,
      todos: snapshot.workspace.todos,
      context: snapshot.workspace.contexts,
      artifacts: snapshot.workspace.artifacts,
      gates: snapshot.workspace.gates ?? {},
    },
  };
}

export function runTargetLabel(run: AtelierRunTarget) {
  return run.kind === 'agents'
    ? run.flowId ?? ATELIER_DEFAULT_AGENT_FLOW_ID
    : run.model ?? ATELIER_DEFAULT_DIRECT_RUN_MODEL;
}

export function assertAtelierProjectionSnapshot(value: unknown): AtelierProjectionSnapshot {
  if (!isProjectionSnapshot(value)) {
    throw new Error('Invalid Atelier projection snapshot');
  }
  return value;
}

export function parseAtelierProjectionEvent(value: unknown): AtelierProjectionEvent | null {
  if (typeof value === 'string') {
    try {
      return parseAtelierProjectionEvent(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }

  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || value.id.trim() === '') return null;
  if (!isFiniteNumber(value.seq) || value.seq < 0) return null;
  if (typeof value.receivedAt !== 'string' || value.receivedAt.trim() === '') return null;
  if (value.taskId !== undefined && !isNonEmptyString(value.taskId)) return null;
  if (!isProjectionPatch(value.patch)) return null;
  if (!isProjectionEventTaskScopeConsistent(value.taskId, value.patch)) return null;

  return value as unknown as AtelierProjectionEvent;
}

export function isAtelierRuntimeMethod(method: string): method is AtelierRuntimeMethod {
  return (ATELIER_RUNTIME_METHODS as readonly string[]).includes(method);
}

function isProjectionSnapshot(value: unknown): value is AtelierProjectionSnapshot {
  if (!isObject(value)) return false;
  if (value.version !== ATELIER_PROJECTION_VERSION) return false;
  if (typeof value.selectedTaskId !== 'string') return false;
  if (!isObject(value.workspace)) return false;

  const workspace = value.workspace;
  if (!Array.isArray(workspace.tasks) || !workspace.tasks.every(isTaskProjection)) return false;
  const taskIds = new Set(workspace.tasks.map((task) => task.id));
  return (
    isSnapshotSelectedTaskId(value.selectedTaskId, taskIds) &&
    isFiniteNumber(workspace.budgetSpent) &&
    isFiniteNumber(workspace.budgetCap) &&
    (workspace.budget === undefined || isBudgetProjection(workspace.budget)) &&
    typeof workspace.model === 'string' &&
    (workspace.projects === undefined ||
      (Array.isArray(workspace.projects) && workspace.projects.every(isProjectProjection))) &&
    isKnownTaskRecordList(workspace.streams, taskIds, isStreamBlock) &&
    isKnownTaskRecordList(workspace.todos, taskIds, isTodoItem) &&
    isKnownTaskRecordValue(workspace.contexts, taskIds, isTaskContext) &&
    isKnownTaskArtifactRecordList(workspace.artifacts, taskIds) &&
    (workspace.gates === undefined || isKnownTaskRecordList(workspace.gates, taskIds, isGateResultProjection)) &&
    (workspace.replay === undefined || isReplayRecord(workspace.replay, taskIds))
  );
}

function isSnapshotSelectedTaskId(selectedTaskId: string, taskIds: ReadonlySet<string>): boolean {
  return selectedTaskId === '' || taskIds.has(selectedTaskId);
}

function isBudgetProjection(value: unknown): value is BudgetProjection {
  return (
    isObject(value) &&
    isBudgetStatus(value.status) &&
    isNonEmptyString(value.summary) &&
    Array.isArray(value.dimensions) &&
    value.dimensions.length > 0 &&
    value.dimensions.every(isBudgetDimensionProjection) &&
    (value.decisionHint === undefined || typeof value.decisionHint === 'string')
  );
}

function isBudgetDimensionProjection(value: unknown): value is BudgetProjection['dimensions'][number] {
  return (
    isObject(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.label) &&
    isNonNegativeFiniteNumber(value.used) &&
    isNonNegativeFiniteNumber(value.cap) &&
    isNonEmptyString(value.unit) &&
    isNonNegativeFiniteNumber(value.percent) &&
    value.percent <= 100 &&
    isBudgetStatus(value.status)
  );
}

function isBudgetStatus(value: unknown): value is BudgetProjection['status'] {
  return typeof value === 'string' && ATELIER_BUDGET_STATUSES.includes(value as AtelierBudgetStatus);
}

function isProjectProjection(value: unknown): value is AtelierProjectProjection {
  return (
    isObject(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.goal) &&
    isNonEmptyString(value.title) &&
    isOneOfString(value.state, ATELIER_PROJECT_STATES) &&
    isNonEmptyString(value.workspaceRef) &&
    (value.traceRoot === undefined || isNonEmptyString(value.traceRoot)) &&
    typeof value.goalOwnerSignoff === 'boolean' &&
    Array.isArray(value.residualRisks) &&
    value.residualRisks.every(isResidualRisk) &&
    Array.isArray(value.openBlockers) &&
    value.openBlockers.every(isProjectBlocker) &&
    Array.isArray(value.memoryCandidates) &&
    value.memoryCandidates.every(isMemoryCandidateRef) &&
    isProjectCompletion(value.completion) &&
    isMilestoneTree(value.milestoneTree) &&
    isTaskGraph(value.taskGraph) &&
    (value.policy === undefined || isPolicyProjection(value.policy)) &&
    Array.isArray(value.defects) &&
    value.defects.every(isDefectProjection)
  );
}

function isProjectCompletion(value: unknown): value is AtelierProjectCompletion {
  return (
    isObject(value) &&
    typeof value.noOpenBlockers === 'boolean' &&
    typeof value.l0L1AcceptancePassed === 'boolean' &&
    typeof value.l2HumanSignoffComplete === 'boolean' &&
    typeof value.residualRisksLogged === 'boolean' &&
    typeof value.memoryCandidatesGenerated === 'boolean'
  );
}

function isProjectBlocker(value: unknown): value is AtelierProjectBlocker {
  return (
    isObject(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.owner) &&
    isOneOfString(value.severity, ATELIER_BLOCKER_SEVERITIES) &&
    isOneOfString(value.state, ATELIER_BLOCKER_STATES) &&
    isNonEmptyString(value.evidenceRef) &&
    isNonEmptyString(value.reason)
  );
}

function isResidualRisk(value: unknown): value is AtelierResidualRisk {
  return (
    isObject(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.desc) &&
    isOneOfString(value.state, ATELIER_RESIDUAL_RISK_STATES) &&
    isNonEmptyString(value.evidenceRef) &&
    isNonEmptyString(value.owner)
  );
}

function isMemoryCandidateRef(value: unknown): value is AtelierMemoryCandidateRef {
  return (
    isObject(value) &&
    isNonEmptyString(value.id) &&
    isOneOfString(value.type, ATELIER_MEMORY_CANDIDATE_TYPES) &&
    isNonEmptyString(value.content) &&
    isStringArray(value.evidenceRefs) &&
    isOneOfString(value.scope, ATELIER_MEMORY_CANDIDATE_SCOPES) &&
    typeof value.confirmed === 'boolean' &&
    isMemoryCandidateFeedArray(value.feeds)
  );
}

function isMemoryCandidateFeedArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((feed) => isOneOfString(feed, ATELIER_MEMORY_CANDIDATE_FEEDS));
}

function isMilestoneTree(value: unknown): value is AtelierMilestoneTree {
  return (
    isObject(value) &&
    isNonEmptyString(value.rootId) &&
    Array.isArray(value.milestones) &&
    value.milestones.every(isMilestoneProjection) &&
    Array.isArray(value.edges) &&
    value.edges.every(isDependencyEdge)
  );
}

function isMilestoneProjection(value: unknown): value is AtelierMilestoneProjection {
  return (
    isObject(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    isOneOfString(value.state, ATELIER_MILESTONE_STATES) &&
    isNonEmptyStringArray(value.taskIds) &&
    isNonEmptyStringArray(value.acceptancePredicateIds) &&
    Array.isArray(value.openBlockers) &&
    value.openBlockers.every(isProjectBlocker)
  );
}

function isTaskGraph(value: unknown): value is AtelierTaskGraph {
  return (
    isObject(value) &&
    isNonEmptyStringArray(value.rootTaskIds) &&
    Array.isArray(value.tasks) &&
    value.tasks.every(isTaskNodeProjection) &&
    Array.isArray(value.edges) &&
    value.edges.every(isDependencyEdge) &&
    isOneOfString(value.parallelPolicy, ATELIER_TASK_GRAPH_PARALLEL_POLICIES)
  );
}

function isTaskNodeProjection(value: unknown): value is AtelierTaskNodeProjection {
  return (
    isObject(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    isOneOfString(value.state, ATELIER_TASK_GRAPH_NODE_STATES) &&
    isNonEmptyString(value.agentRole) &&
    isStringArray(value.artifactIds) &&
    isStringArray(value.gateIds)
  );
}

function isDependencyEdge(value: unknown): value is AtelierDependencyEdge {
  return (
    isObject(value) &&
    isNonEmptyString(value.from) &&
    isNonEmptyString(value.to) &&
    isOneOfString(value.type, ATELIER_DEPENDENCY_EDGE_TYPES)
  );
}

function isPolicyProjection(value: unknown): value is AtelierPolicyProjection {
  return (
    isObject(value) &&
    isNonEmptyString(value.id) &&
    Array.isArray(value.rules) &&
    value.rules.every(isPolicyRule) &&
    typeof value.hardDeny === 'boolean'
  );
}

function isPolicyRule(value: unknown): value is AtelierPolicyRule {
  return (
    isObject(value) &&
    isNonEmptyString(value.id) &&
    isOneOfString(value.scope, ATELIER_POLICY_RULE_SCOPES) &&
    isNonEmptyString(value.expr) &&
    isOneOfString(value.severity, ATELIER_BLOCKER_SEVERITIES)
  );
}

function isDefectProjection(value: unknown): value is AtelierDefectProjection {
  return (
    isObject(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.taskId) &&
    isOneOfString(value.source, ATELIER_DEFECT_SOURCES) &&
    isOneOfString(value.state, ATELIER_DEFECT_STATES) &&
    isNonEmptyString(value.evidenceRef) &&
    isDefectProposal(value.proposal)
  );
}

function isDefectProposal(value: unknown): value is AtelierDefectProposal {
  return (
    isObject(value) &&
    isNonEmptyString(value.summary) &&
    isNonEmptyString(value.expectedChange) &&
    isNonEmptyStringArray(value.targetRefs)
  );
}

function isReplayRecord(value: unknown, taskIds?: ReadonlySet<string>): value is Record<string, AtelierReplayState> {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, item]) => {
    if (!isNonEmptyString(key)) return false;
    if (taskIds !== undefined && !taskIds.has(key)) return false;
    if (!isObject(item)) return false;
    return (
      isNonEmptyString(item.source) &&
      isNonNegativeFiniteNumber(item.eventCount) &&
      isNonNegativeFiniteNumber(item.replayedEventCount) &&
      isNonNegativeFiniteNumber(item.nextEventSeq) &&
      typeof item.hasMore === 'boolean' &&
      (item.checkpointId === undefined || isNonEmptyString(item.checkpointId)) &&
      (item.checkpointEventSeq === undefined || isNonNegativeFiniteNumber(item.checkpointEventSeq))
    );
  });
}

function isProjectionPatch(value: unknown): value is AtelierProjectionPatch {
  if (!isObject(value) || typeof value.kind !== 'string') return false;
  if (!(ATELIER_PROJECTION_PATCH_KINDS as readonly string[]).includes(value.kind)) return false;

  switch (value.kind) {
    case 'snapshot':
      return isProjectionSnapshot(value.snapshot);
    case 'task.upsert':
      return isTaskProjection(value.task);
    case 'task.status':
      return isNonEmptyString(value.taskId) && isTaskStatus(value.status);
    case 'stream.append':
      return isNonEmptyString(value.taskId) && Array.isArray(value.blocks) && value.blocks.every(isStreamBlock);
    case 'decision.resolved':
      return isNonEmptyString(value.taskId) && isNonEmptyString(value.blockId) && isNonEmptyString(value.choice);
    case 'artifact.upsert':
      return isNonEmptyString(value.taskId) && isArtifactProjection(value.artifact, value.taskId);
    case 'gate.upsert':
      return isNonEmptyString(value.taskId) && isGateResultProjection(value.gate);
    case 'context.replace':
      return isNonEmptyString(value.taskId) && isTaskContext(value.context);
    case 'todo.replace':
      return isNonEmptyString(value.taskId) && Array.isArray(value.todos) && value.todos.every(isTodoItem);
  }
}

function isProjectionEventTaskScopeConsistent(eventTaskId: unknown, patch: AtelierProjectionPatch): boolean {
  if (patch.kind === 'snapshot') return eventTaskId === undefined;
  if (patch.kind === 'task.upsert') return eventTaskId === undefined || eventTaskId === patch.task.id;
  return eventTaskId === patch.taskId;
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && ATELIER_TASK_LIFECYCLE_STATES.includes(value as TaskStatus);
}

function isTaskProjection(value: unknown): value is Task {
  return (
    isObject(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.project) &&
    isNonEmptyString(value.title) &&
    isTaskStatus(value.status) &&
    (value.projectId === undefined || isNonEmptyString(value.projectId)) &&
    (value.running === undefined || typeof value.running === 'boolean') &&
    (value.branch === undefined || typeof value.branch === 'string') &&
    (value.intentPreset === undefined || isOneOfString(value.intentPreset, ATELIER_TASK_INTENT_PRESETS)) &&
    (value.providerStrategyPreset === undefined || typeof value.providerStrategyPreset === 'string') &&
    (value.gatePlanPreset === undefined || typeof value.gatePlanPreset === 'string') &&
    (value.workspaceOpenTarget === undefined || isWorkspaceOpenTarget(value.workspaceOpenTarget, value.id))
  );
}

function isWorkspaceOpenTarget(value: unknown, taskId?: string): value is Task['workspaceOpenTarget'] {
  return (
    isObject(value) &&
    isNonEmptyString(value.workspaceId) &&
    isWorkspaceUri(value.workspaceUri, value.workspaceId, taskId) &&
    isNonEmptyString(value.label) &&
    (value.ideHint === undefined || typeof value.ideHint === 'string')
  );
}

function isWorkspaceUri(value: unknown, workspaceId?: string, taskId?: string): value is string {
  if (typeof value !== 'string') return false;
  try {
    const uri = new URL(value);
    const shape = ATELIER_WORKSPACE_OPEN_URI_SHAPE;
    const taskPath = uri.pathname.split('/').filter(Boolean);
    const workspaceParams = uri.searchParams.getAll(shape.workspaceQueryKey);
    return (
      isWorkspaceOpenUriScheme(uri.protocol.slice(0, -1)) &&
      uri.hostname === shape.host &&
      taskPath.length === shape.taskPathSegments &&
      isNonEmptyString(taskPath[0]) &&
      workspaceParams.length === 1 &&
      isNonEmptyString(workspaceParams[0]) &&
      (taskId === undefined || taskPath[0] === taskId) &&
      (workspaceId === undefined || workspaceParams[0] === workspaceId)
    );
  } catch {
    return false;
  }
}

function isWorkspaceOpenUriScheme(value: unknown): boolean {
  const schemes = ATELIER_WORKSPACE_OPEN_URI_SCHEMES as readonly string[];
  return typeof value === 'string' && schemes.includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value) && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function isOneOfString<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && allowed.includes(value);
}

function isRecordList<T>(value: unknown, itemGuard: (item: unknown) => item is T): value is Record<string, T[]> {
  return (
    isRecord(value) &&
    Object.entries(value).every(([key, items]) =>
      isNonEmptyString(key) && Array.isArray(items) && items.every(itemGuard),
    )
  );
}

function isKnownTaskRecordList<T>(
  value: unknown,
  taskIds: ReadonlySet<string>,
  itemGuard: (item: unknown) => item is T,
): value is Record<string, T[]> {
  return (
    isRecord(value) &&
    Object.entries(value).every(([key, items]) =>
      taskIds.has(key) && Array.isArray(items) && items.every(itemGuard),
    )
  );
}

function isRecordValue<T>(value: unknown, itemGuard: (item: unknown) => item is T): value is Record<string, T> {
  return (
    isRecord(value) &&
    Object.entries(value).every(([key, item]) => isNonEmptyString(key) && itemGuard(item))
  );
}

function isKnownTaskArtifactRecordList(
  value: unknown,
  taskIds: ReadonlySet<string>,
): value is Record<string, Artifact[]> {
  return (
    isRecord(value) &&
    Object.entries(value).every(([key, items]) =>
      taskIds.has(key) && Array.isArray(items) && items.every((item) => isArtifactProjection(item, key)),
    )
  );
}

function isKnownTaskRecordValue<T>(
  value: unknown,
  taskIds: ReadonlySet<string>,
  itemGuard: (item: unknown) => item is T,
): value is Record<string, T> {
  return (
    isRecord(value) &&
    Object.entries(value).every(([key, item]) => taskIds.has(key) && itemGuard(item))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isStreamBlock(value: unknown): value is Block {
  if (!(
    isObject(value) &&
    isNonEmptyString(value.id) &&
    isStreamBlockKind(value.kind)
  )) {
    return false;
  }
  if (!hasRequiredStreamBlockFields(value)) return false;
  if (value.kind === 'diff') {
    return (
      hasDiffStreamSummaryFields(value) &&
      isNonNegativeFiniteNumber(value.files) &&
      isNonNegativeFiniteNumber(value.added) &&
      isNonNegativeFiniteNumber(value.removed) &&
      isNonEmptyStringArray(value.paths)
    );
  }
  if (value.kind === 'nego') {
    return Array.isArray(value.voices) && value.voices.every(isNegoVoice);
  }
  return true;
}

function hasRequiredStreamBlockFields(value: Record<string, unknown>): boolean {
  const fields = ATELIER_STREAM_BLOCK_REQUIRED_FIELDS_BY_KIND[
    value.kind as keyof typeof ATELIER_STREAM_BLOCK_REQUIRED_FIELDS_BY_KIND
  ];
  return fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function hasDiffStreamSummaryFields(value: Record<string, unknown>): boolean {
  return ATELIER_DIFF_STREAM_SUMMARY_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function isStreamBlockKind(value: unknown): value is string {
  return typeof value === 'string' && (ATELIER_STREAM_BLOCK_KINDS as readonly string[]).includes(value);
}

function isNegoVoice(value: unknown): boolean {
  return (
    isObject(value) &&
    isNonEmptyString(value.role) &&
    isOneOfString(value.stance, ATELIER_PROJECTION_CONTRACT.negotiationProjection.voiceStances) &&
    isNonEmptyString(value.text) &&
    (value.evidenceRef === undefined || isNonEmptyString(value.evidenceRef)) &&
    (value.sessionId === undefined || isNonEmptyString(value.sessionId)) &&
    (value.roundId === undefined || isNonEmptyString(value.roundId)) &&
    (value.voiceId === undefined || isNonEmptyString(value.voiceId)) &&
    (value.objectionId === undefined || isNonEmptyString(value.objectionId))
  );
}

function isTodoItem(value: unknown): value is TodoItem {
  return (
    isObject(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.text) &&
    isOneOfString(value.status, ATELIER_TODO_STATUSES)
  );
}

function isTaskContext(value: unknown): value is TaskContext {
  return (
    isObject(value) &&
    isNonNegativeFiniteNumber(value.usedPct) &&
    value.usedPct <= 100 &&
    Array.isArray(value.files) &&
    value.files.every(isContextFile)
  );
}

function isContextFile(value: unknown): boolean {
  return (
    isObject(value) &&
    isNonEmptyString(value.name) &&
    isOneOfString(value.group, ATELIER_CONTEXT_FILE_GROUPS)
  );
}

function isArtifactProjection(value: unknown, taskId?: string): value is Artifact {
  if (!isObject(value)) return false;
  for (const field of ATELIER_ARTIFACT_FORBIDDEN_BODY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) return false;
  }
  const artifactId = isNonEmptyString(value.id) ? value.id : undefined;
  return (
    artifactId !== undefined &&
    isNonEmptyString(value.name) &&
    isOneOfString(value.kind, ATELIER_ARTIFACT_KINDS) &&
    typeof value.meta === 'string' &&
    (value.previewHint === undefined || isArtifactPreviewHint(value.previewHint)) &&
    (value.bodyRef === undefined || isArtifactBodyRef(value.bodyRef, taskId, artifactId)) &&
    (value.bodyHash === undefined || typeof value.bodyHash === 'string') &&
    (value.bodySize === undefined || typeof value.bodySize === 'string' || typeof value.bodySize === 'number') &&
    (value.bodyKind === undefined || isOneOfString(value.bodyKind, ATELIER_ARTIFACT_BODY_KINDS)) &&
    (value.paths === undefined || (Array.isArray(value.paths) && value.paths.every((item) => typeof item === 'string'))) &&
    (value.size === undefined || typeof value.size === 'string') &&
    (value.previewTarget === undefined || isArtifactPreviewTarget(value.previewTarget, taskId, artifactId))
  );
}

function isArtifactPreviewHint(value: unknown): boolean {
  return typeof value === 'string' && (ATELIER_ARTIFACT_PREVIEW_HINTS as readonly string[]).includes(value);
}

function isArtifactBodyRef(value: unknown, taskId?: string, artifactId?: string): boolean {
  return isArtifactRef(value, ATELIER_ARTIFACT_BODY_REF_SHAPE, taskId, artifactId);
}

function isArtifactPreviewTarget(value: unknown, taskId?: string, artifactId?: string): boolean {
  if (!isObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (!(ATELIER_ARTIFACT_PREVIEW_TARGET_FIELDS as readonly string[]).includes(key)) return false;
  }
  for (const field of ATELIER_ARTIFACT_FORBIDDEN_BODY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) return false;
  }
  return (
    (value.kind === undefined || isOneOfString(value.kind, ATELIER_ARTIFACT_KINDS)) &&
    isArtifactPreviewTargetMode(value.mode) &&
    (value.label === undefined || typeof value.label === 'string') &&
    isArtifactPreviewTargetSandboxRef(value.sandboxRef, taskId, artifactId) &&
    isArtifactBodyRef(value.bodyRef, taskId, artifactId)
  );
}

function isArtifactPreviewTargetMode(value: unknown): boolean {
  return typeof value === 'string' && (ATELIER_ARTIFACT_PREVIEW_TARGET_MODES as readonly string[]).includes(value);
}

function isArtifactPreviewTargetSandboxRef(value: unknown, taskId?: string, artifactId?: string): boolean {
  return isArtifactRef(value, ATELIER_ARTIFACT_SANDBOX_REF_SHAPE, taskId, artifactId);
}

function isArtifactRef(
  value: unknown,
  shape: { scheme: string; pathSegments: number; terminalSegment: string },
  taskId?: string,
  artifactId?: string,
): boolean {
  if (typeof value !== 'string') return false;
  if (/\s/.test(value)) return false;
  try {
    const uri = new URL(value);
    const path = uri.pathname.split('/').filter(Boolean);
    return (
      uri.protocol.slice(0, -1) === shape.scheme &&
      isNonEmptyString(uri.hostname) &&
      path.length === shape.pathSegments &&
      isNonEmptyString(path[0]) &&
      path[path.length - 1] === shape.terminalSegment &&
      path.slice(0, -1).every(isNonEmptyString) &&
      (taskId === undefined || uri.hostname === taskId) &&
      (artifactId === undefined || path[0] === artifactId)
    );
  } catch {
    return false;
  }
}

function isGateResultProjection(value: unknown): value is GateResult {
  return (
    isObject(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isOneOfString(value.status, ATELIER_GATE_STATUSES) &&
    typeof value.summary === 'string' &&
    Array.isArray(value.checks) &&
    value.checks.every(isGateCheckProjection) &&
    (value.artifactIds === undefined || (Array.isArray(value.artifactIds) && value.artifactIds.every((item) => typeof item === 'string'))) &&
    (value.at === undefined || typeof value.at === 'string')
  );
}

function isGateCheckProjection(value: unknown): boolean {
  return (
    isObject(value) &&
    isNonEmptyString(value.name) &&
    isOneOfString(value.status, ATELIER_GATE_CHECK_STATUSES)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}
