import { describe, expect, it } from 'vitest';
import { deriveAgentWorkbenchLayout } from './layout';

describe('deriveAgentWorkbenchLayout', () => {
  it('keeps both navigation rails expanded on a wide surface', () => {
    expect(deriveAgentWorkbenchLayout(1280, true, true)).toEqual({
      narrow: false,
      agentRail: 'expanded',
      topicRail: 'expanded',
      inspectorVisible: true,
    });
  });

  it('collapses secondary rails before the center rail becomes narrow', () => {
    expect(deriveAgentWorkbenchLayout(760, true, true)).toEqual({
      narrow: true,
      agentRail: 'collapsed',
      topicRail: 'hidden',
      inspectorVisible: false,
    });
  });

  it('ignores zero-width samples from hidden keep-alive pages', () => {
    expect(deriveAgentWorkbenchLayout(0, false, false)).toEqual({
      narrow: false,
      agentRail: 'collapsed',
      topicRail: 'collapsed',
      inspectorVisible: true,
    });
  });
});
