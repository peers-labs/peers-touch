// Agent Prototype — Domain Model Types
// Defines the core data structures for the dual-surface agent management UI.
// Surface A: "Agents" — list + profile configuration
// Surface B: "Atelier" — workbench (task stream + context panel)

// -- Surface type --

export type Surface = 'agents' | 'atelier';

// -- Agent domain model --

export interface Agent {
  id: string;
  name: string;
  avatar: string; // color hex for avatar circle
  description: string;
  model: string;
  provider: string;
  pinned: boolean;
  workspacePath: string;
  temperature: number;
}

export type AgentProfileTab =
  | 'soul'
  | 'skills'
  | 'tools'
  | 'knowledge'
  | 'tasks'
  | 'memories'
  | 'workspace';

// -- Atelier domain model (task workbench) --

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

export type TaskStatus = 'active' | 'archived' | 'deleted';
export type TaskMode = 'work' | 'code' | 'design';

export interface Task {
  id: string;
  project: string;
  title: string;
  status: TaskStatus;
  running?: boolean;
  branch?: string;
}

export interface Voice {
  role: Role;
  stance: 'proposal' | 'objection' | 'counter' | 'signoff';
  text: string;
}

export interface ContextFile {
  name: string;
  group: 'files' | 'other';
}

export interface TaskContext {
  usedPct: number;
  files: ContextFile[];
}

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export type Block =
  | { kind: 'user'; id: string; text: string; at?: string }
  | { kind: 'agent'; id: string; text: string; bullets?: string[]; at?: string; done?: boolean }
  | { kind: 'nego'; id: string; summary: string; agentCount: number; converged: boolean; voices: Voice[]; consensus?: string }
  | { kind: 'decision'; id: string; question: string; spentSoFar?: string; options: { text: string; recommended?: boolean }[]; rollbackImpact?: string }
  | { kind: 'artifact'; id: string; name: string; fileKind: string; producedBy: string }
  | { kind: 'diff'; id: string; files: number; added: number; removed: number; paths: string[] }
  | { kind: 'tool-call'; id: string; tool: string; status: 'running' | 'done' | 'failed'; duration?: string; output?: string };

// -- Unified snapshot for runtime --

export interface AgentSnapshot {
  // Agent surface state
  agents: Agent[];
  selectedAgentId: string;

  // Atelier surface state
  tasks: Task[];
  selectedTaskId: string;
  stream: Record<string, Block[]>;
  context: Record<string, TaskContext>;
  todos: Record<string, TodoItem[]>;
  model: string;
}
