import {
  ATELIER_PROJECTION_CONTRACT,
  ATELIER_PROJECTION_DISPLAY_LIMITS,
} from '../domain/projection.contract.generated';
import type {
  AtelierArtifactProjection,
  AtelierGateProjection,
  AtelierTaskNodeProjection,
} from '../domain/projection';

export interface AtelierTaskGraphEvidenceRefView {
  id: string;
  resolved: boolean;
  label: string;
}

export interface AtelierTaskGraphNodeEvidenceView {
  evidenceCount: number;
  visibleArtifactRefs: AtelierTaskGraphEvidenceRefView[];
  hiddenArtifactCount: number;
  unresolvedArtifactCount: number;
  visibleGateRefs: AtelierTaskGraphEvidenceRefView[];
  hiddenGateCount: number;
  unresolvedGateCount: number;
}

export function deriveAtelierTaskGraphNodeEvidenceView(input: {
  node: AtelierTaskNodeProjection;
  artifactsByTask: Record<string, AtelierArtifactProjection[]>;
  gatesByTask: Record<string, AtelierGateProjection[]>;
}): AtelierTaskGraphNodeEvidenceView {
  const evidenceRefResolution = ATELIER_PROJECTION_CONTRACT.readOnlyProjectionSurfaces.task_graph.evidenceRefResolution;
  const artifactIds = new Set(Object.values(input.artifactsByTask).flat().map((artifact) => artifact.id));
  const gateIds = new Set(Object.values(input.gatesByTask).flat().map((gate) => gate.id));
  const visibleArtifactRefs = input.node.artifactIds
    .slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphNodeRefs)
    .map((id) => {
      const resolved = artifactIds.has(id);
      return { id, resolved, label: resolved ? id : `${id} ${evidenceRefResolution.unresolvedLabel}` };
    });
  const visibleGateRefs = input.node.gateIds
    .slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphNodeRefs)
    .map((id) => {
      const resolved = gateIds.has(id);
      return { id, resolved, label: resolved ? id : `${id} ${evidenceRefResolution.unresolvedLabel}` };
    });

  return {
    evidenceCount: input.node.artifactIds.length + input.node.gateIds.length,
    visibleArtifactRefs,
    hiddenArtifactCount: Math.max(0, input.node.artifactIds.length - visibleArtifactRefs.length),
    unresolvedArtifactCount: input.node.artifactIds.filter((id) => !artifactIds.has(id)).length,
    visibleGateRefs,
    hiddenGateCount: Math.max(0, input.node.gateIds.length - visibleGateRefs.length),
    unresolvedGateCount: input.node.gateIds.filter((id) => !gateIds.has(id)).length,
  };
}
