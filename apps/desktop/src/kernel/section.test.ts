import { describe, expect, it } from 'vitest';

import { nextMountedSectionIds, shouldRenderSection, type SectionDescriptor } from './section';

const cached: SectionDescriptor = {
  id: 'providers',
  render: () => null,
};

const selectedOnly: SectionDescriptor = {
  id: 'logs',
  policy: { cache: 'selected-only' },
  render: () => null,
};

describe('section host policy', () => {
  it('keeps first-visit sections mounted after activation', () => {
    const mounted = nextMountedSectionIds(cached, new Set<string>());

    expect(mounted.has('providers')).toBe(true);
    expect(shouldRenderSection(cached, 'models', mounted)).toBe(true);
  });

  it('unmounts selected-only sections when inactive', () => {
    const mounted = nextMountedSectionIds(selectedOnly, new Set<string>(['logs']));

    expect(mounted.has('logs')).toBe(true);
    expect(shouldRenderSection(selectedOnly, 'providers', mounted)).toBe(false);
    expect(shouldRenderSection(selectedOnly, 'logs', mounted)).toBe(true);
  });
});
