import {
  ATELIER_ARTIFACT_FORBIDDEN_BODY_FIELDS,
  ATELIER_ARTIFACT_BODY_REF_SHAPE,
  ATELIER_ARTIFACT_BODY_KINDS,
  ATELIER_ARTIFACT_KINDS,
  ATELIER_ARTIFACT_SANDBOX_REF_SHAPE,
  ATELIER_ARTIFACT_PREVIEW_TARGET_FIELDS,
  ATELIER_ARTIFACT_PREVIEW_TARGET_MODES,
  ATELIER_ARTIFACT_PREVIEW_HINTS,
  ATELIER_BUDGET_STATUSES,
  ATELIER_BLOCKER_SEVERITIES,
  ATELIER_BLOCKER_STATES,
  ATELIER_DEFECT_SOURCES,
  ATELIER_DEFECT_STATES,
  ATELIER_DEPENDENCY_EDGE_TYPES,
  ATELIER_DIFF_STREAM_SUMMARY_FIELDS,
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
  type AtelierArtifactPreviewHint,
  type AtelierBudgetStatus,
  type AtelierProjectionVersion,
} from './projection.contract.generated';

export interface AtelierTask {
  id: string;
  project: string;
  projectId?: string;
  title: string;
  status: string;
  branch?: string;
  running?: boolean;
  intentPreset?: string;
  providerStrategyPreset?: string;
  gatePlanPreset?: string;
  workspaceOpenTarget?: AtelierWorkspaceOpenTarget;
}

