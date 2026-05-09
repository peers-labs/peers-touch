// PageDescriptor for the search (home) page.
//
// Search is the landing page, hence `preload: 'eager'` and
// `keepAlive: 'forever'` so query/result state survives tab switches.
// The runtime ownership entry lives in `runtimes/searchRuntime.ts`.

import { registerPage } from '../kernel/page';
import { SearchPageContainer } from './SearchPageContainer';

export function registerSearchPage(): void {
  registerPage({
    id: 'search',
    title: 'Search',
    factory: () => <SearchPageContainer />,
    preload: 'eager',
    keepAlive: 'forever',
    runtimes: ['search'],
  });
}
