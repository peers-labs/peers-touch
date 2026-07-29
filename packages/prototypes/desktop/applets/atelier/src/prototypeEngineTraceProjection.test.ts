import { describe, expect, it } from 'vitest';
import {
  PROTOTYPE_ENGINE_TRACE_DISCLOSURE,
  derivePrototypeEngineTraceProjectionView,
  derivePrototypeEngineTraceRoundView,
  derivePrototypeEngineTraceTurnView,
} from './prototypeEngineTraceProjection';
import type { CollaborationInput, Round, Turn } from './engine';

const collaboration: CollaborationInput = {
  goal: 'Pick a provider fallback',
  authority: 'Supervisor',
  positions: [
    { role: 'Planner', stance: 'proposal', text: 'Use vendor-A with cache backoff.' },
    { role: 'Risk', stance: 'objection', text: 'Cost can exceed quota.', evidenceRef: 'budget.cap' },
    { role: 'Architect', stance: 'counter', text: 'Cap retry fanout through policy.' },
  ],
};

describe('derivePrototypeEngineTraceProjectionView', () => {
  it('fails closed for unknown prototype engine ids without starting orchestration', () => {
    expect(derivePrototypeEngineTraceProjectionView({
      collaboration,
      engineId: 'orchestration.start',
    })).toBeNull();
  });

  it('summarizes local demo trace while disclosing Station orchestration ownership', () => {
    const view = derivePrototypeEngineTraceProjectionView({
      collaboration,
      engineId: 'expert-hierarchy',
    });

    expect(view).toMatchObject({
      reached: false,
      roundCount: 2,
      speakerCount: 4,
      disclosure: PROTOTYPE_ENGINE_TRACE_DISCLOSURE,
    });
    expect(view?.trace.engineId).toBe('expert-hierarchy');
    expect(view?.trace.result.phase).toBe('awaiting_human');
  });

  it('does not expose provider/runtime execution shaped actions in the local trace view', () => {
    const view = derivePrototypeEngineTraceProjectionView({
      collaboration,
      engineId: 'roundtable',
    });

    expect(JSON.stringify(view)).not.toMatch(
      /agent\.invoke|atelier\.agent|orchestration\.start|provider\.invoke|runtime\.invokeProvider|runtime\.execute|gate\.rerun|taskGraph\.diff\.apply/,
    );
  });
});

describe('derivePrototypeEngineTraceTurnView', () => {
  it('marks evidence-less objections as display-only concerns', () => {
    const turn: Turn = {
      role: 'Risk',
      stance: 'objection',
      text: 'This might be risky.',
    };

    expect(derivePrototypeEngineTraceTurnView(turn)).toEqual({
      turn,
      noEvidenceObjection: true,
    });
  });

  it('keeps evidence-backed objections as normal projected turns', () => {
    expect(derivePrototypeEngineTraceTurnView({
      role: 'Risk',
      stance: 'objection',
      text: 'Budget cap blocks this.',
      evidenceRef: 'budget.cap',
    }).noEvidenceObjection).toBe(false);
  });
});

describe('derivePrototypeEngineTraceRoundView', () => {
  it('derives parallel round layout without creating parallel execution', () => {
    const round: Round = {
      index: 1,
      label: 'parallel demo',
      mode: 'parallel',
      turns: [
        { role: 'Planner', stance: 'proposal', text: 'A' },
        { role: 'Executor', stance: 'proposal', text: 'B' },
      ],
    };

    expect(derivePrototypeEngineTraceRoundView(round)).toMatchObject({
      layout: 'parallelGrid',
      gridTemplateColumns: '1fr 1fr',
    });
  });

  it('derives serial round layout for ordered display chains', () => {
    expect(derivePrototypeEngineTraceRoundView({
      index: 1,
      label: 'serial demo',
      mode: 'serial',
      turns: [{ role: 'Planner', stance: 'proposal', text: 'A' }],
    })).toMatchObject({
      layout: 'serialChain',
      gridTemplateColumns: '1fr',
    });
  });
});