export interface AtelierWorkspaceOpenTarget {
  workspaceId: string;
  workspaceUri: string;
  label: string;
  ideHint?: string;
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

export interface AtelierStreamBlock {
  id: string;
  kind: string;
  text?: string;
  title?: string;
  done?: boolean;
  summary?: string;
  agentCount?: number;
  converged?: boolean;
  question?: string;
  spentSoFar?: string;
  rollbackImpact?: string;
  chosen?: string;
  name?: string;
  fileKind?: string;
  producedBy?: string;
  files?: number;
  added?: number;
  removed?: number;
  paths?: string[];
  consensus?: string;
  voices?: AtelierNegoVoice[];
  options?: AtelierDecisionOption[];
  meta?: Record<string, unknown>;
}

export interface AtelierNegoVoice {
  role: string;
  stance: AtelierNegotiationVoiceStance;
  text: string;
  evidenceRef?: string;
  sessionId?: string;
  roundId?: string;
  voiceId?: string;
  objectionId?: string;
}

type AtelierNegotiationVoiceStance =
  (typeof ATELIER_PROJECTION_CONTRACT.negotiationProjection.voiceStances)[number];

export interface AtelierDecisionOption {
  text: string;
  recommended?: boolean;
}

export interface AtelierTodoItem {
  id: string;
  text: string;
  status: string;
}

export interface AtelierTaskContext {
  usedPct: number;
  files: AtelierContextFile[];
}

export interface AtelierContextFile {
  name: string;
  group: string;
}

export interface AtelierArtifactProjection {
  id: string;
  name?: string;
  kind?: string;
  meta?: string;
  previewHint?: AtelierArtifactPreviewHint;
  bodyRef?: string;
  bodyHash?: string;
  bodySize?: string;
  bodyKind?: string;
  paths?: string[];
  size?: string;
  previewTarget?: AtelierArtifactPreviewTarget;
}

export interface AtelierArtifactPreviewTarget {
  kind?: string;
  mode?: string;
  label?: string;
  sandboxRef?: string;
  bodyRef?: string;
}

export interface AtelierGateProjection {
  id: string;
  name?: string;
  status?: string;
  summary?: string;
  checks?: AtelierGateCheck[];
  artifactIds?: string[];
  at?: string;
}

export interface AtelierGateCheck {
  name: string;
  status: string;
  detail?: string;
}

export interface AtelierReplayState {
  source: string;
  eventCount: number;
  replayedEventCount: number;
  nextEventSeq: number;
  hasMore: boolean;
  checkpointId?: string;
  checkpointEventSeq?: number;
}

export interface AtelierWorkspaceProjection {
  budgetSpent: number;
  budgetCap: number;
  budget?: AtelierBudgetProjection;
  model: string;
  tasks: AtelierTask[];
  projects?: AtelierProjectProjection[];
  streams: Record<string, AtelierStreamBlock[]>;
  todos: Record<string, AtelierTodoItem[]>;
  contexts: Record<string, AtelierTaskContext>;
  artifacts: Record<string, AtelierArtifactProjection[]>;
  gates?: Record<string, AtelierGateProjection[]>;
  replay?: Record<string, AtelierReplayState>;
}

export interface AtelierBudgetProjection {
  status: AtelierBudgetStatus;
  summary: string;
  dimensions: AtelierBudgetDimensionProjection[];
  decisionHint?: string;
}

export interface AtelierBudgetDimensionProjection {
  id: string;
  label: string;
  used: number;
  cap: number;
  unit: string;
  percent: number;
  status: AtelierBudgetStatus;
}

export interface AtelierProjectionSnapshot {
  version: AtelierProjectionVersion;
  selectedTaskId: string;
  workspace: AtelierWorkspaceProjection;
}

export type AtelierProjectionPatch =
  | { kind: 'snapshot'; snapshot: AtelierProjectionSnapshot }
  | { kind: 'task.upsert'; task: AtelierTask; select?: boolean }
  | { kind: 'task.status'; taskId: string; status: string }
  | { kind: 'stream.append'; taskId: string; blocks: AtelierStreamBlock[] }
  | { kind: 'decision.resolved'; taskId: string; blockId: string; choice: string }
  | { kind: 'artifact.upsert'; taskId: string; artifact: AtelierArtifactProjection }
  | { kind: 'gate.upsert'; taskId: string; gate: AtelierGateProjection }
  | { kind: 'context.replace'; taskId: string; context: AtelierTaskContext }
  | { kind: 'todo.replace'; taskId: string; todos: AtelierTodoItem[] };

export interface AtelierProjectionEvent {
  id: string;
  seq: number;
  taskId?: string;
  patch: AtelierProjectionPatch;
  receivedAt: string;
}

export function isAtelierProjectionSnapshot(value: unknown): value is AtelierProjectionSnapshot {
  if (!isRecord(value)) return false;
  const workspace = value.workspace;
  if (!isRecord(workspace)) return false;
  if (!Array.isArray(workspace.tasks) || !workspace.tasks.every(isAtelierTask)) return false;
  const taskIds = new Set(workspace.tasks.map((task) => task.id));
  return (
    value.version === ATELIER_PROJECTION_CONTRACT.version &&
    typeof value.selectedTaskId === 'string' &&
    isSnapshotSelectedTaskId(value.selectedTaskId, taskIds) &&
    typeof workspace.budgetSpent === 'number' &&
    typeof workspace.budgetCap === 'number' &&
    (workspace.budget === undefined || isAtelierBudgetProjection(workspace.budget)) &&
    typeof workspace.model === 'string' &&
    (workspace.projects === undefined ||
      (Array.isArray(workspace.projects) && workspace.projects.every(isAtelierProjectProjection))) &&
    isKnownTaskRecordList(workspace.streams, taskIds, isAtelierStreamBlock) &&
    isKnownTaskRecordList(workspace.todos, taskIds, isAtelierTodoItem) &&
    isKnownTaskRecordValue(workspace.contexts, taskIds, isAtelierTaskContext) &&
    isKnownTaskArtifactRecordList(workspace.artifacts, taskIds) &&
    (workspace.gates === undefined || isKnownTaskRecordList(workspace.gates, taskIds, isAtelierGateProjection)) &&
    (workspace.replay === undefined || isAtelierReplayRecord(workspace.replay, taskIds))
  );
}

function isSnapshotSelectedTaskId(selectedTaskId: string, taskIds: ReadonlySet<string>): boolean {
  return selectedTaskId === '' || taskIds.has(selectedTaskId);
}

function isAtelierBudgetProjection(value: unknown): value is AtelierBudgetProjection {
  return (
    isRecord(value) &&
    isAtelierBudgetStatus(value.status) &&
    isNonEmptyString(value.summary) &&
    Array.isArray(value.dimensions) &&
    value.dimensions.length > 0 &&
    value.dimensions.every(isAtelierBudgetDimensionProjection) &&
    (value.decisionHint === undefined || typeof value.decisionHint === 'string')
  );
}

function isAtelierBudgetDimensionProjection(value: unknown): value is AtelierBudgetDimensionProjection {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.label) &&
    isNonNegativeFiniteNumber(value.used) &&
    isNonNegativeFiniteNumber(value.cap) &&
    isNonEmptyString(value.unit) &&
    isNonNegativeFiniteNumber(value.percent) &&
    value.percent <= 100 &&
    isAtelierBudgetStatus(value.status)
  );
}

