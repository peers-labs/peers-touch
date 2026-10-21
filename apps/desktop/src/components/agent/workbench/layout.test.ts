import { describe, expect, it } from 'vitest';
import { deriveAgentWorkbenchLayout } from './layout';

describe('deriveAgentWorkbenchLayout', () => {
  it('keeps both navigation rails expanded on a wide surface', () => {
    expect(deriveAgentWorkbenchLayout(1280, true, true)).toEqual({
      narrow: false,
      ultraNarrow: false,
      agentRail: 'expanded',
      topicRail: 'expanded',
      inspectorVisible: true,
    });
  });

  it('collapses secondary rails before the center rail becomes narrow', () => {
    expect(deriveAgentWorkbenchLayout(760, false, false)).toEqual({
      narrow: true,
      ultraNarrow: false,
      agentRail: 'collapsed',
      topicRail: 'collapsed',
      inspectorVisible: false,
    });
  });

  it('allows either compact navigation rail to expand without hiding Topic access', () => {
    expect(deriveAgentWorkbenchLayout(760, true, true)).toMatchObject({
      agentRail: 'expanded', topicRail: 'collapsed',
    });
    expect(deriveAgentWorkbenchLayout(760, false, true)).toMatchObject({
      agentRail: 'collapsed', topicRail: 'expanded',
    });
  });

  it('ignores zero-width samples from hidden keep-alive pages', () => {
    expect(deriveAgentWorkbenchLayout(0, false, false)).toEqual({
      narrow: false,
      ultraNarrow: false,
      agentRail: 'collapsed',
      topicRail: 'collapsed',
      inspectorVisible: true,
    });
  });

  it('uses full-width navigation only below the prototype ultra-narrow breakpoint', () => {
    expect(deriveAgentWorkbenchLayout(559, false, false).ultraNarrow).toBe(true);
    expect(deriveAgentWorkbenchLayout(560, false, false).ultraNarrow).toBe(false);
  });
});
