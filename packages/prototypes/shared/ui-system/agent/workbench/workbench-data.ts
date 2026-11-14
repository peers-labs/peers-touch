/**
 * Deterministic seed data for the Agent workbench docks.
 *
 * Every record mirrors a real production capability (workspace FS, device
 * browser, terminal sessions, station-owned memory review, conversation
 * branches) but is local and static: the prototype proves peers-ui can own
 * the surface, it never fakes the backend.
 */
import type {
  BranchRowSeed, FileChange, FileNode, MemoryCandidate, OpenedFile,
  TerminalSessionSeed, WorkbenchToolMeta,
} from './types';

/** Single registry consumed by the floating rail, launcher, tab strip and add menu. */
export const WORKBENCH_TOOLS: readonly WorkbenchToolMeta[] = [
  { id: 'summary', iconId: 'list-checks', labelKey: 'agent.wb.tool.summary', descKey: 'agent.wb.desc.summary' },
  { id: 'file', iconId: 'folder-tree', labelKey: 'agent.wb.tool.file', descKey: 'agent.wb.desc.file' },
  { id: 'browser', iconId: 'globe', labelKey: 'agent.wb.tool.browser', descKey: 'agent.wb.desc.browser' },
  { id: 'terminal', iconId: 'terminal', labelKey: 'agent.wb.tool.terminal', descKey: 'agent.wb.desc.terminal' },
  { id: 'memory', iconId: 'brain', labelKey: 'agent.wb.tool.memory', descKey: 'agent.wb.desc.memory' },
  { id: 'branches', iconId: 'git-branch', labelKey: 'agent.wb.tool.branches', descKey: 'agent.wb.desc.branches' },
];

export const WORKBENCH_ROOT_NAME = 'agent-task-workbench-20261102';

/* ---- file dock ------------------------------------------------------- */

export const SEED_FILE_TREE: readonly FileNode[] = [
  {
    path: 'apps', name: 'apps', isDir: true, children: [
      {
        path: 'apps/desktop', name: 'desktop', isDir: true, children: [
          {
            path: 'apps/desktop/src', name: 'src', isDir: true, children: [
              { path: 'apps/desktop/src/main.tsx', name: 'main.tsx', isDir: false, status: 'M' },
              { path: 'apps/desktop/src/runtime.ts', name: 'runtime.ts', isDir: false, status: '??' },
            ],
          },
        ],
      },
      { path: 'apps/station', name: 'station', isDir: true, status: 'R' },
    ],
  },
  {
    path: 'packages', name: 'packages', isDir: true, children: [
      {
        path: 'packages/ui', name: 'ui', isDir: true, children: [
          { path: 'packages/ui/terminal.tsx', name: 'terminal.tsx', isDir: false, status: 'A' },
        ],
      },
    ],
  },
  { path: 'model', name: 'model', isDir: true, status: 'M' },
  { path: 'AGENTS.md', name: 'AGENTS.md', isDir: false, status: 'M' },
  { path: 'pnpm-workspace.yaml', name: 'pnpm-workspace.yaml', isDir: false },
  { path: 'acceptance-matrix.md', name: 'acceptance-matrix.md', isDir: false, status: 'D' },
];

export const SEED_FILE_CHANGES: readonly FileChange[] = [
  { path: 'AGENTS.md', status: 'M' },
  { path: 'apps/desktop/src/main.tsx', status: 'M' },
  { path: 'apps/desktop/src/runtime.ts', status: '??' },
  { path: 'apps/station', status: 'R' },
  { path: 'model', status: 'M' },
  { path: 'packages/ui/terminal.tsx', status: 'A' },
  { path: 'acceptance-matrix.md', status: 'D' },
];

const OPENED_FILES: Record<string, OpenedFile> = {
  'apps/desktop/src/main.tsx': {
    path: 'apps/desktop/src/main.tsx',
    name: 'main.tsx',
    content: [
      "import { bootstrap } from './runtime';",
      "import { createRoot } from 'react-dom/client';",
      '',
      'const container = document.getElementById("root");',
      'createRoot(container).render(<App />);',
      'void bootstrap();',
    ].join('\n'),
    diffBefore: [
      "import { render } from 'react-dom';",
      '',
      'render(<App />, document.getElementById("root"));',
    ].join('\n'),
    diffAfter: [
      "import { bootstrap } from './runtime';",
      "import { createRoot } from 'react-dom/client';",
      '',
      'const container = document.getElementById("root");',
      'createRoot(container).render(<App />);',
      'void bootstrap();',
    ].join('\n'),
  },
  'packages/ui/terminal.tsx': {
    path: 'packages/ui/terminal.tsx',
    name: 'terminal.tsx',
    content: [
      'export function TerminalSurface({ lines, status }: Props) {',
      '  return <div role="log" aria-live="polite">{lines.map(renderLine)}</div>;',
      '}',
    ].join('\n'),
  },
  'AGENTS.md': {
    path: 'AGENTS.md',
    name: 'AGENTS.md',
    content: [
      '# AGENTS.md — Peers-Touch AI Agent Behavioral Guide',
      '',
      'Proto-first. No debug statements. No mocking. No hardcoded UI strings.',
    ].join('\n'),
  },
  'acceptance-matrix.md': {
    path: 'acceptance-matrix.md',
    name: 'acceptance-matrix.md',
    content: 'This tracked file is marked deleted in the working tree.',
  },
};

