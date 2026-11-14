import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  CONTACTS_SURFACE_FIXTURE_IDS,
  contactsSurfaceFixtureRouteKind,
} from '../../acceptance/contactsSurfaceFixture';
import { ContactsAcceptanceSurface } from './ContactsAcceptanceSurface';
import { UIProvider } from '@peers-touch/ui';
import { ContactRemarkForm } from './ContactRemarkForm';

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
        <UIProvider><ContactsAcceptanceSurface surfaceId={surfaceId} /></UIProvider>,
      );

      if (surfaceId === 'contacts.create-group') {
        expect(html).toContain('data-acceptance-id="create-group"');
      } else if (surfaceId === 'contacts.remark') {
        // The shared overlay portal mounts only after a client host exists.
        // Its native foreground visibility is checked by the whole-product Gate.
        expect(html).toContain('data-action-id="contacts.fixture.remark"');
        const form = renderToStaticMarkup(<ContactRemarkForm nickname="Alexandria" note="Launch"
          saving={false} error="" onNicknameChange={() => undefined} onNoteChange={() => undefined}
          onSave={() => undefined} />);
        expect(form).toContain('data-product-surface="contacts.remark"');
        expect(form).toContain('aria-label="mobile.contacts.nickname"');
        expect(form).toContain('data-action-id="contact-remark-save"');
      } else {
        expect(html).toContain(`data-product-surface="${surfaceId}"`);
      }
      expect(html).not.toMatch(/ptid:v?[0-9]*:/);
      expect(html).not.toContain('mobile.contacts.didPlaceholder');
      if (contactsSurfaceFixtureRouteKind(surfaceId) === 'people') {
        const input = html.match(/<input[^>]*data-focus-id="people-search-input"[^>]*>/)?.[0];
        expect(input).toBeDefined();
        expect(input).not.toMatch(/\s(?:readonly|disabled)(?:=|\s|>)/i);
      }
    },
  );

  it('gives every create-group member checkbox an accessible name', () => {
    // The whole-product audit flags any interactive control whose
    // aria-label/placeholder/title/textContent is empty. Member names live in
    // a sibling row, so each checkbox must carry its own aria-label, matching
    // the production ContactsPage group member picker.
    const html = renderToStaticMarkup(
      <UIProvider><ContactsAcceptanceSurface surfaceId="contacts.create-group" /></UIProvider>,
    );
    const checkboxInputs = html.match(/<input[^>]*type="checkbox"[^>]*>/g)
      ?? [];

    expect(checkboxInputs).toHaveLength(2);
    for (const input of checkboxInputs) {
      expect(input).toMatch(/aria-label="[^"]+"/);
    }
  });
});
