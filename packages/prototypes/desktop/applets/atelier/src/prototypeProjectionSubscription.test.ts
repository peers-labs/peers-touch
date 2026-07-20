import { describe, expect, it } from 'vitest';
import type { AtelierProjectionSnapshot } from './projection';
import { ATELIER_PROJECTION_VERSION } from './projection';
import { ATELIER_PROJECTION_CONTRACT } from './projection.contract.generated';
import {
  buildPrototypeProjectionStreamPayload,
  compactProjectionStreamPayload,
  projectionAfterEventSeqFromSnapshot,
  projectionTaskIdFromSubscription,
} from './prototypeProjectionSubscription';
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
  replay?: AtelierProjectionSnapshot['workspace']['replay'];
} = {}): AtelierProjectionSnapshot {
  return {
    version: ATELIER_PROJECTION_VERSION,
    selectedTaskId: input.selectedTaskId ?? '',
    workspace: {
      budgetSpent: 0,
      budgetCap: 1,
      model: 'gpt-4.1',
      tasks: input.tasks ?? [],
      streams: {},
      todos: {},
      contexts: {},
      artifacts: {},
      replay: input.replay,
    },
  };
}

describe('projectionTaskIdFromSubscription', () => {
  it('uses generated task id source priority with explicit intent before snapshot fallback', () => {
    expect(ATELIER_PROJECTION_CONTRACT.eventSubscription.taskIdSourcePriority).toEqual([
      'certificationCreatedSelectedTaskId',
      'explicitTaskId',
      'controllerSelectedTaskId',
      'snapshotSelectedTaskId',
      'snapshotFirstTaskId',
    ]);

    expect(projectionTaskIdFromSubscription({
      explicitTaskId: ' explicit-task ',
      initialSnapshot: snapshot({
        selectedTaskId: 'selected-task',
        tasks: [task('selected-task'), task('first-task')],
      }),
    })).toBe('explicit-task');
  });

  it('uses certification-created and controller selected task sources before snapshot fallback', () => {
    expect(projectionTaskIdFromSubscription({
      certificationMode: 'product-window-e2e',
      createGoal: ' build atelier ',
      explicitTaskId: ' explicit-ignored ',
      selectedTaskId: 'controller-ignored',
      initialSnapshot: snapshot({
        selectedTaskId: ' created-selected ',
        tasks: [task('created-selected')],
      }),
    })).toBe('created-selected');

    expect(projectionTaskIdFromSubscription({
      certificationMode: 'product-window-e2e',
      createGoal: '   ',
      explicitTaskId: ' explicit-after-blank-goal ',
      selectedTaskId: 'controller-ignored',
      initialSnapshot: snapshot({
        selectedTaskId: 'created-ignored',
        tasks: [task('created-ignored')],
      }),
    })).toBe('explicit-after-blank-goal');

    expect(projectionTaskIdFromSubscription({
      certificationMode: 'preview',
      createGoal: 'build atelier',
      explicitTaskId: 'explicit-after-non-product',
      selectedTaskId: 'controller-ignored',
      initialSnapshot: snapshot({
        selectedTaskId: 'created-ignored',
        tasks: [task('created-ignored')],
      }),
    })).toBe('explicit-after-non-product');

    expect(projectionTaskIdFromSubscription({
      selectedTaskId: ' controller-selected ',
      initialSnapshot: snapshot({
        selectedTaskId: 'snapshot-selected',
        tasks: [task('snapshot-selected')],
      }),
    })).toBe('controller-selected');

    expect(projectionTaskIdFromSubscription({
      selectedTaskId: '   ',
      initialSnapshot: snapshot({
        selectedTaskId: ' snapshot-selected ',
        tasks: [task('snapshot-selected')],
      }),
    })).toBe('snapshot-selected');
  });

  it('falls back to selected task and then first snapshot task without inventing task ids', () => {
    expect(projectionTaskIdFromSubscription({
      initialSnapshot: snapshot({
        selectedTaskId: 'selected-task',
        tasks: [task('selected-task')],
      }),
    })).toBe('selected-task');

    expect(projectionTaskIdFromSubscription({
      initialSnapshot: snapshot({
        tasks: [task('first-task')],
      }),
    })).toBe('first-task');

    expect(projectionTaskIdFromSubscription({
      explicitTaskId: ' ',
      initialSnapshot: snapshot(),
    })).toBeUndefined();
  });
});

describe('projectionAfterEventSeqFromSnapshot', () => {
  it('uses snapshot replay cursor for the selected task only when it is positive', () => {
    const projectedSnapshot = snapshot({
      tasks: [task('task-1'), task('task-2')],
      replay: {
        'task-1': { nextEventSeq: 42 },
        'task-2': { nextEventSeq: 0 },
      },
    });

    expect(projectionAfterEventSeqFromSnapshot(projectedSnapshot, 'task-1')).toBe(42);
    expect(projectionAfterEventSeqFromSnapshot(projectedSnapshot, 'task-2')).toBe(0);
    expect(projectionAfterEventSeqFromSnapshot(projectedSnapshot, undefined)).toBe(0);
  });
});