function isAtelierBudgetStatus(value: unknown): value is AtelierBudgetProjection['status'] {
  return typeof value === 'string' && ATELIER_BUDGET_STATUSES.includes(value as AtelierBudgetStatus);
}

export function parseAtelierProjectionEvent(value: unknown): AtelierProjectionEvent | null {
  if (typeof value === 'string') {
    try {
      return parseAtelierProjectionEvent(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }

  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (!isFiniteNumber(value.seq) || value.seq < 0) return null;
  if (value.taskId !== undefined && !isNonEmptyString(value.taskId)) return null;
  if (typeof value.receivedAt !== 'string' || value.receivedAt.length === 0) return null;
  if (!isAtelierProjectionPatch(value.patch)) return null;
  if (!isAtelierProjectionEventTaskScopeConsistent(value.taskId, value.patch)) return null;

  return value as unknown as AtelierProjectionEvent;
}

export function isAtelierProjectionPatch(value: unknown): value is AtelierProjectionPatch {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;

  switch (value.kind) {
    case 'snapshot':
      return isAtelierProjectionSnapshot(value.snapshot);
    case 'task.upsert':
      return isAtelierTask(value.task) && (value.select === undefined || typeof value.select === 'boolean');
    case 'task.status':
      return isNonEmptyString(value.taskId) && isAtelierTaskStatus(value.status);
    case 'stream.append':
      return isNonEmptyString(value.taskId) && Array.isArray(value.blocks) && value.blocks.every(isAtelierStreamBlock);
    case 'decision.resolved':
      return isNonEmptyString(value.taskId) && isNonEmptyString(value.blockId) && isNonEmptyString(value.choice);
    case 'artifact.upsert':
      return isNonEmptyString(value.taskId) && isAtelierArtifactProjection(value.artifact, value.taskId);
    case 'gate.upsert':
      return isNonEmptyString(value.taskId) && isAtelierGateProjection(value.gate);
    case 'context.replace':
      return isNonEmptyString(value.taskId) && isAtelierTaskContext(value.context);
    case 'todo.replace':
      return isNonEmptyString(value.taskId) && Array.isArray(value.todos) && value.todos.every(isAtelierTodoItem);
    default:
      return false;
  }
}

function isAtelierProjectionEventTaskScopeConsistent(
  eventTaskId: unknown,
  patch: AtelierProjectionPatch,
): boolean {
  if (patch.kind === 'snapshot') return eventTaskId === undefined;
  if (patch.kind === 'task.upsert') return eventTaskId === undefined || eventTaskId === patch.task.id;
  return eventTaskId === patch.taskId;
}

function isAtelierTask(value: unknown): value is AtelierTask {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.project) &&
    (value.projectId === undefined || isNonEmptyString(value.projectId)) &&
    isNonEmptyString(value.title) &&
    isAtelierTaskStatus(value.status) &&
    (value.branch === undefined || typeof value.branch === 'string') &&
    (value.running === undefined || typeof value.running === 'boolean') &&
    (value.intentPreset === undefined || isOneOfString(value.intentPreset, ATELIER_TASK_INTENT_PRESETS)) &&
    (value.providerStrategyPreset === undefined || typeof value.providerStrategyPreset === 'string') &&
    (value.gatePlanPreset === undefined || typeof value.gatePlanPreset === 'string') &&
    (value.workspaceOpenTarget === undefined || isAtelierWorkspaceOpenTarget(value.workspaceOpenTarget, value.id))
  );
}