const FALLBACK_FILE: OpenedFile = {
  path: '',
  name: '',
  content: '',
};

export function openSeedFile(path: string): OpenedFile {
  const seeded = OPENED_FILES[path];
  if (seeded) return seeded;
  const node = findNode(SEED_FILE_TREE, path);
  return {
    ...FALLBACK_FILE,
    path,
    name: node?.name ?? path.split('/').pop() ?? path,
    content: [
      `// ${path}`,
      '// Seeded read-only preview: the prototype owns no real workspace FS transport.',
    ].join('\n'),
  };
}

export function findNode(nodes: readonly FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const hit = findNode(node.children, path);
      if (hit) return hit;
    }
  }
  return null;
}

/* ---- terminal dock --------------------------------------------------- */

export const SEED_TERMINAL_SESSIONS: readonly TerminalSessionSeed[] = [
  {
    sessionId: 'term-auto-shell',
    command: 'zsh',
    cwd: '~/peers/agent-task-workbench-20261102',
    placement: 'desktop',
    status: 'running',
    lines: [
      { id: 'l1', stream: 'system', text: 'auto shell · workspace project grant resolved' },
      { id: 'l2', stream: 'stdin', text: 'pnpm --filter @peers-touch/prototype-ui-system peer-only-gate' },
      { id: 'l3', stream: 'stdout', text: 'peer-only-gate OK: agents prototype is peers-ui only.' },
      { id: 'l4', stream: 'stdin', text: 'pnpm --filter @peers-touch/prototype-portal build' },
      { id: 'l5', stream: 'stdout', text: 'vite v6 · building for production...' },
      { id: 'l6', stream: 'stdout', text: '✓ built in 32.82s' },
    ],
  },
  {
    sessionId: 'term-migration',
    command: 'pnpm',
    cwd: '~/peers/agent-task-workbench-20261102',
    placement: 'desktop',
    status: 'exited',
    exitCode: 0,
    lines: [
      { id: 'm1', stream: 'stdin', text: 'pnpm run long-migration' },
      { id: 'm2', stream: 'stdout', text: 'migration 20261107_workbench · applied' },
      { id: 'm3', stream: 'system', text: 'process exited cleanly' },
    ],
  },
];

export const TERMINAL_PLACEMENT_ROOT = '~/peers/agent-task-workbench-20261102';

/* ---- memory dock ----------------------------------------------------- */

export const SEED_MEMORY_CANDIDATES: readonly MemoryCandidate[] = [
  {
    memoryId: 'mem-cand-1',
    layer: 'project',
    content: 'Agent workbench 右侧工作面默认宽度 420px，最小 260px，对话列保留 400px 地板。',
  },
  {
    memoryId: 'mem-cand-2',
    layer: 'user',
    content: '澄清决定必须回写消息模型，不能只停留在澄清卡本地 state。',
  },
  {
    memoryId: 'mem-cand-3',
    layer: 'session',
    content: 'streaming 中发送进入 FIFO 队列而非硬禁用，Stop 按钮始终可达。',
  },
];

/* ---- branches dock --------------------------------------------------- */

const DAY = 86_400_000;
const daysAgo = (days: number, hour: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 5, 0, 0);
  return date.toISOString();
};

export const SEED_BRANCH_ROWS: readonly BranchRowSeed[] = [
  {
    id: 'branch-origin-1',
    kind: 'origin',
    at: daysAgo(0, 10),
    snippet: '先导出备份再删除归档话题 — 该延续已被新的澄清决定取代。',
  },
  {
    id: 'branch-alt-1',
    kind: 'alternate',
    at: daysAgo(0, 10),
    snippet: '仅删除当前 Agent 可见记录，保留其他 Agent 的归档证据。',
  },
  {
    id: 'branch-origin-2',
    kind: 'origin',
    at: daysAgo(1, 16),
    snippet: '沙箱网络默认全放行，再用 provisioner 收敛 — 已被最小权限方案取代。',
  },
];
