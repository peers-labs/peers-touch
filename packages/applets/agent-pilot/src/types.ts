/**
 * Agent Pilot types — aligned with vibe-kanban / backend store.
 */

export interface Project {
  id: string;
  organization_id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectStatus {
  id: string;
  project_id: string;
  name: string;
  color: string;
  sort_order: number;
  hidden: boolean;
  created_at: string;
}

export interface Issue {
  id: string;
  project_id: string;
  issue_number: number;
  simple_id: string;
  status_id: string;
  title: string;
  description?: string;
  priority?: string;
  start_date?: string;
  target_date?: string;
  completed_at?: string;
  sort_order: number;
  parent_issue_id?: string;
  parent_issue_sort_order?: number;
  extension_metadata?: string;
  created_at: string;
  updated_at: string;
}

export interface Repo {
  id: string;
  path: string;
  name?: string;
  display_name?: string;
  setup_script?: string;
  cleanup_script?: string;
  dev_server_script?: string;
  default_target_branch?: string;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  name?: string;
  branch: string;
  setup_completed_at?: string;
  archived: boolean;
  pinned: boolean;
  worktree_deleted: boolean;
  created_at: string;
  updated_at: string;
}
