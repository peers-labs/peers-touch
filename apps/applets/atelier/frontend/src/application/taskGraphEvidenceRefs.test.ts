import { describe, expect, it } from 'vitest';
import { ATELIER_PROJECTION_DISPLAY_LIMITS } from '../domain/projection.contract.generated';
import { deriveAtelierTaskGraphNodeEvidenceView } from './taskGraphEvidenceRefs';
import type { AtelierTaskNodeProjection } from '../domain/projection';

function node(input: Partial<AtelierTaskNodeProjection>): AtelierTaskNodeProjection {
  return {
    id: 'node-1',
    title: 'Projected node',
    state: 'running',
    agentRole: 'Executor',
    artifactIds: [],
    gateIds: [],
    ...input,
  };
}

describe('deriveAtelierTaskGraphNodeEvidenceView', () => {
  it('marks task graph evidence refs resolved only when projected artifact and gate ids exist in workspace maps', () => {
    expect(deriveAtelierTaskGraphNodeEvidenceView({
      node: node({
        artifactIds: ['artifact-1', 'artifact-missing'],
        gateIds: ['gate-1', 'gate-missing'],
      }),
      artifactsByTask: {
        'task-1': [{ id: 'artifact-1', name: 'Report' }],
        'task-2': [{ id: 'artifact-2', name: 'Other report' }],
      },
      gatesByTask: {
        'task-2': [{ id: 'gate-1', name: 'CI', status: 'passed' }],
      },
    })).toMatchObject({
      evidenceCount: 4,
      visibleArtifactRefs: [
        { id: 'artifact-1', label: 'artifact-1', resolved: true },
        { id: 'artifact-missing', label: 'artifact-missing (unresolved)', resolved: false },
      ],
      unresolvedArtifactCount: 1,
      visibleGateRefs: [
        { id: 'gate-1', label: 'gate-1', resolved: true },
        { id: 'gate-missing', label: 'gate-missing (unresolved)', resolved: false },
      ],
      unresolvedGateCount: 1,
    });
  });

  it('keeps display limiting separate from unresolved evidence ref counting', () => {
    const limit = ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphNodeRefs;
    const artifactIds = Array.from({ length: limit + 2 }, (_, index) => `artifact-${index}`);
    const gateIds = Array.from({ length: limit + 1 }, (_, index) => `gate-${index}`);

    expect(deriveAtelierTaskGraphNodeEvidenceView({
      node: node({ artifactIds, gateIds }),
      artifactsByTask: { 'task-1': artifactIds.slice(0, 1).map((id) => ({ id })) },
      gatesByTask: { 'task-1': gateIds.slice(0, 1).map((id) => ({ id })) },
    })).toMatchObject({
      hiddenArtifactCount: 2,
      unresolvedArtifactCount: limit + 1,
      hiddenGateCount: 1,
      unresolvedGateCount: limit,
    });
  });
});