function isAtelierTaskStatus(value: unknown): boolean {
  return typeof value === 'string' && (ATELIER_TASK_LIFECYCLE_STATES as readonly string[]).includes(value);
}

function isAtelierProjectProjection(value: unknown): value is AtelierProjectProjection {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.goal) &&
    isNonEmptyString(value.title) &&
    isOneOfString(value.state, ATELIER_PROJECT_STATES) &&
    isNonEmptyString(value.workspaceRef) &&
    (value.traceRoot === undefined || isNonEmptyString(value.traceRoot)) &&
    typeof value.goalOwnerSignoff === 'boolean' &&
    Array.isArray(value.residualRisks) &&
    value.residualRisks.every(isAtelierResidualRisk) &&
    Array.isArray(value.openBlockers) &&
    value.openBlockers.every(isAtelierProjectBlocker) &&
    Array.isArray(value.memoryCandidates) &&
    value.memoryCandidates.every(isAtelierMemoryCandidateRef) &&
    isAtelierProjectCompletion(value.completion) &&
    isAtelierMilestoneTree(value.milestoneTree) &&
    isAtelierTaskGraph(value.taskGraph) &&
    (value.policy === undefined || isAtelierPolicyProjection(value.policy)) &&
    Array.isArray(value.defects) &&
    value.defects.every(isAtelierDefectProjection)
  );
}

function isAtelierProjectCompletion(value: unknown): value is AtelierProjectCompletion {
  return (
    isRecord(value) &&
    typeof value.noOpenBlockers === 'boolean' &&
    typeof value.l0L1AcceptancePassed === 'boolean' &&
    typeof value.l2HumanSignoffComplete === 'boolean' &&
    typeof value.residualRisksLogged === 'boolean' &&
    typeof value.memoryCandidatesGenerated === 'boolean'
  );
}

function isAtelierProjectBlocker(value: unknown): value is AtelierProjectBlocker {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.owner) &&
    isOneOfString(value.severity, ATELIER_BLOCKER_SEVERITIES) &&
    isOneOfString(value.state, ATELIER_BLOCKER_STATES) &&
    isNonEmptyString(value.evidenceRef) &&
    isNonEmptyString(value.reason)
  );
}

function isAtelierResidualRisk(value: unknown): value is AtelierResidualRisk {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.desc) &&
    isOneOfString(value.state, ATELIER_RESIDUAL_RISK_STATES) &&
    isNonEmptyString(value.evidenceRef) &&
    isNonEmptyString(value.owner)
  );
}

function isAtelierMemoryCandidateRef(value: unknown): value is AtelierMemoryCandidateRef {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isOneOfString(value.type, ATELIER_MEMORY_CANDIDATE_TYPES) &&
    isNonEmptyString(value.content) &&
    isStringArray(value.evidenceRefs) &&
    isOneOfString(value.scope, ATELIER_MEMORY_CANDIDATE_SCOPES) &&
    typeof value.confirmed === 'boolean' &&
    isAtelierMemoryCandidateFeedArray(value.feeds)
  );
}

function isAtelierMemoryCandidateFeedArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((feed) => isOneOfString(feed, ATELIER_MEMORY_CANDIDATE_FEEDS));
}

function isAtelierMilestoneTree(value: unknown): value is AtelierMilestoneTree {
  return (
    isRecord(value) &&
    isNonEmptyString(value.rootId) &&
    Array.isArray(value.milestones) &&
    value.milestones.every(isAtelierMilestoneProjection) &&
    Array.isArray(value.edges) &&
    value.edges.every(isAtelierDependencyEdge)
  );
}

function isAtelierMilestoneProjection(value: unknown): value is AtelierMilestoneProjection {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    isOneOfString(value.state, ATELIER_MILESTONE_STATES) &&
    isNonEmptyStringArray(value.taskIds) &&
    isNonEmptyStringArray(value.acceptancePredicateIds) &&
    Array.isArray(value.openBlockers) &&
    value.openBlockers.every(isAtelierProjectBlocker)
  );
}

