export interface GeometryRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface GeometrySize {
  width: number;
  height: number;
}

export type MessageActionPlacement = 'above' | 'below' | 'left' | 'right' | 'detached';

export interface MessageActionGeometryRequest {
  surfaceSize: GeometrySize;
  paneRect: GeometryRect;
  viewportRect: GeometryRect;
  selectedContentRect: GeometryRect;
  adjacentContentRects: readonly GeometryRect[];
  preferredPlacements: readonly MessageActionPlacement[];
  /**
   * Inner edge the toolbar hugs when placed above/below the bubble:
   * an own (right-side) message aligns the toolbar's left edge to the
   * bubble's left edge; an incoming (left-side) message aligns the
   * toolbar's right edge to the bubble's right edge. Undefined keeps
   * the legacy centered alignment.
   */
  anchorEdge?: 'left' | 'right';
  gap: number;
  boundaryPadding: number;
}

export interface MessageActionGeometryResult {
  placement: MessageActionPlacement;
  rect: GeometryRect;
}

interface Point {
  left: number;
  top: number;
}

const DEFAULT_PLACEMENT_ORDER: readonly MessageActionPlacement[] = [
  'above',
  'below',
  'right',
  'left',
];

function isFiniteRect(rect: GeometryRect): boolean {
  return Number.isFinite(rect.left)
    && Number.isFinite(rect.top)
    && Number.isFinite(rect.right)
    && Number.isFinite(rect.bottom)
    && rect.right >= rect.left
    && rect.bottom >= rect.top;
}

function intersectRects(first: GeometryRect, second: GeometryRect): GeometryRect | null {
  const intersection = {
    left: Math.max(first.left, second.left),
    top: Math.max(first.top, second.top),
    right: Math.min(first.right, second.right),
    bottom: Math.min(first.bottom, second.bottom),
  };

  return intersection.right >= intersection.left && intersection.bottom >= intersection.top
    ? intersection
    : null;
}

function insetRect(rect: GeometryRect, inset: number): GeometryRect | null {
  const insetBounds = {
    left: rect.left + inset,
    top: rect.top + inset,
    right: rect.right - inset,
    bottom: rect.bottom - inset,
  };

  return insetBounds.right >= insetBounds.left && insetBounds.bottom >= insetBounds.top
    ? insetBounds
    : null;
}

function rectsOverlap(first: GeometryRect, second: GeometryRect): boolean {
  return first.left < second.right
    && first.right > second.left
    && first.top < second.bottom
    && first.bottom > second.top;
}

function rectAt(point: Point, size: GeometrySize): GeometryRect {
  return {
    left: point.left,
    top: point.top,
    right: point.left + size.width,
    bottom: point.top + size.height,
  };
}

