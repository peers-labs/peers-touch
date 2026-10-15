import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  CONTACTS_SURFACE_FIXTURE_IDS,
} from '../../acceptance/contactsSurfaceFixture';
import { ContactsAcceptanceSurface } from './ContactsAcceptanceSurface';

vi.mock('../../app/mobileI18n', () => ({
  useMobileI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe('ContactsAcceptanceSurface', () => {
  it.each(CONTACTS_SURFACE_FIXTURE_IDS)(
    'renders the declared foreground selector for %s',
    (surfaceId) => {
      const html = renderToStaticMarkup(
        <ContactsAcceptanceSurface surfaceId={surfaceId} />,
      );

      if (surfaceId === 'contacts.create-group') {
        expect(html).toContain('data-acceptance-id="create-group"');
      } else {
        expect(html).toContain(`data-product-surface="${surfaceId}"`);
      }
      expect(html).not.toMatch(/ptid:v?[0-9]*:/);
      expect(html).not.toContain('mobile.contacts.didPlaceholder');
    },
  );
});