function isAtelierTaskGraph(value: unknown): value is AtelierTaskGraph {
  return (
    isRecord(value) &&
    isNonEmptyStringArray(value.rootTaskIds) &&
    Array.isArray(value.tasks) &&
    value.tasks.every(isAtelierTaskNodeProjection) &&
    Array.isArray(value.edges) &&
    value.edges.every(isAtelierDependencyEdge) &&
    isOneOfString(value.parallelPolicy, ATELIER_TASK_GRAPH_PARALLEL_POLICIES)
  );
}

function isAtelierTaskNodeProjection(value: unknown): value is AtelierTaskNodeProjection {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    isOneOfString(value.state, ATELIER_TASK_GRAPH_NODE_STATES) &&
    isNonEmptyString(value.agentRole) &&
    isStringArray(value.artifactIds) &&
    isStringArray(value.gateIds)
  );
}

function isAtelierDependencyEdge(value: unknown): value is AtelierDependencyEdge {
  return (
    isRecord(value) &&
    isNonEmptyString(value.from) &&
    isNonEmptyString(value.to) &&
    isOneOfString(value.type, ATELIER_DEPENDENCY_EDGE_TYPES)
  );
}

function isAtelierPolicyProjection(value: unknown): value is AtelierPolicyProjection {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    Array.isArray(value.rules) &&
    value.rules.every(isAtelierPolicyRule) &&
    typeof value.hardDeny === 'boolean'
  );
}

function isAtelierPolicyRule(value: unknown): value is AtelierPolicyRule {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isOneOfString(value.scope, ATELIER_POLICY_RULE_SCOPES) &&
    isNonEmptyString(value.expr) &&
    isOneOfString(value.severity, ATELIER_BLOCKER_SEVERITIES)
  );
}

function isAtelierDefectProjection(value: unknown): value is AtelierDefectProjection {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.taskId) &&
    isOneOfString(value.source, ATELIER_DEFECT_SOURCES) &&
    isOneOfString(value.state, ATELIER_DEFECT_STATES) &&
    isNonEmptyString(value.evidenceRef) &&
    isAtelierDefectProposal(value.proposal)
  );
}

function isAtelierDefectProposal(value: unknown): value is AtelierDefectProposal {
  return (
    isRecord(value) &&
    isNonEmptyString(value.summary) &&
    isNonEmptyString(value.expectedChange) &&
    isNonEmptyStringArray(value.targetRefs)
  );
}

function isAtelierWorkspaceOpenTarget(value: unknown, taskId?: string): value is AtelierWorkspaceOpenTarget {
  return (
    isRecord(value) &&
    isNonEmptyString(value.workspaceId) &&
    isAtelierWorkspaceUri(value.workspaceUri, value.workspaceId, taskId) &&
    isNonEmptyString(value.label) &&
    (value.ideHint === undefined || typeof value.ideHint === 'string')
  );
}

