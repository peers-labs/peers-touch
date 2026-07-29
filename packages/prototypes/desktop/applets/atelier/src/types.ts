/**
 * Atelier prototype — conversation-first model (SOLO-style).
 *
 * Atelier is a personal Agent workbench. The surface is a single
 * conversation stream (like TRAE Work), NOT a team project board.
 * Its soul — multi-agent negotiation — is folded INTO the chat stream:
 * a collapsed "agents negotiated X" row that expands to roles / evidence /
 * consensus, and a decision card that surfaces inline only when the user
 * must decide.
 *
 * Light shapes for a design prototype; real schema lives in
 * docs/architecture/atelier/data-model.md.
 */
import type { ReactElement } from 'react';
import type { ATELIER_PROJECTION_CONTRACT } from './projection.contract.generated';
import type { AtelierTaskOrganizerMode } from './projection.contract.generated';
import type {
  ATELIER_ARTIFACT_BODY_KINDS,
  ATELIER_ARTIFACT_KINDS,
  ATELIER_CONTEXT_FILE_GROUPS,
  ATELIER_GATE_CHECK_STATUSES,
  ATELIER_GATE_STATUSES,
  ATELIER_TASK_INTENT_PRESETS,
  ATELIER_TODO_STATUSES,
  AtelierArtifactPreviewHint,
  AtelierBudgetStatus,
  AtelierTaskLifecycleStatus,
} from './projection.contract.generated';

/** Nine-role power structure (functional-modules §2 M2). */
export type Role =
  | 'GoalOwner'
  | 'Architect'
  | 'Planner'
  | 'Risk'
  | 'Supervisor'
  | 'Executor'
  | 'Verifier'
  | 'Integrator'
  | 'Historian';

/**
 * Task lifecycle. The generated projection contract owns the complete
 * lifecycle: active -> archived -> deleted (recycle bin), each reversible
 * until purged.
 */
export type TaskStatus = AtelierTaskLifecycleStatus;
export type TaskIntentPreset = (typeof ATELIER_TASK_INTENT_PRESETS)[number];
export type ArtifactKind = (typeof ATELIER_ARTIFACT_KINDS)[number];
export type ArtifactBodyKind = (typeof ATELIER_ARTIFACT_BODY_KINDS)[number];
export type GateStatus = (typeof ATELIER_GATE_STATUSES)[number];
export type GateCheckStatus = (typeof ATELIER_GATE_CHECK_STATUSES)[number];
export type TodoStatus = (typeof ATELIER_TODO_STATUSES)[number];
export type ContextFileGroup = (typeof ATELIER_CONTEXT_FILE_GROUPS)[number];

/** A task in the left list (SOLO "Your Task List"). */
export interface Task {
  id: string;
  /** repo / project folder this task belongs to (SOLO groups by this) */
  project: string;
  /** Station-owned project projection id. */
  projectId?: string;
  title: string;
  /** lifecycle state; defaults to 'active' */
  status: TaskStatus;
  /** running shows a spinner dot, like SOLO */
  running?: boolean;
  /** git branch / worktree this task is bound to (SOLO shows a branch icon) */
  branch?: string;
  /** Declarative Station preset selected by the Work / Code / Design toggle. */
  intentPreset?: TaskIntentPreset;
  /** Station-owned provider strategy default; not a provider invocation. */
  providerStrategyPreset?: string;
  /** Station-owned gate plan default; not applet-produced gate evidence. */
  gatePlanPreset?: string;
  /** Host-owned open target; never expose raw local paths to the applet. */
  workspaceOpenTarget?: WorkspaceOpenTarget;
}

export interface WorkspaceOpenTarget {
  workspaceId: string;
  workspaceUri: string;
  label: string;
  ideHint?: string;
}

/* ── Chat stream blocks ── */

/** Plain user message bubble (right-aligned). May carry an image attachment. */
export interface UserMsg {
  kind: 'user';
  id: string;
  text: string;
  at: string;
  /** optional image attachment chip (SOLO supports image messages) */
  image?: { name: string; size: string };
}

/**
 * Agent reply. `text` is rendered as light markdown (paragraphs, `code`,
 * lists). A finished reply shows a Completed marker + a feedback bar
 * (up / down / copy / regenerate) like SOLO.
 */
