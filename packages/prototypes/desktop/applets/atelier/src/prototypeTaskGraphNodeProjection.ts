import {
  ATELIER_PROJECTION_CONTRACT,
  ATELIER_PROJECTION_DISPLAY_LIMITS,
} from './projection.contract.generated';
import type { Artifact, AtelierTaskNodeProjection, GateResult } from './types';

export type PrototypeTaskGraphNodeTone = 'success' | 'primary' | 'warning' | 'muted';

export interface PrototypeTaskGraphEvidenceRefView {
  id: string;
  resolved: boolean;
  label: string;
}

export interface PrototypeTaskGraphNodeProjectionView {
  state: string;
  glyph: string;
  tone: PrototypeTaskGraphNodeTone;
  evidenceCount: number;
  visibleArtifactRefs: PrototypeTaskGraphEvidenceRefView[];
  hiddenArtifactCount: number;
  unresolvedArtifactCount: number;
  visibleGateRefs: PrototypeTaskGraphEvidenceRefView[];
  hiddenGateCount: number;
  unresolvedGateCount: number;
}

export function derivePrototypeTaskGraphNodeProjectionView(
  node: AtelierTaskNodeProjection,
  evidence: {
    artifactsByTask?: Record<string, Artifact[]>;
    gatesByTask?: Record<string, GateResult[]>;
  } = {},
): PrototypeTaskGraphNodeProjectionView {
  const state = node.state.toLowerCase();
  const evidenceRefResolution = ATELIER_PROJECTION_CONTRACT.readOnlyProjectionSurfaces.task_graph.evidenceRefResolution;
  const artifactIds = new Set(Object.values(evidence.artifactsByTask ?? {}).flat().map((artifact) => artifact.id));
  const gateIds = new Set(Object.values(evidence.gatesByTask ?? {}).flat().map((gate) => gate.id));
  const visibleArtifactRefs = node.artifactIds
    .slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphNodeRefs)
    .map((id) => {
      const resolved = artifactIds.has(id);
      return { id, resolved, label: resolved ? id : `${id} ${evidenceRefResolution.unresolvedLabel}` };
    });
  const visibleGateRefs = node.gateIds
    .slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphNodeRefs)
    .map((id) => {
      const resolved = gateIds.has(id);
      return { id, resolved, label: resolved ? id : `${id} ${evidenceRefResolution.unresolvedLabel}` };
    });

  return {
    state,
    glyph: taskGraphNodeGlyph(state),
    tone: taskGraphNodeTone(state),
    evidenceCount: node.artifactIds.length + node.gateIds.length,
    visibleArtifactRefs,
    hiddenArtifactCount: Math.max(0, node.artifactIds.length - visibleArtifactRefs.length),
    unresolvedArtifactCount: node.artifactIds.filter((id) => !artifactIds.has(id)).length,
    visibleGateRefs,
    hiddenGateCount: Math.max(0, node.gateIds.length - visibleGateRefs.length),
    unresolvedGateCount: node.gateIds.filter((id) => !gateIds.has(id)).length,
  };
}

function taskGraphNodeGlyph(state: string): string {
  if (state === 'done' || state === 'accepted') return '✓';
  if (state === 'running') return '◐';
  if (state === 'blocked') return '!';
  return '○';
}

function taskGraphNodeTone(state: string): PrototypeTaskGraphNodeTone {
  if (state === 'done' || state === 'accepted') return 'success';
  if (state === 'running') return 'primary';
  if (state === 'blocked') return 'warning';
  return 'muted';
}