function isAtelierWorkspaceUri(value: unknown, workspaceId?: string, taskId?: string): value is string {
  if (typeof value !== 'string') return false;
  try {
    const uri = new URL(value);
    const shape = ATELIER_WORKSPACE_OPEN_URI_SHAPE;
    const taskPath = uri.pathname.split('/').filter(Boolean);
    const workspaceParams = uri.searchParams.getAll(shape.workspaceQueryKey);
    return (
      isAtelierWorkspaceOpenUriScheme(uri.protocol.slice(0, -1)) &&
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

function isAtelierWorkspaceOpenUriScheme(value: unknown): value is string {
  const schemes = ATELIER_WORKSPACE_OPEN_URI_SCHEMES as readonly string[];
  return typeof value === 'string' && schemes.includes(value);
}

function isAtelierStreamBlock(value: unknown): value is AtelierStreamBlock {
  if (!(
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isAtelierStreamBlockKind(value.kind) &&
    (value.text === undefined || typeof value.text === 'string') &&
    (value.title === undefined || typeof value.title === 'string') &&
    (value.done === undefined || typeof value.done === 'boolean') &&
    (value.summary === undefined || typeof value.summary === 'string') &&
    (value.agentCount === undefined || isFiniteNumber(value.agentCount)) &&
    (value.converged === undefined || typeof value.converged === 'boolean') &&
    (value.question === undefined || typeof value.question === 'string') &&
    (value.spentSoFar === undefined || typeof value.spentSoFar === 'string') &&
    (value.rollbackImpact === undefined || typeof value.rollbackImpact === 'string') &&
    (value.chosen === undefined || typeof value.chosen === 'string') &&
    (value.name === undefined || typeof value.name === 'string') &&
    (value.fileKind === undefined || typeof value.fileKind === 'string') &&
    (value.producedBy === undefined || typeof value.producedBy === 'string') &&
    (value.files === undefined || isNonNegativeFiniteNumber(value.files)) &&
    (value.added === undefined || isNonNegativeFiniteNumber(value.added)) &&
    (value.removed === undefined || isNonNegativeFiniteNumber(value.removed)) &&
    (value.paths === undefined || isNonEmptyStringArray(value.paths)) &&
    (value.consensus === undefined || typeof value.consensus === 'string') &&
    (value.voices === undefined || (Array.isArray(value.voices) && value.voices.every(isAtelierNegoVoice))) &&
    (value.options === undefined || (Array.isArray(value.options) && value.options.every(isAtelierDecisionOption))) &&
    (value.meta === undefined || isRecord(value.meta))
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

function isAtelierStreamBlockKind(value: unknown): value is string {
  return typeof value === 'string' && (ATELIER_STREAM_BLOCK_KINDS as readonly string[]).includes(value);
}

function isAtelierNegoVoice(value: unknown): value is AtelierNegoVoice {
  return (
    isRecord(value) &&
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

function isAtelierDecisionOption(value: unknown): value is AtelierDecisionOption {
  return (
    isRecord(value) &&
    typeof value.text === 'string' &&
    (value.recommended === undefined || typeof value.recommended === 'boolean')
  );
}

function isAtelierTodoItem(value: unknown): value is AtelierTodoItem {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.text) &&
    isOneOfString(value.status, ATELIER_TODO_STATUSES)
  );
}

function isAtelierTaskContext(value: unknown): value is AtelierTaskContext {
  return (
    isRecord(value) &&
    isNonNegativeFiniteNumber(value.usedPct) &&
    value.usedPct <= 100 &&
    Array.isArray(value.files) &&
    value.files.every(isAtelierContextFile)
  );
}

function isAtelierContextFile(value: unknown): value is AtelierContextFile {
  return (
    isRecord(value) &&
    isNonEmptyString(value.name) &&
    isOneOfString(value.group, ATELIER_CONTEXT_FILE_GROUPS)
  );
}

function isAtelierArtifactProjection(value: unknown, taskId?: string): value is AtelierArtifactProjection {
  if (!isRecord(value)) return false;
  for (const field of ATELIER_ARTIFACT_FORBIDDEN_BODY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) return false;
  }
  const artifactId = isNonEmptyString(value.id) ? value.id : undefined;
  return (
    artifactId !== undefined &&
    (value.name === undefined || typeof value.name === 'string') &&
    (value.kind === undefined || isOneOfString(value.kind, ATELIER_ARTIFACT_KINDS)) &&
    (value.meta === undefined || typeof value.meta === 'string') &&
    (value.previewHint === undefined || isArtifactPreviewHint(value.previewHint)) &&
    (value.bodyRef === undefined || isAtelierArtifactBodyRef(value.bodyRef, taskId, artifactId)) &&
    (value.bodyHash === undefined || typeof value.bodyHash === 'string') &&
    (value.bodySize === undefined || typeof value.bodySize === 'string') &&
    (value.bodyKind === undefined || isOneOfString(value.bodyKind, ATELIER_ARTIFACT_BODY_KINDS)) &&
    (value.paths === undefined || (Array.isArray(value.paths) && value.paths.every((item) => typeof item === 'string'))) &&
    (value.size === undefined || typeof value.size === 'string') &&
    (value.previewTarget === undefined || isAtelierArtifactPreviewTarget(value.previewTarget, taskId, artifactId))
  );
}

function isArtifactPreviewHint(value: unknown): value is AtelierArtifactProjection['previewHint'] {
  return typeof value === 'string' && (ATELIER_ARTIFACT_PREVIEW_HINTS as readonly string[]).includes(value);
}

function isAtelierArtifactBodyRef(value: unknown, taskId?: string, artifactId?: string): value is string {
  return isAtelierArtifactRef(value, ATELIER_ARTIFACT_BODY_REF_SHAPE, taskId, artifactId);
}

function isAtelierArtifactPreviewTarget(value: unknown, taskId?: string, artifactId?: string): value is AtelierArtifactPreviewTarget {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    if (!(ATELIER_ARTIFACT_PREVIEW_TARGET_FIELDS as readonly string[]).includes(key)) return false;
  }
  for (const field of ATELIER_ARTIFACT_FORBIDDEN_BODY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) return false;
  }
  return (
    (value.kind === undefined || isOneOfString(value.kind, ATELIER_ARTIFACT_KINDS)) &&
    isAtelierArtifactPreviewTargetMode(value.mode) &&
    (value.label === undefined || typeof value.label === 'string') &&
    isAtelierArtifactPreviewTargetSandboxRef(value.sandboxRef, taskId, artifactId) &&
    isAtelierArtifactBodyRef(value.bodyRef, taskId, artifactId)
  );
}

function isAtelierArtifactPreviewTargetMode(value: unknown): value is string {
  return typeof value === 'string' && (ATELIER_ARTIFACT_PREVIEW_TARGET_MODES as readonly string[]).includes(value);
}

function isAtelierArtifactPreviewTargetSandboxRef(value: unknown, taskId?: string, artifactId?: string): value is string {
  return isAtelierArtifactRef(value, ATELIER_ARTIFACT_SANDBOX_REF_SHAPE, taskId, artifactId);
}

function isAtelierArtifactRef(
  value: unknown,
  shape: { scheme: string; pathSegments: number; terminalSegment: string },
  taskId?: string,
  artifactId?: string,
): value is string {
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

function isAtelierGateProjection(value: unknown): value is AtelierGateProjection {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    (value.name === undefined || typeof value.name === 'string') &&
    (value.status === undefined || isOneOfString(value.status, ATELIER_GATE_STATUSES)) &&
    (value.summary === undefined || typeof value.summary === 'string') &&
    (value.checks === undefined || (Array.isArray(value.checks) && value.checks.every(isAtelierGateCheck))) &&
    (value.artifactIds === undefined || (Array.isArray(value.artifactIds) && value.artifactIds.every((item) => typeof item === 'string'))) &&
    (value.at === undefined || typeof value.at === 'string')
  );
}

function isAtelierGateCheck(value: unknown): value is AtelierGateCheck {
  return (
    isRecord(value) &&
    isNonEmptyString(value.name) &&
    isOneOfString(value.status, ATELIER_GATE_CHECK_STATUSES) &&
    (value.detail === undefined || typeof value.detail === 'string')
  );
}

function isAtelierReplayRecord(value: unknown, taskIds?: ReadonlySet<string>): value is Record<string, AtelierReplayState> {
  return (
    isRecord(value) &&
    Object.entries(value).every(([key, item]) =>
      isNonEmptyString(key) &&
      (taskIds === undefined || taskIds.has(key)) &&
      isRecord(item) &&
      isNonEmptyString(item.source) &&
      isNonNegativeFiniteNumber(item.eventCount) &&
      isNonNegativeFiniteNumber(item.replayedEventCount) &&
      isNonNegativeFiniteNumber(item.nextEventSeq) &&
      typeof item.hasMore === 'boolean' &&
      (item.checkpointId === undefined || isNonEmptyString(item.checkpointId)) &&
      (item.checkpointEventSeq === undefined || isNonNegativeFiniteNumber(item.checkpointEventSeq))
    )
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function isKnownTaskArtifactRecordList(
  value: unknown,
  taskIds: ReadonlySet<string>,
): value is Record<string, AtelierArtifactProjection[]> {
  return (
    isRecord(value) &&
    Object.entries(value).every(([key, items]) =>
      taskIds.has(key) && Array.isArray(items) && items.every((item) => isAtelierArtifactProjection(item, key)),
    )
  );
}

function isRecordValue<T>(value: unknown, itemGuard: (item: unknown) => item is T): value is Record<string, T> {
  return (
    isRecord(value) &&
    Object.entries(value).every(([key, item]) => isNonEmptyString(key) && itemGuard(item))
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