function isInside(rect: GeometryRect, bounds: GeometryRect): boolean {
  return rect.left >= bounds.left
    && rect.top >= bounds.top
    && rect.right <= bounds.right
    && rect.bottom <= bounds.bottom;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function uniqueFinite(values: readonly number[]): number[] {
  return [...new Set(values.filter(Number.isFinite))];
}

function horizontalCandidates(
  anchor: GeometryRect,
  obstacles: readonly GeometryRect[],
  bounds: GeometryRect,
  width: number,
  anchorEdge: 'left' | 'right' | undefined,
  attached: boolean,
): number[] {
  const minimum = bounds.left;
  const maximum = bounds.right - width;
  const centered = anchor.left + ((anchor.right - anchor.left) - width) / 2;
  // The inner-edge hug is the primary position: below/above the bubble the
  // toolbar sits at the bubble's conversation-center edge (left edge for own
  // messages, right edge for incoming). Centering remains the first dodge.
  const edgeAligned = anchorEdge === 'left'
    ? anchor.left
    : anchorEdge === 'right'
      ? anchor.right - width
      : centered;
  const preferred = anchorEdge ? edgeAligned : centered;

  // While attached (above/below/left/right placements) the toolbar must keep
  // reading as belonging to its bubble. Two rules:
  // 1. dodge positions may slide at most one toolbar width beyond the anchor's
  //    horizontal extent (the band below);
  // 2. at least half the toolbar keeps overlapping the anchor along the
  //    attachment axis (relative to the toolbar, not the bubble: a compact
  //    bar beside a tall bubble still attaches);
  // Without these a stacked neighbour bubble flung the toolbar hundreds of
  // pixels into the pane gutter ("detached-looking"). Only the explicit
  // `detached` fallback may leave the band.
  const bandMinimum = attached ? anchor.left - width : minimum;
  const bandMaximum = attached ? anchor.right : maximum;
  // At least half of the toolbar must overlap the anchor's horizontal
  // extent (relative to the smaller toolbar, not the bubble: a compact bar
  // beside a tall bubble still attaches).
  const requiredOverlap = width * 0.5;
  const overlapsAnchorAxis = (candidate: number): boolean => {
    if (!attached) return true;
    const overlap = Math.min(candidate + width, anchor.right)
      - Math.max(candidate, anchor.left);
    return overlap + 0.5 >= requiredOverlap;
  };
  const inBand = (candidate: number): boolean =>
    candidate >= bandMinimum - 0.5 && candidate <= bandMaximum + 0.5;

  const candidates = uniqueFinite([
    edgeAligned,
    centered,
    anchor.left,
    anchor.right - width,
    ...(attached ? [] : [minimum, maximum]),
    ...obstacles.flatMap((obstacle) => [obstacle.left - width, obstacle.right]),
  ]);

  return candidates
    .map((candidate) => clamp(candidate, minimum, maximum))
    .filter((candidate) => inBand(candidate) && overlapsAnchorAxis(candidate))
    .sort((first, second) => Math.abs(first - preferred) - Math.abs(second - preferred));
}

function verticalCandidates(
  anchor: GeometryRect,
  obstacles: readonly GeometryRect[],
  bounds: GeometryRect,
  height: number,
  attached: boolean,
): number[] {
  const minimum = bounds.top;
  const maximum = bounds.bottom - height;
  const preferred = anchor.top + ((anchor.bottom - anchor.top) - height) / 2;
  // Vertical counterpart of the horizontal attachment band: an attached side
  // placement stays within one toolbar height of the anchor and overlaps its
  // vertical extent by at least half.
  const bandMinimum = attached ? anchor.top - height : minimum;
  const bandMaximum = attached ? anchor.bottom : maximum;
  const requiredOverlap = height * 0.5;
  const inBand = (candidate: number): boolean =>
    candidate >= bandMinimum - 0.5 && candidate <= bandMaximum + 0.5;
  const overlapsAnchorAxis = (candidate: number): boolean => {
    if (!attached) return true;
    const overlap = Math.min(candidate + height, anchor.bottom)
      - Math.max(candidate, anchor.top);
    return overlap + 0.5 >= requiredOverlap;
  };
  const candidates = uniqueFinite([
    preferred,
    anchor.top,
    anchor.bottom - height,
    ...(attached ? [] : [minimum, maximum]),
    ...obstacles.flatMap((obstacle) => [obstacle.top - height, obstacle.bottom]),
  ]);

  return candidates
    .map((candidate) => clamp(candidate, minimum, maximum))
    .filter((candidate) => inBand(candidate) && overlapsAnchorAxis(candidate))
    .sort((first, second) => Math.abs(first - preferred) - Math.abs(second - preferred));
}

function placementCandidates(
  placement: MessageActionPlacement,
  anchor: GeometryRect,
  obstacles: readonly GeometryRect[],
  bounds: GeometryRect,
  size: GeometrySize,
  gap: number,
  anchorEdge?: 'left' | 'right',
): Point[] {
  if (placement === 'detached') {
    const horizontal = horizontalCandidates(
      anchor, obstacles, bounds, size.width, anchorEdge, false,
    );
    const vertical = verticalCandidates(anchor, obstacles, bounds, size.height, false);
    const preferredLeft = anchorEdge === 'left'
      ? anchor.left
      : anchorEdge === 'right'
        ? anchor.right - size.width
        : anchor.left + ((anchor.right - anchor.left) - size.width) / 2;
    const preferredTop = anchor.top + ((anchor.bottom - anchor.top) - size.height) / 2;

    return horizontal
      .flatMap((left) => vertical.map((top) => ({ left, top })))
      .sort((first, second) => (
        Math.abs(first.left - preferredLeft) + Math.abs(first.top - preferredTop)
        - Math.abs(second.left - preferredLeft) - Math.abs(second.top - preferredTop)
      ));
  }

  if (placement === 'above' || placement === 'below') {
    const top = placement === 'above'
      ? anchor.top - gap - size.height
      : anchor.bottom + gap;

    return horizontalCandidates(
      anchor, obstacles, bounds, size.width, anchorEdge, true,
    )
      .map((left) => ({ left, top }));
  }

  const left = placement === 'left'
    ? anchor.left - gap - size.width
    : anchor.right + gap;

  return verticalCandidates(anchor, obstacles, bounds, size.height, true)
    .map((top) => ({ left, top }));
}

export function placeMessageActionSurface(
  request: MessageActionGeometryRequest,
): MessageActionGeometryResult | null {
  const {
    surfaceSize,
    paneRect,
    viewportRect,
    selectedContentRect,
    adjacentContentRects,
    preferredPlacements,
    anchorEdge,
    gap,
    boundaryPadding,
  } = request;

  if (
    !isFiniteRect(paneRect)
    || !isFiniteRect(viewportRect)
    || !isFiniteRect(selectedContentRect)
    || adjacentContentRects.some((rect) => !isFiniteRect(rect))
    || !Number.isFinite(surfaceSize.width)
    || !Number.isFinite(surfaceSize.height)
    || surfaceSize.width <= 0
    || surfaceSize.height <= 0
    || !Number.isFinite(gap)
    || gap < 0
    || !Number.isFinite(boundaryPadding)
    || boundaryPadding < 0
  ) {
    return null;
  }

  const visiblePane = intersectRects(paneRect, viewportRect);
  const bounds = visiblePane ? insetRect(visiblePane, boundaryPadding) : null;
  if (
    !bounds
    || surfaceSize.width > bounds.right - bounds.left
    || surfaceSize.height > bounds.bottom - bounds.top
  ) {
    return null;
  }

  const obstacles = [selectedContentRect, ...adjacentContentRects];
  const placementOrder = preferredPlacements.length > 0
    ? preferredPlacements
    : DEFAULT_PLACEMENT_ORDER;
  const completePlacementOrder = placementOrder.includes('detached')
    ? placementOrder
    : [...placementOrder, 'detached' as const];

  for (const placement of completePlacementOrder) {
    const candidates = placementCandidates(
      placement,
      selectedContentRect,
      obstacles,
      bounds,
      surfaceSize,
      gap,
      anchorEdge,
    );

    for (const candidate of candidates) {
      const rect = rectAt(candidate, surfaceSize);
      if (isInside(rect, bounds) && obstacles.every((obstacle) => !rectsOverlap(rect, obstacle))) {
        return { placement, rect };
      }
    }
  }

  return null;
}
