// Single horizontal geometry owner for full-height desktop pages.
//
// Every scrollable page body centers one of these columns instead of
// redeclaring ad-hoc maxWidths (720/800/900/1000/1200/1260…) or stretching
// edge to edge. The column always keeps a 24px gutter and caps line length,
// so wide windows no longer leave a dead right half or produce 2000px-wide
// form rows.
//
// Tiers:
//   narrow   – forms and reading surfaces (account, identity, help, command)
//   standard – mixed list/detail pages and most settings management
//   wide     – dense consoles that fill more space but never edge-to-edge

export type PageWidthTier = 'narrow' | 'standard' | 'wide';

export const PAGE_COLUMN_GUTTER = 24;

export const PAGE_WIDTH_TIERS: Record<PageWidthTier, number> = {
  narrow: 820,
  standard: 1180,
  wide: 1480,
};

export function pageColumnWidth(tier: PageWidthTier = 'standard'): string {
  const max = PAGE_WIDTH_TIERS[tier];
  return `min(${max}px, calc(100% - ${PAGE_COLUMN_GUTTER * 2}px))`;
}
