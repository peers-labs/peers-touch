// PageDescriptor for the marketplace (discovery) page.
//
// Marketplace is a browse/search UI for Agent, Skill, MCP, and merged Plugin packages.
// Loaded lazily since users don't land here on every session.
// keepAlive: 'session' preserves scroll/tab state within a session.

import { registerPage } from '../kernel/page';
import { MarketplacePageContainer } from './MarketplacePageContainer';

export function registerMarketplacePage(): void {
  registerPage({
    id: 'marketplace',
    title: 'Marketplace',
    factory: () => <MarketplacePageContainer />,
    preload: 'on-visit',
    keepAlive: { lru: 1 },
    runtimes: [],
  });
}
