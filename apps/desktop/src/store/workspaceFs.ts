import {
  api,
  type AgentWorkspaceChange,
  type AgentWorkspaceEntry,
  type AgentWorkspaceFile,
  type AgentWorkspaceDiff,
} from '../services/desktop_api';
import { createDesktopStore } from './createDesktopStore';

// Root listing is cached under this key; other directories use their
// workspace-relative POSIX path.
export const ROOT_DIR_KEY = '';

export type WorkspaceFsErrorKind =
  | 'remoteSandbox'
  | 'binary'
  | 'notFound'
  | 'unavailable';

interface OpenedFile {
  path: string;
  content: string;
  truncated: boolean;
  size: number;
  diff: string;
  untracked: boolean;
  binary: boolean;
}

interface WorkspaceFsState {
  loaded: boolean;
  loading: boolean;
  errorKind: WorkspaceFsErrorKind | null;
  rootName: string;
  isGit: boolean;
  dirsByPath: Record<string, AgentWorkspaceEntry[]>;
  loadingDirs: Record<string, boolean>;
  expanded: string[];
  changes: AgentWorkspaceChange[];
  opened: OpenedFile | null;
  bootstrap: () => Promise<void>;
  toggleDir: (path: string) => Promise<void>;
  refresh: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  closeFile: () => void;
  reset: () => void;
}

function classifyError(error: unknown): WorkspaceFsErrorKind {
  const code = (error as { code?: string; message?: string })?.code
    ?? (error as { message?: string })?.message
    ?? '';
  if (code.includes('workspaceRemoteSandbox')) return 'remoteSandbox';
  if (code.includes('BinaryFile')) return 'binary';
  if (code.includes('NotFound') || code.includes('PathNotFound')) return 'notFound';
  return 'unavailable';
}

function changeStatusOf(changes: AgentWorkspaceChange[], path: string): string {
  return changes.find((change) => change.path === path)?.status?.trim() ?? '';
}

export const useWorkspaceFsStore = createDesktopStore<WorkspaceFsState>(
  'workspaceFs',
  (set, get) => ({
    loaded: false,
    loading: false,
    errorKind: null,
    rootName: '',
    isGit: false,
    dirsByPath: {},
    loadingDirs: {},
    expanded: [],
    changes: [],
    opened: null,

    bootstrap: async () => {
      if (get().loading) return;
      set({ loading: true, errorKind: null });
      try {
        const [listing, changesPayload] = await Promise.all([
          api.agentWorkspaceFsList(ROOT_DIR_KEY),
          api.agentWorkspaceGitChanges(),
        ]);
        set((state) => ({
          loaded: true,
          loading: false,
          errorKind: null,
          rootName: listing.rootName,
          isGit: listing.isGit,
          dirsByPath: { ...state.dirsByPath, [ROOT_DIR_KEY]: listing.entries },
          changes: changesPayload.changes,
          expanded: state.expanded.length > 0 ? state.expanded : [],
        }));
      } catch (error) {
        set({ loading: false, loaded: true, errorKind: classifyError(error) });
      }
    },

    toggleDir: async (path) => {
      const isExpanded = get().expanded.includes(path);
      if (isExpanded) {
        set((state) => ({ expanded: state.expanded.filter((item) => item !== path) }));
        return;
      }
      set((state) => ({
        expanded: [...state.expanded, path],
        loadingDirs: { ...state.loadingDirs, [path]: true },
      }));
      if (!get().dirsByPath[path]) {
        try {
          const listing = await api.agentWorkspaceFsList(path);
          set((state) => ({
            dirsByPath: { ...state.dirsByPath, [path]: listing.entries },
            loadingDirs: { ...state.loadingDirs, [path]: false },
          }));
        } catch (error) {
          set((state) => ({
            expanded: state.expanded.filter((item) => item !== path),
            loadingDirs: { ...state.loadingDirs, [path]: false },
            errorKind: classifyError(error),
          }));
        }
      }
    },

    refresh: async () => {
      try {
        const [listing, changesPayload] = await Promise.all([
          api.agentWorkspaceFsList(ROOT_DIR_KEY),
          api.agentWorkspaceGitChanges(),
        ]);
        set((state) => ({
          rootName: listing.rootName,
          isGit: listing.isGit,
          dirsByPath: { ...state.dirsByPath, [ROOT_DIR_KEY]: listing.entries },
          changes: changesPayload.changes,
          errorKind: null,
        }));
      } catch (error) {
        set({ errorKind: classifyError(error) });
      }
    },

    openFile: async (path) => {
      try {
        const [file, diffPayload]: [AgentWorkspaceFile, AgentWorkspaceDiff] = await Promise.all([
          api.agentWorkspaceFsRead(path),
          get().isGit
            ? api.agentWorkspaceGitDiff(path).catch(() => ({ path, untracked: false, diff: '' }))
            : Promise.resolve({ path, untracked: false, diff: '' }),
        ]);
        set({
          opened: {
            path: file.path,
            content: file.content,
            truncated: file.truncated,
            size: file.size,
            diff: diffPayload.diff,
            untracked: diffPayload.untracked,
            binary: false,
          },
          errorKind: null,
        });
      } catch (error) {
        const kind = classifyError(error);
        if (kind === 'binary') {
          set({
            opened: { path, content: '', truncated: false, size: 0, diff: '', untracked: false, binary: true },
          });
          return;
        }
        set({ errorKind: kind });
      }
    },

    closeFile: () => set({ opened: null }),

    reset: () => set({
      loaded: false,
      loading: false,
      errorKind: null,
      rootName: '',
      isGit: false,
      dirsByPath: {},
      loadingDirs: {},
      expanded: [],
      changes: [],
      opened: null,
    }),
  }),
);

export { changeStatusOf };
