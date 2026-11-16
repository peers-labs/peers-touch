/**
 * Shared frame allocation for the canonical prototype and Desktop.
 * Space is allocated once; preference, environment pressure and navigation
 * are independent inputs. See prototype/drawer-assembly.md.
 */
import { geometry } from '@peers-touch/ui-tokens';

export const drawerPolicy = {
  catalog: {
    default: geometry.chatRail.defaultWidth,
    compact: geometry.chatRail.minWidth,
    // The smallest stable rest is the width that still fits the complete rail
    // header tool group. The band below it down to compact has no stable rest.
    usableMin: geometry.chatRail.toolsMinWidth,
    rows: geometry.chatRail.rowsMinWidth,
    tools: geometry.chatRail.toolsMinWidth,
    stop: geometry.chatRail.maxWidth,
    step: geometry.chatRail.keyboardStep,
  },
  work: geometry.drawer.work,
  leaf: geometry.drawer.leaf,
} as const;

export type DrawerLeaf = { kind: 'detail' } | { kind: 'thread'; messageId: string };
export type ForceDirection = -1 | 0 | 1;
export type CatalogRest = 'compact' | 'expanded';
export const bounded = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** Persistence describes any stable expanded paper, never temporary pressure/collapse. */
export function expandedCatalogWidth(raw: number): number {
  const { usableMin, stop, default: fallback } = drawerPolicy.catalog;
  return Number.isFinite(raw) && raw >= usableMin
    ? Math.round(bounded(raw, usableMin, stop)) : fallback;
}

/** Reachable stops are screen coordinates, not a hidden paper inverse. */
export function catalogBounds(stage: number, navigation: number) {
  const width = Math.max(0, stage);
  const min = Math.min(width, drawerPolicy.catalog.compact);
  const paperMax = Math.min(width, drawerPolicy.catalog.stop);
  const openMax = Math.min(paperMax, Math.max(min, width - drawerPolicy.work.minimum));
  return { min, max: paperMax + bounded(navigation, 0, 1) * (openMax - paperMax) };
}

function catalogExposure(stage: number, paper: number) {
  return Math.min(paper, catalogBounds(stage, 1).max);
}

export type CatalogSettlement = { rest: CatalogRest; width: number };

/**
 * Release settlement.
 * The usable band [usableMin, stop] keeps every exact released width: a user
 * who likes a 172px rail gets a 172px rail. Only the gap between the compact
 * stop and the usable minimum has no stable rest, and there the gesture's
 * final direction picks which side of the gap to settle on.
 */
export function settleCatalogBoundary(
  boundary: number,
  range: { min: number; max: number },
  direction: ForceDirection,
): CatalogSettlement {
  const { usableMin } = drawerPolicy.catalog;
  const wanted = bounded(boundary, range.min, range.max);
  if (wanted >= usableMin) return { rest: 'expanded', width: wanted };
  // A compressed frame may cap the reachable edge below the nominal floor.
  const reachableUsableMin = Math.min(usableMin, range.max);
  const towardCompact = direction < 0
    || (direction === 0 && wanted < (range.min + reachableUsableMin) / 2);
  return towardCompact
    ? { rest: 'compact', width: range.min }
    : { rest: 'expanded', width: reachableUsableMin };
}

/** A larger frame releases collapse once remembered paper fits completely. */
export function catalogRestAfterFrame(rest: CatalogRest, previous: number, next: number, expanded: number, navigation: number): CatalogRest {
  return next > previous && catalogBounds(next, navigation).max >= expanded ? 'expanded' : rest;
}

/** All rectangles derive from this snapshot; no viewport/media-query mode. */
export function resolveDrawerAssembly(stage: number, preferred: number, navigation: number, leaf: number, stageHeight = 600) {
  const width = Math.max(0, stage);
  const preferredPaper = bounded(preferred, drawerPolicy.catalog.compact, drawerPolicy.catalog.stop);
  const paper = Math.min(width, preferredPaper);
  const exposure = catalogExposure(width, preferredPaper);
  const workWidth = width - exposure;
  const pressure = paper ? (paper - exposure) / paper : 0;
  // The closed leaf parks progressively farther into its right-hand guide
  // as the frame loads the assembly, always clearing the entire catalogue.
  const parkedX = Math.max(paper, exposure + pressure * workWidth);
  const mainX = exposure + (1 - navigation) * (parkedX - exposure);
  const visibleCatalog = Math.min(paper, mainX);
  return {
    width, height: Math.max(0, stageHeight), paper, exposure, workWidth, pressure, mainX,
    catalogResizeMin: catalogBounds(width, navigation).min,
    catalogResizeMax: catalogBounds(width, navigation).max,
    composerBudget: Math.min(280, Math.max(96, (stageHeight - 52) * .58)),
    visibleCatalog,
    catalogRowsCompact: visibleCatalog < drawerPolicy.catalog.rows,
    catalogToolsCompact: visibleCatalog < drawerPolicy.catalog.tools,
    catalogInteractive: visibleCatalog >= drawerPolicy.catalog.compact,
    workToolsCompact: workWidth < drawerPolicy.work.compactTools,
    messageToolsBelow: workWidth < drawerPolicy.work.sideActionRail,
    // A narrow bay cannot pretend the remaining sliver is parallel work.
    // The inner task fills that bay; only a full reading remainder docks it.
    leafWidth: workWidth < drawerPolicy.work.reading + drawerPolicy.leaf.width
      ? workWidth : drawerPolicy.leaf.width,
    leafX: (workWidth < drawerPolicy.work.reading + drawerPolicy.leaf.width
      ? workWidth : drawerPolicy.leaf.width) * (1 - leaf),
    compressed: pressure > 0,
  };
}

/** Token curve is monotonic, with no spring/collision overshoot. */
export function drawerEase(progress: number) {
  const [x1, y1, x2, y2] = geometry.motion.drawer.match(/[\d.]+/g)!.map(Number);
  const coordinate = (t: number, a: number, b: number) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  let low = 0, high = 1;
  for (let n = 0; n < 16; n++) {
    const middle = (low + high) / 2;
    if (coordinate(middle, x1, x2) < progress) low = middle; else high = middle;
  }
  return coordinate((low + high) / 2, y1, y2);
}
