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
 * Task lifecycle. The user wants a *complete* lifecycle for a personal
 * workbench: active -> archived -> deleted (recycle bin), each reversible
 * until purged.
 */
export type TaskStatus = 'active' | 'archived' | 'deleted';

/** A task in the left list (SOLO "Your Task List"). */
export interface Task {
  id: string;
  /** repo / project folder this task belongs to (SOLO groups by this) */
  project: string;
  title: string;
  /** lifecycle state; defaults to 'active' */
  status: TaskStatus;
  /** running shows a spinner dot, like SOLO */
  running?: boolean;
  /** git branch / worktree this task is bound to (SOLO shows a branch icon) */
  branch?: string;
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
  /** proposal | objection | counter | signoff */
  stance: 'proposal' | 'objection' | 'counter' | 'signoff';
  text: string;
  /** objections/approvals must carry evidence (M3 anti-sycophancy) */
  evidenceRef?: string;
}

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
 * preview panel. The `kind` decides how the preview renders:
 *   - markdown : rendered document
 *   - web      : a real embedded browser (<iframe>) pointing at a running URL,
 *                plus console logs. This is a web prototype, so the iframe is
 *                embedded directly. See prototype/README.md.
 *   - image    : an image preview
 *   - diff     : a touched-file list
 */
export interface Artifact {
  id: string;
  name: string;
  kind: 'markdown' | 'web' | 'image' | 'diff';
  meta: string;
  /** markdown source (kind 'markdown') */
  markdown?: string;
  /** URL the embedded iframe browser points at (kind 'web') */
  url?: string;
  /** mock console output for the web preview panel (kind 'web') */
  logs?: ConsoleLog[];
  /** changed file paths (kind 'diff') */
  paths?: string[];
  /** image src + size (kind 'image') */
  src?: string;
  size?: string;
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
  status: 'done' | 'running' | 'todo';
}

/** A file touched in the current task — listed in the right Context panel. */
export interface ContextFile {
  name: string;
  /** 'file' | 'other' tab in SOLO's Context panel */
  group: 'files' | 'other';
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
  /** model picked in the composer model selector (SOLO: openrouter-3o) */
  model: string;
  tasks: Task[];
  selectedTaskId: string;
  /** chat stream per task */
  stream: Record<string, Block[]>;
  /** optional todo per task */
  todos: Record<string, TodoItem[]>;
  /** optional context (token usage + files) per task */
  context: Record<string, TaskContext>;
  /** produced artifacts per task, shown in the Artifacts tray */
  artifacts: Record<string, Artifact[]>;
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
  select(id: string): void;
  /** lifecycle transitions; the shell enforces legal moves */
  setStatus(id: string, status: TaskStatus): void;
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
  id: string;
  /** short label for the plugin switcher */
  name: string;
  /** one-line pitch shown in the switcher */
  tagline: string;
  /** false = placeholder/coming-soon entry in the switcher */
  ready: boolean;
  /** render the left-rail body for this organizer */
  render(host: TaskHost): ReactElement;
}
