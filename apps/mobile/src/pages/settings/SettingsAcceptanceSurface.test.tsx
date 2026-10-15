import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  SETTINGS_SURFACE_FIXTURE_IDS,
} from '../../acceptance/settingsSurfaceFixture';
import { SettingsAcceptanceSurface } from './SettingsAcceptanceSurface';

vi.mock('../../app/mobileI18n', () => ({
  useMobileI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe('SettingsAcceptanceSurface', () => {
  it.each(SETTINGS_SURFACE_FIXTURE_IDS)(
    'renders the declared foreground selector for %s',
    (surfaceId) => {
      const html = renderToStaticMarkup(
        <SettingsAcceptanceSurface surfaceId={surfaceId} />,
      );

      if (surfaceId === 'settings.unsaved-exit') {
        expect(html).toContain('data-acceptance-id="settings-unsaved-exit"');
      } else {
        expect(html).toContain(`data-product-surface="${surfaceId}"`);
      }
      expect(html).not.toMatch(/ptid:v?[0-9]*:/);
      expect(html).not.toContain('https://station.');
    },
  );
});
