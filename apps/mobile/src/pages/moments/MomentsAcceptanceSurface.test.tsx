import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  MOMENTS_SURFACE_FIXTURE_IDS,
} from '../../acceptance/momentsSurfaceFixture';
import { MomentsAcceptanceSurface } from './MomentsAcceptanceSurface';

vi.mock('../../app/mobileI18n', () => ({
  useMobileI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe('MomentsAcceptanceSurface', () => {
  it.each(MOMENTS_SURFACE_FIXTURE_IDS)(
    'renders the declared foreground selector for %s',
    (surfaceId) => {
      const html = renderToStaticMarkup(
        <MomentsAcceptanceSurface surfaceId={surfaceId} />,
      );

      expect(html).toContain(`data-product-surface="${surfaceId}"`);
      expect(html).not.toMatch(/ptid:v?[0-9]*:/);
      expect(html).not.toContain('mobile.common.');
    },
  );
});
