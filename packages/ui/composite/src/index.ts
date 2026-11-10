/**
 * @peers-touch/ui-composite — public entry point.
 *
 * Three composite components are exported from this barrel. Hosts must NOT
 * deep-path import internal files (test utilities, CSS modules, or type-only
 * siblings of a component). See module-layout.md §3 for the boundary.
 */

export type { CompositeTranslate } from './i18n';
export type { RegionKey, SurfaceHooks } from './hooks';

// ── P1: GlobalSearchSurface ─────────────────────────────────────────────

export { GlobalSearchSurface } from './search/GlobalSearchSurface';
export type {
  SearchResultRow,
  SearchGroup,
  SearchSurfaceModel,
  SearchSurfaceIntents,
  SearchRegionKey,
  SearchStatus,
  GlobalSearchSurfaceProps,
} from './search/search.types';

// ── P2: IdentityProfileCard ─────────────────────────────────────────────

export { IdentityProfileCard } from './identity/IdentityProfileCard';
export type {
  ProfileVariant,
  IdentityProfileModel,
  IdentityProfileIntents,
  IdentityProfileCardProps,
  IdentityRegionKey,
  IdentityTechnicalDetail,
  IdentityMoment,
  IdentityRelation,
} from './identity/identity.types';

// ── P3: ConversationRail + ConversationRow ──────────────────────────────

export { ConversationRail } from './conversation-rail/ConversationRail';
export type {
  ConversationRailProps,
  ConversationRailModel,
  ConversationRailIntents,
  ConversationRailSlots,
  ConversationRailRegionKey,
  ConversationRowModel,
  ConversationMenuAction,
  ConversationQuickAction,
} from './conversation-rail/conversation-rail.types';
