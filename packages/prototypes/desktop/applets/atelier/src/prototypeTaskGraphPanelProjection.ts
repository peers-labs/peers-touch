import {
  ATELIER_PROJECTION_DISPLAY_LIMITS,
} from './projection.contract.generated';
import type { AtelierProjectProjection } from './types';

export interface PrototypeTaskGraphPanelProjectionView {
  parallelPolicy: AtelierProjectProjection['taskGraph']['parallelPolicy'];
  integratorRequired: boolean;
  visibleRootTaskIds: string[];
  hiddenRootTaskIdCount: number;
  visibleEdges: AtelierProjectProjection['taskGraph']['edges'];
  hiddenEdgeCount: number;
  visibleNodes: AtelierProjectProjection['taskGraph']['tasks'];
  hiddenNodeCount: number;
}

export function derivePrototypeTaskGraphPanelProjectionView(
  project: AtelierProjectProjection,
): PrototypeTaskGraphPanelProjectionView {
  const visibleRootTaskIds = project.taskGraph.rootTaskIds.slice(
    0,
    ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphRootIds,
  );
  const visibleEdges = project.taskGraph.edges.slice(
    0,
    ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphEdges,
  );
  const visibleNodes = project.taskGraph.tasks.slice(
    0,
    ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphNodes,
  );

  return {
    parallelPolicy: project.taskGraph.parallelPolicy,
    integratorRequired: project.taskGraph.parallelPolicy === 'integrator_required',
    visibleRootTaskIds,
    hiddenRootTaskIdCount: Math.max(0, project.taskGraph.rootTaskIds.length - visibleRootTaskIds.length),
    visibleEdges,
    hiddenEdgeCount: Math.max(0, project.taskGraph.edges.length - visibleEdges.length),
    visibleNodes,
    hiddenNodeCount: Math.max(0, project.taskGraph.tasks.length - visibleNodes.length),
  };
}
