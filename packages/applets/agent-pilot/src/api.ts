/**
 * Agent Pilot API — wraps sdk.invoke('applets_action', payload).
 */
import { sdk } from '@peers-touch/applet-sdk';
import type { Issue, Project, ProjectStatus, Repo, Workspace } from './types';

const ID = 'agent-pilot';

function appletAction<T>(action: string, params?: Record<string, unknown>): Promise<T> {
  return sdk.invoke<T>('applets_action', { id: ID, action, params });
}

export async function listProjects(): Promise<Project[]> {
  const data = await appletAction<{ projects: Project[] }>('list-projects');
  return data.projects ?? [];
}

export async function createProject(params: { name: string; color?: string; sort_order?: number }): Promise<Project> {
  const data = await appletAction<{ project: Project }>('create-project', params);
  return data.project;
}

export async function listProjectStatuses(projectId: string): Promise<ProjectStatus[]> {
  const data = await appletAction<{ statuses: ProjectStatus[] }>('list-project-statuses', {
    project_id: projectId,
  });
  return data.statuses ?? [];
}

export async function listIssues(params: {
  project_id: string;
  status_id?: string;
  limit?: number;
  offset?: number;
}): Promise<{ issues: Issue[]; total: number }> {
  const data = await appletAction<{ issues: Issue[]; total: number }>('list-issues', params);
  return { issues: data.issues ?? [], total: data.total ?? 0 };
}

export async function createIssue(params: {
  project_id: string;
  title: string;
  description?: string;
  status_id?: string;
  priority?: string;
  sort_order?: number;
}): Promise<Issue> {
  const data = await appletAction<{ issue: Issue }>('create-issue', params);
  return data.issue;
}

export async function updateIssue(id: string, changes: Partial<Pick<Issue, 'title' | 'description' | 'status_id' | 'priority'>>): Promise<Issue> {
  const data = await appletAction<{ issue: Issue }>('update-issue', { id, ...changes });
  return data.issue;
}

export async function updateIssueStatus(id: string, statusId: string, sortOrder?: number): Promise<Issue> {
  const data = await appletAction<{ issue: Issue }>('update-issue-status', {
    id,
    status_id: statusId,
    sort_order: sortOrder ?? 0,
  });
  return data.issue;
}

export async function listRepos(): Promise<Repo[]> {
  const data = await appletAction<{ repos: Repo[] }>('list-repos');
  return data.repos ?? [];
}

export async function registerRepo(params: { path: string; display_name?: string }): Promise<Repo> {
  const data = await appletAction<{ repo: Repo }>('register-repo', params);
  return data.repo;
}

export async function listWorkspaces(params?: { archived?: boolean }): Promise<Workspace[]> {
  const data = await appletAction<{ workspaces: Workspace[] }>('list-workspaces', params ?? {});
  return data.workspaces ?? [];
}

export async function createWorkspace(params: { name: string; branch?: string }): Promise<Workspace> {
  const data = await appletAction<{ workspace: Workspace }>('create-workspace', params);
  return data.workspace;
}

export async function getWorkspace(id: string): Promise<Workspace> {
  const data = await appletAction<{ workspace: Workspace }>('get-workspace', { id });
  return data.workspace;
}
