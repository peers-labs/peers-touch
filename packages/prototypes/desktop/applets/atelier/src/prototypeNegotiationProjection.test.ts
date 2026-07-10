import { describe, expect, it } from 'vitest';
import { ATELIER_PROJECTION_DISPLAY_LIMITS } from './projection.contract.generated';
import { derivePrototypeNegotiationProjectionView } from './prototypeNegotiationProjection';
import type { NegoBlock, NegoVoice } from './types';

function voice(index: number, input: Partial<NegoVoice> = {}): NegoVoice {
  return {
    role: 'Planner',
    stance: 'proposal',
    text: `Voice ${index}`,
    evidenceRef: `evidence-${index}`,
    ...input,
  };
}

function block(input: Partial<NegoBlock> = {}): NegoBlock {
  return {
    kind: 'nego',
    id: 'nego-1',
    summary: 'Station negotiation projection',
    agentCount: 2,
    converged: false,
    voices: [],
    consensus: 'Pending human review.',
    ...input,
  };
}

describe('prototypeNegotiationProjection', () => {
  it('uses the generated display limit for visible Station negotiation voices', () => {
    const limit = ATELIER_PROJECTION_DISPLAY_LIMITS.negotiationVoices;
    const voices = Array.from({ length: limit + 2 }, (_, index) => voice(index));

    const view = derivePrototypeNegotiationProjectionView(block({ voices }));

    expect(view.visibleVoiceViews.map((item) => item.voice)).toEqual(voices.slice(0, limit));
    expect(view.hiddenVoiceCount).toBe(2);
  });

  it('does not report hidden voices at the generated display limit', () => {
    const voices = Array.from(
      { length: ATELIER_PROJECTION_DISPLAY_LIMITS.negotiationVoices },
      (_, index) => voice(index),
    );

    expect(derivePrototypeNegotiationProjectionView(block({ voices }))).toMatchObject({
      hiddenVoiceCount: 0,
    });
  });

  it('marks no-evidence objections as display-only concerns', () => {
    expect(derivePrototypeNegotiationProjectionView(block({
      voices: [
        voice(1, { stance: 'objection', evidenceRef: undefined }),
        voice(2, { stance: 'objection', evidenceRef: 'evidence-2' }),
      ],
    }))).toMatchObject({
      visibleVoiceViews: [
        { noEvidenceObjection: true },
        { noEvidenceObjection: false },
      ],
    });
  });

  it('maps convergence to display status without producing consensus actions', () => {
    expect(derivePrototypeNegotiationProjectionView(block({
      converged: true,
      consensus: 'Ready.',
    }))).toMatchObject({
      statusLabel: '已收敛',
      statusTone: 'success',
      hasConsensus: true,
    });

    expect(derivePrototypeNegotiationProjectionView(block({
      converged: false,
      consensus: '   ',
    }))).toMatchObject({
      statusLabel: '未收敛',
      statusTone: 'warning',
      hasConsensus: false,
    });
  });

  it('supports empty voice projections without creating negotiation runtime work', () => {
    expect(derivePrototypeNegotiationProjectionView(block({ voices: [] }))).toMatchObject({
      visibleVoiceViews: [],
      hiddenVoiceCount: 0,
    });
  });
});