describe('compactProjectionStreamPayload', () => {
  it('trims required agent id and rejects empty projection stream payloads fail-closed', () => {
    expect(compactProjectionStreamPayload({
      agentId: ' agent-1 ',
      taskId: ' task-1 ',
      afterEventSeq: 1,
    })).toEqual({
      agentId: 'agent-1',
      taskId: 'task-1',
      afterEventSeq: 1,
    });
    expect(compactProjectionStreamPayload({
      agentId: '   ',
      taskId: 'task-1',
      afterEventSeq: 1,
    })).toBeUndefined();
  });

  it('omits empty task id and zero replay cursor fields from Host subscription payload', () => {
    expect(compactProjectionStreamPayload({
      agentId: 'agent-1',
      taskId: ' ',
      afterEventSeq: 0,
    })).toEqual({
      agentId: 'agent-1',
    });
  });

  it('preserves product-window certification zero replay cursor fields', () => {
    expect(compactProjectionStreamPayload({
      agentId: 'agent-1',
      taskId: ' task-1 ',
      afterEventSeq: 0,
      preserveZeroCursor: true,
    })).toEqual({
      agentId: 'agent-1',
      taskId: 'task-1',
      afterEventSeq: 0,
    });
  });

  it('keeps only positive safe-integer replay cursor values', () => {
    expect(compactProjectionStreamPayload({
      agentId: 'agent-1',
      taskId: ' task-1 ',
      afterEventSeq: 7,
    })).toEqual({
      agentId: 'agent-1',
      taskId: 'task-1',
      afterEventSeq: 7,
    });
  });

  it('omits decimal and unsafe replay cursor values from Host subscription payload', () => {
    expect(compactProjectionStreamPayload({
      agentId: 'agent-1',
      afterEventSeq: 1.5,
    })).toEqual({
      agentId: 'agent-1',
    });
    expect(compactProjectionStreamPayload({
      agentId: 'agent-1',
      afterEventSeq: 9007199254740992,
    })).toEqual({
      agentId: 'agent-1',
    });
  });
});

describe('buildPrototypeProjectionStreamPayload', () => {
  it('rejects empty agent id before building Host projection stream payloads', () => {
    const payload = buildPrototypeProjectionStreamPayload({
      agentId: ' ',
      explicitTaskId: 'task-1',
      explicitAfterEventSeq: 3,
      initialSnapshot: snapshot({
        selectedTaskId: 'task-1',
        tasks: [task('task-1')],
      }),
    });

    expect(payload).toBeUndefined();
  });

  it('lets explicit stream cursor override snapshot replay cursor', () => {
    expect(buildPrototypeProjectionStreamPayload({
      agentId: 'agent-1',
      explicitTaskId: 'task-1',
      explicitAfterEventSeq: 9,
      initialSnapshot: snapshot({
        tasks: [task('task-1')],
        replay: {
          'task-1': { nextEventSeq: 3 },
        },
      }),
    })).toEqual({
      agentId: 'agent-1',
      taskId: 'task-1',
      afterEventSeq: 9,
    });
  });

  it('lets product-window certification explicit zero cursor override snapshot replay cursor', () => {
    expect(buildPrototypeProjectionStreamPayload({
      agentId: 'agent-1',
      explicitTaskId: 'task-1',
      explicitAfterEventSeq: 0,
      preserveZeroCursor: true,
      initialSnapshot: snapshot({
        tasks: [task('task-1')],
        replay: {
          'task-1': { nextEventSeq: 3 },
        },
      }),
    })).toEqual({
      agentId: 'agent-1',
      taskId: 'task-1',
      afterEventSeq: 0,
    });
  });

  it('falls back to snapshot replay cursor without adding task execution fields', () => {
    const payload = buildPrototypeProjectionStreamPayload({
      agentId: 'agent-1',
      initialSnapshot: snapshot({
        selectedTaskId: 'task-1',
        tasks: [task('task-1')],
        replay: {
          'task-1': { nextEventSeq: 5 },
        },
      }),
    });

    expect(payload).toEqual({
      agentId: 'agent-1',
      taskId: 'task-1',
      afterEventSeq: 5,
    });
    expect(JSON.stringify(payload)).not.toMatch(/run|execute|provider|memory|input_snapshot|orchestration/);
  });

  it('builds payloads from certification-created and controller selected task source priority only', () => {
    expect(buildPrototypeProjectionStreamPayload({
      agentId: 'agent-1',
      certificationMode: 'product-window-e2e',
      createGoal: 'build atelier',
      explicitTaskId: 'explicit-ignored',
      selectedTaskId: 'controller-ignored',
      initialSnapshot: snapshot({
        selectedTaskId: 'created-task',
        tasks: [task('created-task')],
        replay: {
          'created-task': { nextEventSeq: 12 },
        },
      }),
    })).toEqual({
      agentId: 'agent-1',
      taskId: 'created-task',
      afterEventSeq: 12,
    });

    const payload = buildPrototypeProjectionStreamPayload({
      agentId: 'agent-1',
      selectedTaskId: 'controller-task',
      initialSnapshot: snapshot({
        selectedTaskId: 'snapshot-ignored',
        tasks: [task('snapshot-ignored')],
        replay: {
          'controller-task': { nextEventSeq: 14 },
          'snapshot-ignored': { nextEventSeq: 99 },
        },
      }),
    });

    expect(payload).toEqual({
      agentId: 'agent-1',
      taskId: 'controller-task',
      afterEventSeq: 14,
    });
    expect(JSON.stringify(payload)).not.toMatch(/certificationMode|createGoal|selectedTaskId|run|execute|provider|orchestration/);
  });
});
