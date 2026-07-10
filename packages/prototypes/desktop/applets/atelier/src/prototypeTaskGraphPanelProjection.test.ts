import { describe, expect, it } from 'vitest';
import { ATELIER_PROJECTION_DISPLAY_LIMITS } from './projection.contract.generated';
import { derivePrototypeTaskGraphPanelProjectionView } from './prototypeTaskGraphPanelProjection';
import type { AtelierProjectProjection } from './types';

function project(input: Partial<AtelierProjectProjection['taskGraph']>): AtelierProjectProjection {
  return {
    id: 'project-1',
    goal: 'project goal',
    title: 'Project',
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
      rootId: 'root',
      milestones: [],
      edges: [],
    },
    taskGraph: {
      rootTaskIds: [],
      tasks: [],
      edges: [],
      parallelPolicy: 'serial_only',
      ...input,
    },
    defects: [],
  };
}

describe('prototypeTaskGraphPanelProjection', () => {
  it('uses generated display limits for root ids, edges, and nodes', () => {
    const rootLimit = ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphRootIds;
    const edgeLimit = ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphEdges;
    const nodeLimit = ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphNodes;
    const rootTaskIds = Array.from({ length: rootLimit + 2 }, (_, index) => `root-${index}`);
    const edges = Array.from({ length: edgeLimit + 1 }, (_, index) => ({
      from: `from-${index}`,
      to: `to-${index}`,
      type: 'depends_on',
    }));
    const tasks = Array.from({ length: nodeLimit + 3 }, (_, index) => ({
      id: `node-${index}`,
      title: `Node ${index}`,
      state: 'running',
      agentRole: 'Executor',
      artifactIds: [],
      gateIds: [],
    }));

    expect(derivePrototypeTaskGraphPanelProjectionView(project({
      rootTaskIds,
      edges,
      tasks,
    }))).toMatchObject({
      visibleRootTaskIds: rootTaskIds.slice(0, rootLimit),
      hiddenRootTaskIdCount: 2,
      visibleEdges: edges.slice(0, edgeLimit),
      hiddenEdgeCount: 1,
      visibleNodes: tasks.slice(0, nodeLimit),
      hiddenNodeCount: 3,
    });
  });

  it('does not report hidden panel entries when projections fit generated limits', () => {
    const rootTaskIds = Array.from(
      { length: ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphRootIds },
      (_, index) => `root-${index}`,
    );
    const edges = Array.from(
      { length: ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphEdges },
      (_, index) => ({
        from: `from-${index}`,
        to: `to-${index}`,
        type: 'depends_on',
      }),
    );
    const tasks = Array.from(
      { length: ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphNodes },
      (_, index) => ({
        id: `node-${index}`,
        title: `Node ${index}`,
        state: 'running',
        agentRole: 'Executor',
        artifactIds: [],
        gateIds: [],
      }),
    );

    expect(derivePrototypeTaskGraphPanelProjectionView(project({
      rootTaskIds,
      edges,
      tasks,
    }))).toMatchObject({
      hiddenRootTaskIdCount: 0,
      hiddenEdgeCount: 0,
      hiddenNodeCount: 0,
    });
  });

  it('projects integrator-required policy as display state only', () => {
    expect(derivePrototypeTaskGraphPanelProjectionView(project({
      parallelPolicy: 'integrator_required',
    }))).toMatchObject({
      parallelPolicy: 'integrator_required',
      integratorRequired: true,
    });
  });
});