export interface AgentMsg {
  kind: 'agent';
  id: string;
  text: string;
  bullets?: string[];
  at?: string;
  done?: boolean;
}

/** One voice inside a negotiation. */
export interface NegoVoice {
  role: Role;
  stance: AtelierNegotiationVoiceStance;
  text: string;
  /** objections/approvals must carry evidence (M3 anti-sycophancy) */
  evidenceRef?: string;
  sessionId?: string;
  roundId?: string;
  voiceId?: string;
  objectionId?: string;
}

export type AtelierNegotiationVoiceStance =
  (typeof ATELIER_PROJECTION_CONTRACT.negotiationProjection.voiceStances)[number];

/**
 * Multi-agent negotiation, folded into the stream.
 * Collapsed: one summary line. Expanded: the voices + consensus.
 */
export interface NegoBlock {
  kind: 'nego';
  id: string;
  summary: string;
  /** how many agents took part — shown on the collapsed row */
  agentCount: number;
  converged: boolean;
  voices: NegoVoice[];
  consensus: string;
}

/** A decision the user must make — surfaces inline in the stream (M7). */
export interface DecisionBlock {
  kind: 'decision';
  id: string;
  question: string;
  spentSoFar: string;
  options: { text: string; recommended?: boolean }[];
  rollbackImpact: string;
  /** once user picks, store the choice */
  chosen?: string;
}

/** An artifact card in the stream (M8/M9). */
export interface ArtifactBlock {
  kind: 'artifact';
  id: string;
  name: string;
  fileKind: 'diff' | 'report' | 'data' | 'pdf';
  producedBy: string;
}

/** A "N files changed" diff summary card in the stream (SOLO-style). */
export interface DiffBlock {
  kind: 'diff';
  id: string;
  files: number;
  added: number;
  removed: number;
  /** changed file paths, shown when expanded */
  paths: string[];
}

export type Block = UserMsg | AgentMsg | NegoBlock | DecisionBlock | ArtifactBlock | DiffBlock;

/**
 * A produced artifact, listed in the Artifacts tray and opened in the right
 * preview panel. Projection remains metadata-only: body text comes from
 * `atelier.artifact.body.fetch`, and visual preview intent goes through Host
 * sandbox metadata in `previewTarget`.
 */
export interface Artifact {
  id: string;
  name: string;
  kind: ArtifactKind;
  meta: string;
  previewHint?: AtelierArtifactPreviewHint;
  bodyRef?: string;
  bodyHash?: string;
  bodySize?: string | number;
  bodyKind?: ArtifactBodyKind;
  previewTarget?: {
    kind?: string;
    mode?: string;
    label?: string;
    sandboxRef?: string;
    bodyRef?: string;
  };
  /** mock console output for the web preview panel (kind 'web') */
  logs?: ConsoleLog[];
  /** changed file paths (kind 'diff') */
  paths?: string[];
  /** metadata-only size label (kind 'image' or binary artifact) */
  size?: string;
}

/** Gate / verification result projected from the orchestration layer. */
export interface GateResult {
  id: string;
  name: string;
  status: GateStatus;
  summary: string;
  checks: { name: string; status: GateCheckStatus; detail?: string }[];
  artifactIds?: string[];
  at?: string;
}

/** One line in the web preview's Console Logs panel. */
export interface ConsoleLog {
  level: 'log' | 'info' | 'warn' | 'error';
  text: string;
}

/** Right side Todo panel (only when a task is complex), like SOLO. */
export interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
}

export interface AtelierDependencyEdge {
  from: string;
  to: string;
  type: string;
}

export interface AtelierTaskNodeProjection {
  id: string;
  title: string;
  state: string;
  agentRole: string;
  artifactIds: string[];
  gateIds: string[];
}

export interface AtelierTaskGraphProjection {
  rootTaskIds: string[];
  tasks: AtelierTaskNodeProjection[];
  edges: AtelierDependencyEdge[];
  parallelPolicy: string;
}

