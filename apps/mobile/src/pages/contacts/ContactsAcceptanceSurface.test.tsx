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

  it('gives every create-group member checkbox an accessible name', () => {
    // The whole-product audit flags any interactive control whose
    // aria-label/placeholder/title/textContent is empty. Member names live in
    // a sibling row, so each checkbox must carry its own aria-label, matching
    // the production ContactsPage group member picker.
    const html = renderToStaticMarkup(
      <ContactsAcceptanceSurface surfaceId="contacts.create-group" />,
    );
    const checkboxInputs = html.match(/<input[^>]*type="checkbox"[^>]*>/g)
      ?? [];

    expect(checkboxInputs).toHaveLength(2);
    for (const input of checkboxInputs) {
      expect(input).toMatch(/aria-label="[^"]+"/);
    }
  });
});
