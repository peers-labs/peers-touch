// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { afterEach, describe, expect, it } from 'vitest';

import {
  CHAT_SURFACE_FIXTURE_IDS,
  chatSurfaceFixtureRouteKind,
  isChatSurfaceFixtureId,
  setChatSurfaceFixture,
} from './chatSurfaceFixture';

describe('Chat surface fixture', () => {
  afterEach(() => {
    setChatSurfaceFixture(null);
  });

  it('accepts exactly the whole-product Chat inventory IDs', () => {
    expect(CHAT_SURFACE_FIXTURE_IDS).toHaveLength(37);
    expect(isChatSurfaceFixtureId('chat.message-actions')).toBe(true);
    expect(isChatSurfaceFixtureId('chat.list-refreshing')).toBe(true);
    expect(isChatSurfaceFixtureId('chat.pinned-messages')).toBe(true);
    expect(isChatSurfaceFixtureId('chat.not-real')).toBe(false);
  });

  it('maps list, direct, and group surfaces to production navigation kinds', () => {
    expect(chatSurfaceFixtureRouteKind('chat.list-empty')).toBe('list');
    expect(chatSurfaceFixtureRouteKind('chat.direct-thread')).toBe('direct');
    expect(chatSurfaceFixtureRouteKind('chat.group-management')).toBe('group');
  });

  it('publishes and clears one selected fixture surface', () => {
    expect(setChatSurfaceFixture('chat.message-pending')).toMatchObject({
      surfaceId: 'chat.message-pending',
    });
    expect(setChatSurfaceFixture(null)).toMatchObject({
      surfaceId: null,
    });
  });
});
