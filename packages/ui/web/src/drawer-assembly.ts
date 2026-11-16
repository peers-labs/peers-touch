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
    readable: geometry.chatRail.expandedMinWidth,
    rows: geometry.chatRail.rowsMinWidth,
    stop: geometry.chatRail.maxWidth,
    step: geometry.chatRail.keyboardStep,
  },
  work: geometry.drawer.work,
  leaf: geometry.drawer.leaf,
} as const;

export type DrawerLeaf = { kind: 'detail' } | { kind: 'thread'; messageId: string };
export type ForceDirection = -1 | 0 | 1;
export const bounded = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export function settleCatalog(raw: number, direction: ForceDirection = 0): number {
  const { compact, readable, stop } = drawerPolicy.catalog;
  if (!Number.isFinite(raw)) return drawerPolicy.catalog.default;
  const x = bounded(raw, compact, stop);
  if (x >= readable || x === compact) return Math.round(x);
  if (direction < 0) return compact;
  if (direction > 0) return readable;
  return x < (compact + readable) / 2 ? compact : readable;
}

/** Both rails yield under pressure; the reading ideal is not a reservation.
 * A fixed envelope makes the visible boundary invertible during a gesture.
 */
function catalogShare(stage: number) {
  const { compact, stop } = drawerPolicy.catalog;
  const { minimum, usable } = drawerPolicy.work;
  return bounded((stage - compact - minimum) / (stop - compact + usable - minimum), 0, 1);
}

function catalogExposure(stage: number, paper: number) {
  const compact = Math.min(stage, drawerPolicy.catalog.compact);
  return Math.min(stage, compact + (paper - compact) * catalogShare(stage));
}

/** Convert a drawn, reachable boundary back into the user's paper intent. */
export function catalogPreferenceForBoundary(stage: number, boundary: number, navigation: number) {
  if (navigation === 0) return bounded(boundary, drawerPolicy.catalog.compact, drawerPolicy.catalog.stop);
  const share = catalogShare(Math.max(0, stage));
  return share > 0
    ? bounded(drawerPolicy.catalog.compact + (boundary - drawerPolicy.catalog.compact) / share,
      drawerPolicy.catalog.compact, drawerPolicy.catalog.stop)
    : drawerPolicy.catalog.compact;
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
  const maxPaper = Math.min(width, drawerPolicy.catalog.stop);
  return {
    width, height: Math.max(0, stageHeight), paper, exposure, workWidth, pressure, mainX,
    catalogResizeMin: Math.min(width, drawerPolicy.catalog.compact),
    catalogResizeMax: navigation === 0 ? maxPaper : catalogExposure(width, drawerPolicy.catalog.stop),
    composerBudget: Math.min(280, Math.max(96, (stageHeight - 52) * .58)),
    visibleCatalog,
    catalogRowsCompact: visibleCatalog < drawerPolicy.catalog.rows,
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