export interface AtelierMilestoneProjection {
  id: string;
  title: string;
  state: string;
  taskIds: string[];
  acceptancePredicateIds: string[];
  openBlockers: AtelierProjectBlocker[];
}

export interface AtelierMilestoneTreeProjection {
  rootId: string;
  milestones: AtelierMilestoneProjection[];
  edges: AtelierDependencyEdge[];
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

export interface AtelierProjectCompletion {
  noOpenBlockers: boolean;
  l0L1AcceptancePassed: boolean;
  l2HumanSignoffComplete: boolean;
  residualRisksLogged: boolean;
  memoryCandidatesGenerated: boolean;
}

export interface AtelierPolicyRule {
  id: string;
  scope: string;
  expr: string;
  severity: string;
}

export interface AtelierPolicyProjection {
  id: string;
  rules: AtelierPolicyRule[];
  hardDeny: boolean;
}

export interface AtelierDefectProposal {
  summary: string;
  expectedChange: string;
  targetRefs: string[];
}

export interface AtelierDefectProjection {
  id: string;
  taskId: string;
  source: string;
  state: string;
  evidenceRef: string;
  proposal: AtelierDefectProposal;
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
  milestoneTree: AtelierMilestoneTreeProjection;
  taskGraph: AtelierTaskGraphProjection;
  policy?: AtelierPolicyProjection;
  defects: AtelierDefectProjection[];
}

/** A file touched in the current task — listed in the right Context panel. */
export interface ContextFile {
  name: string;
  /** Generated Station context projection group shown in the Context panel. */
  group: ContextFileGroup;
}

/** Right-side Context panel (token usage + touched files), like SOLO. */
export interface TaskContext {
  /** % of the model context window used (SOLO shows a bar + "45%") */
  usedPct: number;
  files: ContextFile[];
}

export interface AtelierState {
  budgetSpent: number;
  budgetCap: number;
  budget?: BudgetProjection;
  /** model picked in the composer model selector (SOLO: openrouter-3o) */
  model: string;
  tasks: Task[];
  /** Station-owned project projections; consumed read-only by the applet. */
  projects?: AtelierProjectProjection[];
  selectedTaskId: string;
  /** chat stream per task */
  stream: Record<string, Block[]>;
  /** optional todo per task */
  todos: Record<string, TodoItem[]>;
  /** optional context (token usage + files) per task */
  context: Record<string, TaskContext>;
  /** produced artifacts per task, shown in the Artifacts tray */
  artifacts: Record<string, Artifact[]>;
  /** gate / verification results per task, projected separately from artifacts */
  gates: Record<string, GateResult[]>;
}

export interface BudgetProjection {
  status: AtelierBudgetStatus;
  summary: string;
  dimensions: BudgetDimensionProjection[];
  decisionHint?: string;
}

export interface BudgetDimensionProjection {
  id: string;
  label: string;
  used: number;
  cap: number;
  unit: string;
  percent: number;
  status: AtelierBudgetStatus;
}

/* ── Task-management plugin contract ── */

/**
 * How a task organizer plugin can manipulate the task list. The Atelier
 * shell owns the data; a plugin only renders the left rail and asks the
 * shell to mutate lifecycle state. This keeps "how I organize my work"
 * pluggable: a flat list, a Kanban, a DAG — same tasks, different surface.
 */
export interface TaskHost {
  tasks: Task[];
  selectedId: string;
  purgeConfirmId: string;
  select(id: string): void;
  /** lifecycle transitions; the shell enforces legal moves */
  setStatus(id: string, status: TaskStatus): void;
  requestPurge(id: string): void;
  /** purge a deleted task for good (only from 'deleted') */
  purge(id: string): void;
  newTask(): void;
}

/**
 * A task-management plugin. Users pick one to decide how their tasks are
 * organized and shown. Lifecycle ops are delegated back to the host so the
 * data model stays single-sourced.
 */
export interface TaskPlugin {
  id: AtelierTaskOrganizerMode;
  /** short label for the plugin switcher */
  name: string;
  /** one-line pitch shown in the switcher */
  tagline: string;
  /** false = placeholder/coming-soon entry in the switcher */
  ready: boolean;
  /** render the left-rail body for this organizer */
  render(host: TaskHost): ReactElement;
}
