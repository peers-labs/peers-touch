import { describe, expect, it } from 'vitest';

import {
  placeMessageActionSurface,
  type GeometryRect,
  type MessageActionGeometryRequest,
} from './messageActionGeometry';

const paneRect: GeometryRect = {
  left: 100,
  top: 100,
  right: 700,
  bottom: 700,
};

function request(
  overrides: Partial<MessageActionGeometryRequest> = {},
): MessageActionGeometryRequest {
  return {
    surfaceSize: { width: 160, height: 40 },
    paneRect,
    viewportRect: { left: 0, top: 0, right: 800, bottom: 800 },
    selectedContentRect: { left: 300, top: 350, right: 500, bottom: 450 },
    adjacentContentRects: [],
    preferredPlacements: ['above', 'below', 'right', 'left'],
    gap: 8,
    boundaryPadding: 12,
    ...overrides,
  };
}

function overlaps(first: GeometryRect, second: GeometryRect): boolean {
  return first.left < second.right
    && first.right > second.left
    && first.top < second.bottom
    && first.bottom > second.top;
}

describe('message action geometry', () => {
  it('places a toolbar above the selected content inside pane and viewport bounds', () => {
    const result = placeMessageActionSurface(request());

    expect(result).toEqual({
      placement: 'above',
      rect: {
        left: 320,
        top: 302,
        right: 480,
        bottom: 342,
      },
    });
  });

  it('falls below the selected content when the preferred side leaves the visible pane', () => {
    const selectedContentRect = { left: 300, top: 116, right: 500, bottom: 196 };
    const result = placeMessageActionSurface(request({ selectedContentRect }));

    expect(result?.placement).toBe('below');
    expect(result?.rect).toEqual({
      left: 320,
      top: 204,
      right: 480,
      bottom: 244,
    });
  });

  it('uses the pane and viewport intersection for a picker near a clipped edge', () => {
    const result = placeMessageActionSurface(request({
      surfaceSize: { width: 180, height: 180 },
      paneRect: { left: 100, top: 100, right: 900, bottom: 700 },
      viewportRect: { left: 0, top: 0, right: 620, bottom: 800 },
      selectedContentRect: { left: 500, top: 300, right: 590, bottom: 380 },
      preferredPlacements: ['below'],
    }));

    expect(result).toEqual({
      placement: 'below',
      rect: {
        left: 428,
        top: 388,
        right: 608,
        bottom: 568,
      },
    });
  });

  it('moves along the requested side to avoid adjacent message content', () => {
    const adjacentContentRect = { left: 300, top: 280, right: 500, bottom: 344 };
    const result = placeMessageActionSurface(request({
      adjacentContentRects: [adjacentContentRect],
      preferredPlacements: ['above'],
    }));

    expect(result?.placement).toBe('above');
    expect(result?.rect).toEqual({
      left: 140,
      top: 302,
      right: 300,
      bottom: 342,
    });
    expect(overlaps(result!.rect, adjacentContentRect)).toBe(false);
  });

  it('falls to another side when adjacent rows block the preferred side', () => {
    const selectedContentRect = { left: 300, top: 350, right: 500, bottom: 450 };
    const result = placeMessageActionSurface(request({
      selectedContentRect,
      adjacentContentRects: [
        { left: 112, top: 280, right: 688, bottom: 350 },
        { left: 112, top: 450, right: 688, bottom: 520 },
      ],
      preferredPlacements: ['above', 'below', 'right'],
    }));

    expect(result?.placement).toBe('right');
    expect(result?.rect.left).toBe(508);
    expect(overlaps(result!.rect, selectedContentRect)).toBe(false);
  });

  it('returns null when no placement avoids selected and adjacent content', () => {
    const result = placeMessageActionSurface(request({
      paneRect: { left: 0, top: 0, right: 300, bottom: 300 },
      viewportRect: { left: 0, top: 0, right: 300, bottom: 300 },
      selectedContentRect: { left: 100, top: 100, right: 200, bottom: 200 },
      adjacentContentRects: [
        { left: 0, top: 0, right: 300, bottom: 100 },
        { left: 0, top: 200, right: 300, bottom: 300 },
        { left: 0, top: 100, right: 100, bottom: 200 },
        { left: 200, top: 100, right: 300, bottom: 200 },
      ],
      surfaceSize: { width: 80, height: 40 },
      gap: 0,
      boundaryPadding: 0,
    }));

    expect(result).toBeNull();
  });

  it('returns null for invalid or oversized geometry', () => {
    expect(placeMessageActionSurface(request({
      surfaceSize: { width: 700, height: 40 },
    }))).toBeNull();

    expect(placeMessageActionSurface(request({
      selectedContentRect: { left: 500, top: 350, right: 300, bottom: 450 },
    }))).toBeNull();
  });
});
