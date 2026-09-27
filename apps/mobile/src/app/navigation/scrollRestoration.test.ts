import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAllScrollPositions, restoreScrollPosition, saveScrollPosition,
  readListAnchor, saveListAnchor, readRouteQuery, saveRouteQuery,
} from './scrollRestoration';

describe('Mobile scroll owner restoration', () => {
  beforeEach(clearAllScrollPositions);

  it('restores the actual page scroller, not the shell clipping wrapper', () => {
    const page = {
      scrollTop: 720, scrollLeft: 0, clientHeight: 700, scrollHeight: 2000,
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const shell = {
      scrollTop: 0, scrollLeft: 0, clientHeight: 700, scrollHeight: 700,
      matches: () => false,
      querySelector: (selector: string) => selector === '.page-container' ? page : null,
    } as unknown as Element;
    saveScrollPosition('tab:contacts', shell);
    page.scrollTop = 0;
    expect(restoreScrollPosition('tab:contacts', shell)).toBe(true);
    expect(page.scrollTop).toBe(720);
  });

  it('bounds restoration metadata and clears every query/window at a scope fence', () => {
    for (let index = 0; index < 101; index += 1) {
      saveListAnchor(`route-${index}`, `row-${index}`);
      saveRouteQuery(`route-${index}`, `query-${index}`);
    }
    expect(readListAnchor('route-0')).toBeUndefined();
    expect(readRouteQuery('route-0')).toBe('');
    expect(readListAnchor('route-100')).toBe('row-100');
    expect(readRouteQuery('route-100')).toBe('query-100');
    clearAllScrollPositions();
    expect(readListAnchor('route-100')).toBeUndefined();
    expect(readRouteQuery('route-100')).toBe('');
  });
});
