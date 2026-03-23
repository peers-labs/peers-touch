/**
 * Agent Pilot API — wraps api.appletAction('agent-pilot', action, params).
 */
import { api } from '../../services/api';
import type { Attachment, Issue, IssueComment, IssueRelationship, Project, ProjectStatus, Repo, Tag, Workspace } from './types';

const ID = 'agent-pilot';

export async function listProjects(): Promise<Project[]> {
  const data = await api.appletAction<{ projects: Project[] }>(ID, 'list-projects');
  return data.projects ?? [];
}

export async function createProject(params: { name: string; color?: string; sort_order?: number }): Promise<Project> {
  const data = await api.appletAction<{ project: Project }>(ID, 'create-project', params);
  return data.project;
}

export async function listProjectStatuses(projectId: string): Promise<ProjectStatus[]> {
  const data = await api.appletAction<{ statuses: ProjectStatus[] }>(ID, 'list-project-statuses', {
    project_id: projectId,
  });
  return data.statuses ?? [];
}

export async function listIssues(params: {
  project_id: string;
  status_id?: string;
  limit?: number;
  offset?: number;
}): Promise<{ issues: Issue[]; total: number; tags_by_issue: Record<string, Tag[]>; workspaces_by_issue?: Record<string, string[]> }> {
  const data = await api.appletAction<{
    issues: Issue[];
    total: number;
    tags_by_issue?: Record<string, Tag[]>;
    workspaces_by_issue?: Record<string, string[]>;
  }>(ID, 'list-issues', params);
  return {
    issues: data.issues ?? [],
    total: data.total ?? 0,
    tags_by_issue: data.tags_by_issue ?? {},
    workspaces_by_issue: data.workspaces_by_issue ?? {},
  };
}

export async function createIssue(params: {
  project_id: string;
  title: string;
  description?: string;
  status_id?: string;
  priority?: string;
  assignee?: string;
  parent_issue_id?: string;
  tag_ids?: string[];
  sort_order?: number;
}): Promise<Issue> {
  const { tag_ids, ...rest } = params;
  const payload: Record<string, unknown> = rest;
  if (tag_ids?.length) payload.tag_ids = tag_ids;
  const data = await api.appletAction<{ issue: Issue }>(ID, 'create-issue', payload);
  return data.issue;
}

export async function updateIssue(id: string, changes: Partial<Pick<Issue, 'title' | 'description' | 'status_id' | 'priority' | 'assignee' | 'parent_issue_id'> & { tag_ids?: string[] }>): Promise<Issue> {
  const { tag_ids, ...rest } = changes;
  const payload: Record<string, unknown> = { id, ...rest };
  if (tag_ids !== undefined) payload.tag_ids = tag_ids;
  const data = await api.appletAction<{ issue: Issue }>(ID, 'update-issue', payload);
  return data.issue;
}

export async function listTags(projectId: string): Promise<Tag[]> {
  const data = await api.appletAction<{ tags: Tag[] }>(ID, 'list-tags', { project_id: projectId });
  return data.tags ?? [];
}

export async function createTag(params: { project_id: string; name: string; color?: string }): Promise<Tag> {
  const data = await api.appletAction<{ tag: Tag }>(ID, 'create-tag', params);
  return data.tag;
}

export async function setIssueTags(issueId: string, tagIds: string[]): Promise<void> {
  await api.appletAction(ID, 'set-issue-tags', { issue_id: issueId, tag_ids: tagIds });
}

export async function updateIssueStatus(id: string, statusId: string, sortOrder?: number): Promise<Issue> {
  const data = await api.appletAction<{ issue: Issue }>(ID, 'update-issue-status', {
    id,
    status_id: statusId,
    sort_order: sortOrder ?? 0,
  });
  return data.issue;
}

export async function listRepos(): Promise<Repo[]> {
  const data = await api.appletAction<{ repos: Repo[] }>(ID, 'list-repos');
  return data.repos ?? [];
}

export async function registerRepo(params: { path: string; display_name?: string }): Promise<Repo> {
  const data = await api.appletAction<{ repo: Repo }>(ID, 'register-repo', params);
  return data.repo;
}

export async function listWorkspaces(params?: { archived?: boolean }): Promise<Workspace[]> {
  const data = await api.appletAction<{ workspaces: Workspace[] }>(ID, 'list-workspaces', params ?? {});
  return data.workspaces ?? [];
}

export async function createWorkspace(params: { name: string; branch?: string }): Promise<Workspace> {
  const data = await api.appletAction<{ workspace: Workspace }>(ID, 'create-workspace', params);
  return data.workspace;
}

export async function getWorkspace(id: string): Promise<Workspace> {
  const data = await api.appletAction<{ workspace: Workspace }>(ID, 'get-workspace', { id });
  return data.workspace;
}

export async function updateProject(id: string, params: { name?: string; color?: string; sort_order?: number }): Promise<Project> {
  const data = await api.appletAction<{ project: Project }>(ID, 'update-project', { id, ...params });
  return data.project;
}

export async function deleteProject(id: string): Promise<void> {
  await api.appletAction(ID, 'delete-project', { id });
}

