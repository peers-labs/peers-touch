import { describe, expect, it } from 'vitest';
import type { AtelierProjectionSnapshot } from './projection';
import { ATELIER_PROJECTION_VERSION } from './projection';
import { ATELIER_DEFAULT_DIRECT_RUN_MODEL } from './projection.contract.generated';
import {
  buildPrototypeEmptyHostState,
  buildPrototypeProjectionStreamConfig,
  isPrototypeHostRuntime,
  normalizePrototypeProjectionStreamConfig,
} from './prototypeRuntimeBootstrap';
import type { Task } from './types';

function task(id: string): Task {
  return {
    id,
    title: `Task ${id}`,
    project: 'peers-touch',
    status: 'active',
  };
}

function snapshot(input: {
  selectedTaskId?: string;
  tasks?: Task[];
} = {}): AtelierProjectionSnapshot {
  return {
    version: ATELIER_PROJECTION_VERSION,
    selectedTaskId: input.selectedTaskId ?? '',
    workspace: {
      budgetSpent: 0,
      budgetCap: 1,
      model: ATELIER_DEFAULT_DIRECT_RUN_MODEL,
      tasks: input.tasks ?? [],
      streams: {},
      todos: {},
      contexts: {},
      artifacts: {},
    },
  };
}

describe('prototype runtime bootstrap policy', () => {
  it('allows only generated host-container runtime names to use the applet bridge', () => {
    expect(isPrototypeHostRuntime('lynx')).toBe(true);
    expect(isPrototypeHostRuntime('web-host')).toBe(true);
    expect(isPrototypeHostRuntime('browser')).toBe(false);
    expect(isPrototypeHostRuntime('vite')).toBe(false);
    expect(isPrototypeHostRuntime('Lynx')).toBe(false);
    expect(isPrototypeHostRuntime(' lynx ')).toBe(false);
    expect(isPrototypeHostRuntime('web-host-preview')).toBe(false);
    expect(isPrototypeHostRuntime('')).toBe(false);
  });

  it('builds an empty Host seed with generated default model and no execution payloads', () => {
    const state = buildPrototypeEmptyHostState();

    expect(state).toEqual({
      budgetSpent: 0,
      budgetCap: 1,
      model: ATELIER_DEFAULT_DIRECT_RUN_MODEL,
      tasks: [],
      selectedTaskId: '',
      stream: {},
      todos: {},
      context: {},
      artifacts: {},
      gates: {},
    });
    expect(JSON.stringify(state)).not.toMatch(/provider\.invoke|runtime\.execute|shell|input_snapshot|memory\.write|run\.execute/);
  });
});

