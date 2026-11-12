import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentWorkspaceEntry } from '../../services/desktop_api';
import {
  buildWorkspaceFileIndex,
  FILE_SEARCH_MAX_DIRS,
  isIgnoredDir,
  isWorkspaceUnavailableError,
  matchesFileName,
} from './fileSearch';

vi.mock('../../services/desktop_api', () => ({
  api: {
    agentWorkspaceFsList: vi.fn(),
  },
}));

const { api } = await import('../../services/desktop_api') as unknown as {
  api: { agentWorkspaceFsList: ReturnType<typeof vi.fn> };
};

function entry(overrides: Partial<AgentWorkspaceEntry>): AgentWorkspaceEntry {
  return {
    name: '',
    relativePath: '',
    isDir: false,
    isSymlink: false,
    size: 0,
    modifiedMs: 0,
    ...overrides,
  };
}

describe('isIgnoredDir', () => {
  it('ignores hidden directories and heavy build folders', () => {
    expect(isIgnoredDir('.git')).toBe(true);
    expect(isIgnoredDir('node_modules')).toBe(true);
    expect(isIgnoredDir('dist')).toBe(true);
  });

  it('keeps normal source directories', () => {
    expect(isIgnoredDir('src')).toBe(false);
    expect(isIgnoredDir('apps')).toBe(false);
  });
});

describe('matchesFileName', () => {
  const file = entry({ name: 'ChatInput.tsx', relativePath: 'apps/desktop/src/components/ChatInput.tsx' });

  it('never matches directories', () => {
    const dir = entry({ name: 'components', relativePath: 'components', isDir: true });
    expect(matchesFileName(dir, 'components')).toBe(false);
  });

  it('matches by file name or relative path, case-insensitive', () => {
    expect(matchesFileName(file, 'chatinput')).toBe(true);
    expect(matchesFileName(file, 'desktop/src')).toBe(true);
    expect(matchesFileName(file, 'nomatch')).toBe(false);
  });

  it('returns all files for an empty query', () => {
    expect(matchesFileName(file, '   ')).toBe(true);
  });
});

describe('buildWorkspaceFileIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('walks breadth-first, skips ignored dirs and returns files only', async () => {
    api.agentWorkspaceFsList.mockImplementation(async (path: string) => {
      if (path === '') {
        return {
          root: '/repo',
          rootName: 'repo',
          isGit: true,
          entries: [
            entry({ name: 'apps', relativePath: 'apps', isDir: true }),
            entry({ name: 'node_modules', relativePath: 'node_modules', isDir: true }),
            entry({ name: 'README.md', relativePath: 'README.md' }),
          ],
        };
      }
      if (path === 'apps') {
        return {
          root: '/repo',
          rootName: 'repo',
          isGit: true,
          entries: [entry({ name: 'main.ts', relativePath: 'apps/main.ts' })],
        };
      }
      throw new Error(`unexpected path ${path}`);
    });

    const index = await buildWorkspaceFileIndex();
    expect(index.capped).toBe(false);
    expect(index.files.map((file) => file.relativePath).sort()).toEqual([
      'README.md',
      'apps/main.ts',
    ]);
    // node_modules must never be descended into.
    expect(api.agentWorkspaceFsList).not.toHaveBeenCalledWith('node_modules');
  });

  it('flags the cap when the directory limit is reached', async () => {
    api.agentWorkspaceFsList.mockImplementation(async (path: string) => ({
      root: '/repo',
      rootName: 'repo',
      isGit: false,
      entries: [
        entry({ name: `d-${path || 'root'}`, relativePath: `d-${path || 'root'}`, isDir: true }),
      ],
    }));

    const index = await buildWorkspaceFileIndex();
    expect(index.capped).toBe(true);
    expect(api.agentWorkspaceFsList).toHaveBeenCalledTimes(FILE_SEARCH_MAX_DIRS);
  });
});

describe('isWorkspaceUnavailableError', () => {
  it('detects the no-local-workspace error code', () => {
    expect(isWorkspaceUnavailableError({ code: 'agent.workspaceRemoteSandbox' })).toBe(true);
    expect(isWorkspaceUnavailableError({ message: 'agent.workspaceRemoteSandbox: x' })).toBe(true);
    expect(isWorkspaceUnavailableError(new Error('boom'))).toBe(false);
  });
});
