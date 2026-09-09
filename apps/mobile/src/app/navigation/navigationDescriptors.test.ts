// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { beforeEach, describe, expect, it } from 'vitest';

import { primaryTabDescriptors } from './navigationDescriptors';
import {
  activeMobileDetailRoute,
  navigationLocationKey,
  resetMobileNavigation,
  useMobileNavigationStore,
} from './navigationStore';

describe('Mobile navigation descriptor lifetimes', () => {
  beforeEach(() => {
    resetMobileNavigation();
  });

  it('keeps every primary tab on-visit with no retained page tree', () => {
    expect(primaryTabDescriptors).toHaveLength(4);
    expect(primaryTabDescriptors.every((descriptor) => (
      descriptor.layout === 'primary' && descriptor.keepAlive === false
    ))).toBe(true);
  });

  it('owns primary and detail route identity independently of business stores', () => {
    useMobileNavigationStore.getState().navigatePrimary('tab:contacts');
    useMobileNavigationStore.getState().pushDetail({
      routeId: 'detail:chat-conversation',
      sessionUlid: 'session-1',
    });

    const state = useMobileNavigationStore.getState();
    expect(state.primaryRouteId).toBe('tab:contacts');
    expect(activeMobileDetailRoute(state)).toEqual({
      routeId: 'detail:chat-conversation',
      sessionUlid: 'session-1',
    });
    expect(navigationLocationKey(activeMobileDetailRoute(state)!)).toBe(
      'detail:chat-conversation:session-1',
    );

    state.popDetail();
    expect(useMobileNavigationStore.getState()).toMatchObject({
      primaryRouteId: 'tab:contacts',
      detailStack: [],
    });
  });

  it('clears detail routes when a primary tab replaces the location', () => {
    useMobileNavigationStore.getState().pushDetail({
      routeId: 'detail:group-conversation',
      groupUlid: 'group-1',
    });

    useMobileNavigationStore.getState().navigatePrimary('tab:moments');

    const state = useMobileNavigationStore.getState();
    expect(state.primaryRouteId).toBe('tab:moments');
    expect(state.detailStack).toEqual([]);
  });
});
