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

export type MessageActionPlacement = 'above' | 'below' | 'left' | 'right';

export interface MessageActionGeometryRequest {
  surfaceSize: GeometrySize;
  paneRect: GeometryRect;
  viewportRect: GeometryRect;
  selectedContentRect: GeometryRect;
  adjacentContentRects: readonly GeometryRect[];
  preferredPlacements: readonly MessageActionPlacement[];
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
): number[] {
  const minimum = bounds.left;
  const maximum = bounds.right - width;
  const preferred = anchor.left + ((anchor.right - anchor.left) - width) / 2;
  const candidates = uniqueFinite([
    preferred,
    anchor.left,
    anchor.right - width,
    minimum,
    maximum,
    ...obstacles.flatMap((obstacle) => [obstacle.left - width, obstacle.right]),
  ]);

  return candidates
    .map((candidate) => clamp(candidate, minimum, maximum))
    .sort((first, second) => Math.abs(first - preferred) - Math.abs(second - preferred));
}

function verticalCandidates(
  anchor: GeometryRect,
  obstacles: readonly GeometryRect[],
  bounds: GeometryRect,
  height: number,
): number[] {
  const minimum = bounds.top;
  const maximum = bounds.bottom - height;
  const preferred = anchor.top + ((anchor.bottom - anchor.top) - height) / 2;
  const candidates = uniqueFinite([
    preferred,
    anchor.top,
    anchor.bottom - height,
    minimum,
    maximum,
    ...obstacles.flatMap((obstacle) => [obstacle.top - height, obstacle.bottom]),
  ]);

  return candidates
    .map((candidate) => clamp(candidate, minimum, maximum))
    .sort((first, second) => Math.abs(first - preferred) - Math.abs(second - preferred));
}

function placementCandidates(
  placement: MessageActionPlacement,
  anchor: GeometryRect,
  obstacles: readonly GeometryRect[],
  bounds: GeometryRect,
  size: GeometrySize,
  gap: number,
): Point[] {
  if (placement === 'above' || placement === 'below') {
    const top = placement === 'above'
      ? anchor.top - gap - size.height
      : anchor.bottom + gap;

    return horizontalCandidates(anchor, obstacles, bounds, size.width)
      .map((left) => ({ left, top }));
  }

  const left = placement === 'left'
    ? anchor.left - gap - size.width
    : anchor.right + gap;

  return verticalCandidates(anchor, obstacles, bounds, size.height)
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

  for (const placement of placementOrder) {
    const candidates = placementCandidates(
      placement,
      selectedContentRect,
      obstacles,
      bounds,
      surfaceSize,
      gap,
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