describe('prototype projection stream bootstrap config', () => {
  it('normalizes agent/task ids and keeps only positive safe-integer replay cursors', () => {
    expect(normalizePrototypeProjectionStreamConfig(undefined)).toBeUndefined();
    expect(normalizePrototypeProjectionStreamConfig({ agentId: '   ', taskId: 'task-1', afterEventSeq: 7 })).toBeUndefined();
    expect(normalizePrototypeProjectionStreamConfig({ agentId: ' agent-1 ', taskId: ' task-1 ', afterEventSeq: '42' })).toEqual({
      agentId: 'agent-1',
      taskId: 'task-1',
      afterEventSeq: 42,
    });
    expect(normalizePrototypeProjectionStreamConfig({ agentId: 'agent-2', taskId: '   ', afterEventSeq: 0 })).toEqual({
      agentId: 'agent-2',
    });
    expect(normalizePrototypeProjectionStreamConfig({
      agentId: 'agent-zero',
      certificationMode: 'product-window-e2e',
      afterEventSeq: '0',
    })).toEqual({
      agentId: 'agent-zero',
      afterEventSeq: 0,
      preserveZeroCursor: true,
    });
    expect(normalizePrototypeProjectionStreamConfig({ agentId: 'agent-3', afterEventSeq: 'not-a-number' })).toEqual({
      agentId: 'agent-3',
    });
    expect(normalizePrototypeProjectionStreamConfig({ agentId: 'agent-3', afterEventSeq: '1.5' })).toEqual({
      agentId: 'agent-3',
    });
    expect(normalizePrototypeProjectionStreamConfig({ agentId: 'agent-3', afterEventSeq: '9007199254740992' })).toEqual({
      agentId: 'agent-3',
    });
    expect(normalizePrototypeProjectionStreamConfig({
      agentId: ' agent-primary ',
      agentIds: ['agent-fallback'],
      taskId: 'task-1',
    })).toEqual({
      agentId: 'agent-primary',
      taskId: 'task-1',
    });
    expect(normalizePrototypeProjectionStreamConfig({
      agentIds: [' agent-from-list ', 'agent-ignored'],
      afterEventSeq: '7',
    })).toEqual({
      agentId: 'agent-from-list',
      afterEventSeq: 7,
    });
    expect(normalizePrototypeProjectionStreamConfig({ agentIds: ['   ', 'agent-ignored'] })).toBeUndefined();
    expect(normalizePrototypeProjectionStreamConfig({
      agentId: 'agent-1',
      taskId: ' explicit-task ',
    }, {
      selectedTaskId: 'selected-task',
      initialSnapshot: snapshot({
        selectedTaskId: 'snapshot-selected',
        tasks: [task('snapshot-selected')],
      }),
    })).toEqual({
      agentId: 'agent-1',
      taskId: 'explicit-task',
    });
    expect(normalizePrototypeProjectionStreamConfig({
      agentId: 'agent-1',
    }, {
      selectedTaskId: ' selected-task ',
      initialSnapshot: snapshot({
        selectedTaskId: 'snapshot-selected',
        tasks: [task('snapshot-selected')],
      }),
    })).toEqual({
      agentId: 'agent-1',
      taskId: 'selected-task',
    });
    expect(normalizePrototypeProjectionStreamConfig({
      agentId: 'agent-1',
    }, {
      initialSnapshot: snapshot({
        tasks: [task('first-task')],
      }),
    })).toEqual({
      agentId: 'agent-1',
      taskId: 'first-task',
    });
    expect(normalizePrototypeProjectionStreamConfig({
      agentId: 'agent-1',
      certificationMode: 'product-window-e2e',
      createGoal: 'build atelier',
    }, {
      initialSnapshot: snapshot({
        selectedTaskId: 'created-task',
        tasks: [task('created-task')],
      }),
    })).toEqual({
      agentId: 'agent-1',
      taskId: 'created-task',
    });
  });

  it('prefers explicit global stream config over query params and omits empty query config', () => {
    expect(buildPrototypeProjectionStreamConfig({
      globalConfig: { agentId: ' global-agent ', taskId: ' global-task ', afterEventSeq: 12 },
      search: '?agentId=query-agent&taskId=query-task&afterEventSeq=5',
    })).toEqual({
      agentId: 'global-agent',
      taskId: 'global-task',
      afterEventSeq: 12,
    });

    expect(buildPrototypeProjectionStreamConfig({
      globalConfig: { agentId: '   ', taskId: 'ignored', afterEventSeq: 9 },
      search: '?agentId=query-agent&taskId=&afterEventSeq=0',
    })).toEqual({
      agentId: 'query-agent',
    });

    expect(buildPrototypeProjectionStreamConfig({ search: '?taskId=task-only&afterEventSeq=4' })).toBeUndefined();
    expect(buildPrototypeProjectionStreamConfig({ search: '?agentIds=query-agent-from-list&agentIds=query-agent-ignored&afterEventSeq=8' })).toEqual({
      agentId: 'query-agent-from-list',
      afterEventSeq: 8,
    });
    expect(buildPrototypeProjectionStreamConfig({ search: '?agentId=query-agent&agentIds=query-agent-from-list&taskId=query-task' })).toEqual({
      agentId: 'query-agent',
      taskId: 'query-task',
    });
    expect(buildPrototypeProjectionStreamConfig({ search: '?agentIds=&taskId=task-only&afterEventSeq=4' })).toBeUndefined();
    expect(buildPrototypeProjectionStreamConfig({
      search: '?agentId=query-agent',
      selectedTaskId: ' selected-query-task ',
      initialSnapshot: snapshot({
        selectedTaskId: 'snapshot-selected',
        tasks: [task('snapshot-selected')],
      }),
    })).toEqual({
      agentId: 'query-agent',
      taskId: 'selected-query-task',
    });
    expect(buildPrototypeProjectionStreamConfig({
      search: '?agentId=query-agent',
      initialSnapshot: snapshot({
        tasks: [task('query-first-task')],
      }),
    })).toEqual({
      agentId: 'query-agent',
      taskId: 'query-first-task',
    });
    expect(buildPrototypeProjectionStreamConfig({
      search: '?agentId=query-agent&certificationMode=product-window-e2e&createGoal=build%20atelier',
      initialSnapshot: snapshot({
        selectedTaskId: 'query-created-task',
        tasks: [task('query-created-task')],
      }),
    })).toEqual({
      agentId: 'query-agent',
      taskId: 'query-created-task',
    });
    expect(buildPrototypeProjectionStreamConfig({
      search: '?agentId=query-agent&certificationMode=product-window-e2e&afterEventSeq=0',
    })).toEqual({
      agentId: 'query-agent',
      afterEventSeq: 0,
      preserveZeroCursor: true,
    });
  });
});
