import { sdk } from '@peers-touch/applet-sdk';
import type { Issue, Project, ProjectStatus, Repo, Workspace } from './types';

const STATE_KEY = 'agent-pilot.state.v1';

interface AgentPilotState {
  projects: Project[];
  statuses: ProjectStatus[];
  issues: Issue[];
  repos: Repo[];
  workspaces: Workspace[];
}

function emptyState(): AgentPilotState {
  return {
    projects: [],
    statuses: [],
    issues: [],
    repos: [],
    workspaces: [],
  };
}

function now(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

function parseStoredState(value: unknown): AgentPilotState {
  if (!value) return emptyState();
  const parsed = typeof value === 'string' ? JSON.parse(value) as Partial<AgentPilotState> : value as Partial<AgentPilotState>;
  return {
    projects: Array.isArray(parsed.projects) ? parsed.projects : [],
    statuses: Array.isArray(parsed.statuses) ? parsed.statuses : [],
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    repos: Array.isArray(parsed.repos) ? parsed.repos : [],
    workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [],
  };
}

async function readState(): Promise<AgentPilotState> {
  const stored = await sdk.storage.get<AgentPilotState | string>(STATE_KEY);
  return parseStoredState(stored);
}

async function writeState(state: AgentPilotState): Promise<void> {
  await sdk.storage.set(STATE_KEY, state);
}

function defaultStatuses(projectId: string): ProjectStatus[] {
  const createdAt = now();
  return [
    { id: createId('status'), project_id: projectId, name: 'Todo', color: '#64748b', sort_order: 0, hidden: false, created_at: createdAt },
    { id: createId('status'), project_id: projectId, name: 'In Progress', color: '#2563eb', sort_order: 1, hidden: false, created_at: createdAt },
    { id: createId('status'), project_id: projectId, name: 'Done', color: '#16a34a', sort_order: 2, hidden: false, created_at: createdAt },
  ];
}

export async function listProjects(): Promise<Project[]> {
  const state = await readState();
  return [...state.projects].sort((a, b) => a.sort_order - b.sort_order);
}

export async function createProject(params: { name: string; color?: string; sort_order?: number }): Promise<Project> {
  const state = await readState();
  const timestamp = now();
  const project: Project = {
    id: createId('project'),
    organization_id: 'local',
    name: params.name,
    color: params.color ?? '#2563eb',
    sort_order: params.sort_order ?? state.projects.length,
    created_at: timestamp,
    updated_at: timestamp,
  };

  state.projects.push(project);
  state.statuses.push(...defaultStatuses(project.id));
  await writeState(state);
  return project;
}

export async function listProjectStatuses(projectId: string): Promise<ProjectStatus[]> {
  const state = await readState();
  let statuses = state.statuses.filter((status) => status.project_id === projectId);
  if (statuses.length === 0 && state.projects.some((project) => project.id === projectId)) {
    statuses = defaultStatuses(projectId);
    state.statuses.push(...statuses);
    await writeState(state);
  }
  return statuses.sort((a, b) => a.sort_order - b.sort_order);
}

export async function listIssues(params: {
  project_id: string;
  status_id?: string;
  limit?: number;
  offset?: number;
}): Promise<{ issues: Issue[]; total: number }> {
  const state = await readState();
  const filtered = state.issues
    .filter((issue) => issue.project_id === params.project_id)
    .filter((issue) => !params.status_id || issue.status_id === params.status_id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const offset = params.offset ?? 0;
  const limit = params.limit ?? filtered.length;
  return { issues: filtered.slice(offset, offset + limit), total: filtered.length };
}

export async function createIssue(params: {
  project_id: string;
  title: string;
  description?: string;
  status_id?: string;
  priority?: string;
  sort_order?: number;
}): Promise<Issue> {
  const state = await readState();
  const statuses = await listProjectStatuses(params.project_id);
  const timestamp = now();
  const projectIssues = state.issues.filter((issue) => issue.project_id === params.project_id);
  const issueNumber = projectIssues.reduce((max, issue) => Math.max(max, issue.issue_number), 0) + 1;
  const statusId = params.status_id ?? statuses[0]?.id;
  if (!statusId) {
    throw new Error('Project has no status column');
  }

  const issue: Issue = {
    id: createId('issue'),
    project_id: params.project_id,
    issue_number: issueNumber,
    simple_id: `I-${issueNumber}`,
    status_id: statusId,
    title: params.title,
    description: params.description,
    priority: params.priority,
    sort_order: params.sort_order ?? projectIssues.length,
    created_at: timestamp,
    updated_at: timestamp,
  };
  state.issues.push(issue);
  await writeState(state);
  return issue;
}

export async function updateIssue(id: string, changes: Partial<Pick<Issue, 'title' | 'description' | 'status_id' | 'priority'>>): Promise<Issue> {
  const state = await readState();
  const index = state.issues.findIndex((issue) => issue.id === id);
  if (index < 0) {
    throw new Error(`Issue not found: ${id}`);
  }
  const issue = { ...state.issues[index], ...changes, updated_at: now() };
  state.issues[index] = issue;
  await writeState(state);
  return issue;
}

export async function updateIssueStatus(id: string, statusId: string, sortOrder?: number): Promise<Issue> {
  const changes: Partial<Pick<Issue, 'status_id'>> & { sort_order?: number } = { status_id: statusId };
  if (sortOrder !== undefined) {
    changes.sort_order = sortOrder;
  }
  return updateIssue(id, changes);
}

export async function listRepos(): Promise<Repo[]> {
  const state = await readState();
  return [...state.repos].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function registerRepo(params: { path: string; display_name?: string }): Promise<Repo> {
  const state = await readState();
  const timestamp = now();
  const existing = state.repos.find((repo) => repo.path === params.path);
  if (existing) return existing;

  const repo: Repo = {
    id: createId('repo'),
    path: params.path,
    name: params.path.split('/').filter(Boolean).pop(),
    display_name: params.display_name,
    created_at: timestamp,
    updated_at: timestamp,
  };
  state.repos.push(repo);
  await writeState(state);
  return repo;
}

export async function listWorkspaces(params?: { archived?: boolean }): Promise<Workspace[]> {
  const state = await readState();
  return state.workspaces
    .filter((workspace) => params?.archived === undefined || workspace.archived === params.archived)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function createWorkspace(params: { name: string; branch?: string }): Promise<Workspace> {
  const state = await readState();
  const timestamp = now();
  const workspace: Workspace = {
    id: createId('workspace'),
    name: params.name,
    branch: params.branch ?? 'main',
    archived: false,
    pinned: false,
    worktree_deleted: false,
    created_at: timestamp,
    updated_at: timestamp,
  };
  state.workspaces.push(workspace);
  await writeState(state);
  return workspace;
}

export async function getWorkspace(id: string): Promise<Workspace> {
  const state = await readState();
  const workspace = state.workspaces.find((item) => item.id === id);
  if (!workspace) {
    throw new Error(`Workspace not found: ${id}`);
  }
  return workspace;
}
