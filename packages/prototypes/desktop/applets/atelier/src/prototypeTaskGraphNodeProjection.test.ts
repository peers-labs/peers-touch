import { describe, expect, it } from 'vitest';
import { ATELIER_PROJECTION_DISPLAY_LIMITS } from './projection.contract.generated';
import { derivePrototypeTaskGraphNodeProjectionView } from './prototypeTaskGraphNodeProjection';
import type { AtelierTaskNodeProjection } from './types';

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

describe('prototypeTaskGraphNodeProjection', () => {
  it('uses generated display limits for node artifact and gate refs', () => {
    const limit = ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphNodeRefs;
    const artifactIds = Array.from({ length: limit + 2 }, (_, index) => `artifact-${index}`);
    const gateIds = Array.from({ length: limit + 1 }, (_, index) => `gate-${index}`);

    expect(derivePrototypeTaskGraphNodeProjectionView(node({
      artifactIds,
      gateIds,
    }))).toMatchObject({
      visibleArtifactRefs: artifactIds.slice(0, limit).map((id) => ({ id, resolved: false })),
      hiddenArtifactCount: 2,
      visibleGateRefs: gateIds.slice(0, limit).map((id) => ({ id, resolved: false })),
      hiddenGateCount: 1,
      evidenceCount: artifactIds.length + gateIds.length,
    });
  });

  it('does not report hidden refs when projected refs fit the generated limit', () => {
    const limit = ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphNodeRefs;

    expect(derivePrototypeTaskGraphNodeProjectionView(node({
      artifactIds: Array.from({ length: limit }, (_, index) => `artifact-${index}`),
      gateIds: Array.from({ length: limit }, (_, index) => `gate-${index}`),
    }))).toMatchObject({
      hiddenArtifactCount: 0,
      hiddenGateCount: 0,
    });
  });

  it('marks task graph evidence refs unresolved unless projected artifact and gate ids exist in workspace maps', () => {
    expect(derivePrototypeTaskGraphNodeProjectionView(
      node({
        artifactIds: ['artifact-1', 'artifact-missing'],
        gateIds: ['gate-1', 'gate-missing'],
      }),
      {
        artifactsByTask: {
          'task-1': [{ id: 'artifact-1', name: 'Report', kind: 'report', meta: 'ready' }],
        },
        gatesByTask: {
          'task-2': [{ id: 'gate-1', name: 'CI', status: 'passed', summary: 'ok', checks: [] }],
        },
      },
    )).toMatchObject({
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

  it('maps known Station node states to display glyphs and tones', () => {
    expect(derivePrototypeTaskGraphNodeProjectionView(node({ state: 'done' }))).toMatchObject({
      glyph: '✓',
      tone: 'success',
    });
    expect(derivePrototypeTaskGraphNodeProjectionView(node({ state: 'accepted' }))).toMatchObject({
      glyph: '✓',
      tone: 'success',
    });
    expect(derivePrototypeTaskGraphNodeProjectionView(node({ state: 'running' }))).toMatchObject({
      glyph: '◐',
      tone: 'primary',
    });
    expect(derivePrototypeTaskGraphNodeProjectionView(node({ state: 'blocked' }))).toMatchObject({
      glyph: '!',
      tone: 'warning',
    });
  });

  it('keeps unknown node states as muted projection display without creating actions', () => {
    expect(derivePrototypeTaskGraphNodeProjectionView(node({ state: 'queued' }))).toMatchObject({
      state: 'queued',
      glyph: '○',
      tone: 'muted',
    });
  });
});
