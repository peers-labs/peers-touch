import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UIProvider } from '@peers-touch/ui';
import { describe, expect, it, vi } from 'vitest';
import { FindPeopleSurface } from './FindPeopleSurface';

vi.mock('../../app/mobileI18n', () => ({
  useMobileI18n: () => ({ t: (key: string) => key }),
}));

const props = {
  query: '', scope: { kind: 'station' } as const, federations: [], results: [],
  loading: false, feedback: 'idle', onQueryChange: () => undefined,
  onScopeChange: () => undefined, onSearch: () => undefined, onBack: () => undefined,
};

describe('Find People dedicated page', () => {
  it('keeps an enabled top search field without any Federation or modal', () => {
    const html = renderToStaticMarkup(<UIProvider><FindPeopleSurface {...props} /></UIProvider>);
    const input = html.match(/<input[^>]*data-focus-id="people-search-input"[^>]*>/)?.[0];
    expect(input).toBeDefined();
    expect(input).not.toMatch(/\sdisabled/);
    expect(html).toContain('data-acceptance-id="find-people-page"');
    expect(html).toContain('data-scroll-id="find-people-results"');
    expect(html).not.toContain('aria-modal="true"');
    expect(html).not.toContain('pt-bottom-sheet');
    expect(html).toContain('mobile.contacts.currentStation');
  });

  it('preserves the query and one specific retry reason after a failed search', () => {
    const html = renderToStaticMarkup(<UIProvider><FindPeopleSurface {...props}
      query="Bob" feedback="failed" error="Station offline" /></UIProvider>);
    expect(html).toContain('value="Bob"');
    expect(html).toContain('data-action-id="people-search-retry"');
    expect(html.match(/Station offline/g)).toHaveLength(1);
  });

  it('shows person identity and the concrete unavailable request reason', () => {
    const html = renderToStaticMarkup(<UIProvider><FindPeopleSurface {...props}
      query="Bob" feedback="results"
      results={[{ id: 'ptid:bob', ptid: 'ptid:bob', username: 'bob', displayName: 'Bob',
        avatar: '', homeStationPeerId: 'station-a' }]}
      actions={{ 'ptid:bob': { label: 'Send request', unavailableReason: 'Choose a shared Federation' } }}
      onSendRequest={() => undefined} /></UIProvider>);
    expect(html).toContain('Bob');
    expect(html).toContain('@bob');
    expect(html).toContain('Choose a shared Federation');
  });
});
