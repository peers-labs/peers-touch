import { describe, expect, it } from 'vitest';
import { derivePrototypeRightRailProjection } from './prototypeRightRailProjection';
import type { AtelierProjectProjection, Task } from './types';

function task(input: Partial<Task> & Pick<Task, 'id'>): Task {
  return {
    project: 'peers-touch',
    status: 'active',
    title: input.id,
    ...input,
  };
}

function project(input: {
  id: string;
  taskNodeIds?: string[];
}): AtelierProjectProjection {
  return {
    id: input.id,
    goal: input.id,
    title: input.id,
    state: 'running',
    workspaceRef: 'workspace://peers-touch',
    goalOwnerSignoff: false,
    residualRisks: [],
    openBlockers: [],
    memoryCandidates: [],
    completion: {
      noOpenBlockers: true,
      l0L1AcceptancePassed: false,
      l2HumanSignoffComplete: false,
      residualRisksLogged: false,
      memoryCandidatesGenerated: false,
    },
    milestoneTree: {
      rootId: `${input.id}:root`,
      milestones: [],
      edges: [],
    },
    taskGraph: {
      rootTaskIds: input.taskNodeIds ?? [],
      tasks: (input.taskNodeIds ?? []).map((id) => ({
        id,
        title: id,
        state: 'running',
        agentRole: 'Executor',
        artifactIds: [],
        gateIds: [],
      })),
      edges: [],
      parallelPolicy: 'serial_only',
    },
    defects: [],
  };
}

describe('prototypeRightRailProjection', () => {
  it('selects Station project projection by selected task projectId', () => {
    const selectedProject = project({ id: 'project-1' });

    const view = derivePrototypeRightRailProjection({
      selectedTaskId: 'task-1',
      selectedTask: task({ id: 'task-1', projectId: 'project-1' }),
      projects: [selectedProject],
      todosByTaskId: {},
      contextByTaskId: {},
    });

    expect(view.surface).toBe('project');
    expect(view.surface === 'project' ? view.selectedProject : undefined).toBe(selectedProject);
  });

  it('selects Station project projection by TaskGraph node membership', () => {
    const selectedProject = project({ id: 'project-graph', taskNodeIds: ['task-from-graph'] });

    const view = derivePrototypeRightRailProjection({
      selectedTaskId: 'task-from-graph',
      selectedTask: task({ id: 'task-from-graph' }),
      projects: [selectedProject],
      todosByTaskId: {},
      contextByTaskId: {},
    });

    expect(view.surface).toBe('project');
    expect(view.surface === 'project' ? view.selectedProject : undefined).toBe(selectedProject);
  });

  it('falls back to legacy Todo projection when no Station project matches', () => {
    const todos = [{ id: 'todo-1', text: 'Legacy projected todo', status: 'running' as const }];

    expect(derivePrototypeRightRailProjection({
      selectedTaskId: 'task-legacy',
      selectedTask: task({ id: 'task-legacy' }),
      projects: [],
      todosByTaskId: { 'task-legacy': todos },
      contextByTaskId: {},
    })).toEqual({
      surface: 'legacyTodo',
      todos,
      context: undefined,
    });
  });

  it('keeps Context projection independent from project and Todo surface selection', () => {
    const context = {
      usedPct: 35,
      files: [{ name: 'docs/architecture/domains/applets/atelier/README.md', group: 'files' as const }],
    };

    expect(derivePrototypeRightRailProjection({
      selectedTaskId: 'task-empty',
      selectedTask: task({ id: 'task-empty' }),
      projects: [],
      todosByTaskId: {},
      contextByTaskId: { 'task-empty': context },
    })).toEqual({
      surface: 'empty',
      todos: [],
      context,
    });
  });
});