export async function createStatus(params: {
  project_id: string;
  name: string;
  color?: string;
  sort_order?: number;
  hidden?: boolean;
}): Promise<ProjectStatus> {
  const data = await api.appletAction<{ status: ProjectStatus }>(ID, 'create-status', params);
  return data.status;
}

export async function updateStatus(id: string, params: { name?: string; color?: string; sort_order?: number; hidden?: boolean }): Promise<ProjectStatus> {
  const data = await api.appletAction<{ status: ProjectStatus }>(ID, 'update-status', { id, ...params });
  return data.status;
}

export async function deleteStatus(id: string): Promise<void> {
  await api.appletAction(ID, 'delete-status', { id });
}

export async function deleteIssue(id: string): Promise<void> {
  await api.appletAction(ID, 'delete-issue', { id });
}

export async function duplicateIssue(id: string): Promise<Issue> {
  const data = await api.appletAction<{ issue: Issue }>(ID, 'duplicate-issue', { id });
  return data.issue;
}

export async function bulkUpdateIssues(
  ids: string[],
  updates: { status_id?: string; priority?: string; assignee?: string },
): Promise<{ updated: number }> {
  const data = await api.appletAction<{ updated: number }>(ID, 'bulk-update-issues', { ids, ...updates });
  return data;
}

export async function updateWorkspace(id: string, params: { name?: string; branch?: string; archived?: boolean; pinned?: boolean }): Promise<Workspace> {
  const data = await api.appletAction<{ workspace: Workspace }>(ID, 'update-workspace', { id, ...params });
  return data.workspace;
}

export async function deleteWorkspace(id: string): Promise<void> {
  await api.appletAction(ID, 'delete-workspace', { id });
}

export async function linkWorkspaceIssue(workspaceId: string, issueId: string): Promise<void> {
  await api.appletAction(ID, 'link-workspace-issue', { workspace_id: workspaceId, issue_id: issueId });
}

export async function unlinkWorkspaceIssue(workspaceId: string, issueId: string): Promise<void> {
  await api.appletAction(ID, 'unlink-workspace-issue', { workspace_id: workspaceId, issue_id: issueId });
}

export async function getIssueWorkspaces(issueId: string): Promise<Workspace[]> {
  const data = await api.appletAction<{ workspaces: Workspace[] }>(ID, 'get-issue-workspaces', { issue_id: issueId });
  return data.workspaces ?? [];
}

export async function updateTag(id: string, params: { name?: string; color?: string }): Promise<Tag> {
  const data = await api.appletAction<{ tag: Tag }>(ID, 'update-tag', { id, ...params });
  return data.tag;
}

export async function deleteTag(id: string): Promise<void> {
  await api.appletAction(ID, 'delete-tag', { id });
}

export async function listIssueRelationships(issueId: string): Promise<IssueRelationship[]> {
  const data = await api.appletAction<{ relationships: IssueRelationship[] }>(ID, 'list-issue-relationships', {
    issue_id: issueId,
  });
  return data.relationships ?? [];
}

export async function createIssueRelationship(
  issueId: string,
  relatedIssueId: string,
  relationshipType: 'blocking' | 'related' | 'duplicate',
): Promise<IssueRelationship> {
  const data = await api.appletAction<{ relationship: IssueRelationship }>(ID, 'create-issue-relationship', {
    issue_id: issueId,
    related_issue_id: relatedIssueId,
    relationship_type: relationshipType,
  });
  return data.relationship;
}

export async function deleteIssueRelationship(id: string): Promise<void> {
  await api.appletAction(ID, 'delete-issue-relationship', { id });
}

export async function listIssueComments(issueId: string): Promise<IssueComment[]> {
  const data = await api.appletAction<{ comments: IssueComment[] }>(ID, 'list-issue-comments', { issue_id: issueId });
  return data.comments ?? [];
}

export async function createIssueComment(
  issueId: string,
  message: string,
  options?: { author?: string; parent_id?: string },
): Promise<IssueComment> {
  const data = await api.appletAction<{ comment: IssueComment }>(ID, 'create-issue-comment', {
    issue_id: issueId,
    message,
    author: options?.author ?? '',
    parent_id: options?.parent_id ?? '',
  });
  return data.comment;
}

export async function listAttachments(issueId: string): Promise<Attachment[]> {
  const data = await api.appletAction<{ attachments: Attachment[] }>(ID, 'list-attachments', { issue_id: issueId });
  return data.attachments ?? [];
}

export async function createAttachment(params: {
  issue_id: string;
  filename: string;
  content_type?: string;
  file_path: string;
}): Promise<Attachment> {
  const data = await api.appletAction<{ attachment: Attachment }>(ID, 'create-attachment', params);
  return data.attachment;
}

export async function deleteAttachment(id: string): Promise<void> {
  await api.appletAction(ID, 'delete-attachment', { id });
}

export async function getKV(key: string): Promise<string> {
  const data = await api.appletAction<{ value: string }>(ID, 'get-kv', { key });
  return data.value ?? '';
}

export async function setKV(key: string, value: string): Promise<void> {
  await api.appletAction(ID, 'set-kv', { key, value });
}

export async function duplicateWorkspace(id: string): Promise<Workspace> {
  const data = await api.appletAction<{ workspace: Workspace }>(ID, 'duplicate-workspace', { id });
  return data.workspace;
}
