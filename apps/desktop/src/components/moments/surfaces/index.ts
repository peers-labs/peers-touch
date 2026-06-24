// Social surface primitives.
//
// These components are the visual "lego" pieces for the Moments pages.
// They are pure renderers — no store access, no protocol decisions —
// so their styling rules stay shared and predictable.
//
// Visual contract (all surfaces share this):
//   * radius   : 14 (rail) / 12 (inline sub-block)
//   * border   : token.colorBorderSecondary
//   * background: token.colorBgContainer (or colorBgLayout for the rail)
//   * spacing  : 8 / 10 / 14 / 16 / 18 — never arbitrary numbers
//   * text     : 12–15 px band, secondary text uses colorTextSecondary
//
// Consumers (MomentsApp, MomentCard, MomentDetailView…) use these to
// build their own views.  If you need a new visual shape, add a new
// component here — don't inline border-radius tokens in a page.

export { SocialContentRail, SocialSection, SocialScopeDivider } from './SocialContentRail';
export type {
  SocialContentRailProps,
  SocialSectionProps,
} from './SocialContentRail';

export { SocialScopeBar, SocialScopeHint } from './SocialScopeBar';
export type { SocialScopeBarProps, SocialScopeBarTab } from './SocialScopeBar';

export { SocialTrustMeta } from './SocialTrustMeta';
export type { SocialTrustMetaProps } from './SocialTrustMeta';

export { SocialActionBar } from './SocialActionBar';
export type { SocialActionBarProps } from './SocialActionBar';

export {
  SocialThreadSurface,
  SocialThreadHeader,
  SocialThreadBody,
  SocialThreadDivider,
  SocialThreadSection,
} from './SocialThreadSurface';
export type {
  SocialThreadSurfaceProps,
  SocialThreadHeaderProps,
  SocialThreadBodyProps,
  SocialThreadSectionProps,
} from './SocialThreadSurface';

export { SocialComposer } from './SocialComposer';
export type { SocialComposerProps } from './SocialComposer';

export { SocialEmptyState, SocialSearchEmpty } from './SocialEmptyState';
export type {
  SocialEmptyKind,
  SocialEmptyStateProps,
} from './SocialEmptyState';
