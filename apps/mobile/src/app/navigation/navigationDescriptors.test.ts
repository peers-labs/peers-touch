// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  detailDescriptors,
  overlayDescriptors,
  primaryTabDescriptors,
} from './navigationDescriptors';
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
    expect(detailDescriptors).toHaveLength(5);
    expect(detailDescriptors.every((descriptor) => (
      descriptor.layout === 'detail' && descriptor.keepAlive === false
    ))).toBe(true);
    expect(overlayDescriptors).toHaveLength(2);
    expect(overlayDescriptors.every((descriptor) => (
      descriptor.layout === 'overlay' && descriptor.keepAlive === false
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
    useMobileNavigationStore.getState().openOverlay({
      routeId: 'overlay:add-friend',
    });

    useMobileNavigationStore.getState().navigatePrimary('tab:moments');

    const state = useMobileNavigationStore.getState();
    expect(state.primaryRouteId).toBe('tab:moments');
    expect(state.detailStack).toEqual([]);
    expect(state.overlayRoute).toBeNull();
  });

  it('owns contact, moment, and setting details by stable route identity', () => {
    const navigation = useMobileNavigationStore.getState();
    navigation.pushDetail({
      routeId: 'detail:contact-profile',
      actorPtid: 'ptid:contact-1',
    });
    navigation.pushDetail({
      routeId: 'detail:moment',
      postId: 'post-1',
    });
    navigation.pushDetail({
      routeId: 'detail:setting',
      settingId: 'privacy-security',
    });
    navigation.pushDetail({
      routeId: 'detail:moment',
      postId: 'post-1',
    });

    const state = useMobileNavigationStore.getState();
    expect(state.detailStack.map(navigationLocationKey)).toEqual([
      'detail:contact-profile:ptid:contact-1',
      'detail:setting:privacy-security',
      'detail:moment:post-1',
    ]);

    state.popDetail();
    expect(activeMobileDetailRoute(useMobileNavigationStore.getState())).toEqual({
      routeId: 'detail:setting',
      settingId: 'privacy-security',
    });
  });

  it('owns one selected-only overlay and clears it before detail navigation', () => {
    const navigation = useMobileNavigationStore.getState();
    navigation.openOverlay({ routeId: 'overlay:add-friend' });
    expect(useMobileNavigationStore.getState().overlayRoute).toEqual({
      routeId: 'overlay:add-friend',
    });

    useMobileNavigationStore.getState().openOverlay({
      routeId: 'overlay:create-group',
    });
    expect(useMobileNavigationStore.getState().overlayRoute).toEqual({
      routeId: 'overlay:create-group',
    });

    useMobileNavigationStore.getState().pushDetail({
      routeId: 'detail:contact-profile',
      actorPtid: 'ptid:contact-2',
    });
    expect(useMobileNavigationStore.getState().overlayRoute).toBeNull();

    useMobileNavigationStore.getState().openOverlay({
      routeId: 'overlay:add-friend',
    });
    useMobileNavigationStore.getState().closeOverlay();
    expect(useMobileNavigationStore.getState().overlayRoute).toBeNull();
    expect(activeMobileDetailRoute(useMobileNavigationStore.getState())).toEqual({
      routeId: 'detail:contact-profile',
      actorPtid: 'ptid:contact-2',
    });
  });

  it('resets primary, detail, and overlay navigation atomically', () => {
    const navigation = useMobileNavigationStore.getState();
    navigation.navigatePrimary('tab:settings');
    navigation.pushDetail({
      routeId: 'detail:setting',
      settingId: 'notifications',
    });
    useMobileNavigationStore.getState().openOverlay({
      routeId: 'overlay:add-friend',
    });

    useMobileNavigationStore.getState().reset();

    expect(useMobileNavigationStore.getState()).toMatchObject({
      primaryRouteId: 'tab:chat',
      detailStack: [],
      overlayRoute: null,
    });
  });
});
