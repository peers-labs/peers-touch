import { api, type AgentWorkspaceEntry } from '../../services/desktop_api';

// Bounded, real workspace file index for the composer "+" file-search entry.
// The Station fs API only lists one directory per call and requires a local
// authorized project root, so this walks the tree breadth-first with hard
// caps and an ignore list. It never invents entries: every row comes from a
// real agentWorkspaceFsList response, and a missing workspace surfaces as an
// explicit unavailable state rather than fake results.

export const FILE_SEARCH_IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  '.next',
  '.turbo',
  'coverage',
  '.cache',
  'out',
  'vendor',
]);

// Safety caps keep the popover responsive on large repositories.
export const FILE_SEARCH_MAX_FILES = 400;
export const FILE_SEARCH_MAX_DIRS = 120;

// Error code returned by the Rust fs command when no local project is active
// (the private Station sandbox explicitly rejects file browsing).
export const WORKSPACE_UNAVAILABLE_CODE = 'agent.workspaceRemoteSandbox';

export function isIgnoredDir(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('.')) return true;
  return FILE_SEARCH_IGNORE_DIRS.has(trimmed);
}

export function matchesFileName(entry: AgentWorkspaceEntry, needle: string): boolean {
  if (entry.isDir) return false;
  const query = needle.trim().toLowerCase();
  if (!query) return true;
  return entry.name.toLowerCase().includes(query)
    || entry.relativePath.toLowerCase().includes(query);
}

export interface FileSearchIndex {
  files: AgentWorkspaceEntry[];
  /** True when one of the safety caps was reached before walking completed. */
  capped: boolean;
}

export function isWorkspaceUnavailableError(error: unknown): boolean {
  const code = (error as { code?: string; message?: string })?.code
    ?? (error as { message?: string })?.message
    ?? '';
  return code.includes(WORKSPACE_UNAVAILABLE_CODE);
}

// Breadth-first walk of the authorized workspace. Symlinked directories are
// skipped to avoid cycles; ignored/hidden directories are never descended.
export async function buildWorkspaceFileIndex(): Promise<FileSearchIndex> {
  const files: AgentWorkspaceEntry[] = [];
  const queue: string[] = [''];
  let visitedDirs = 0;
  let capped = false;

  while (queue.length > 0) {
    if (visitedDirs >= FILE_SEARCH_MAX_DIRS) {
      capped = true;
      break;
    }
    const path = queue.shift()!;
    visitedDirs += 1;
    const listing = await api.agentWorkspaceFsList(path);
    for (const entry of listing.entries) {
      if (entry.isDir) {
        if (!entry.isSymlink && !isIgnoredDir(entry.name)) {
          queue.push(entry.relativePath);
        }
      } else {
        files.push(entry);
        if (files.length >= FILE_SEARCH_MAX_FILES) {
          capped = true;
          break;
        }
      }
    }
    if (capped) break;
  }

  return { files, capped };
}
