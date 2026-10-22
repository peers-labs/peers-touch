import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  xConfigProjection: vi.fn(),
  xConfigRefresh: vi.fn(),
  xConfigDiscoverSuggestion: vi.fn(),
}));

vi.mock('./desktop_api', () => ({
  api: apiMocks,
}));

import {
  discoverXConfigSuggestion,
  getXConfigProjection,
  loadXConfigProjection,
  refreshXConfigProjection,
  resetXConfigProjectionForTests,
  subscribeXConfigProjection,
} from './xConfig';

describe('Desktop X Config projection service', () => {
  beforeEach(() => {
    resetXConfigProjectionForTests();
    vi.clearAllMocks();
  });

  it('publishes local projection before a separately triggered refresh', async () => {
    apiMocks.xConfigProjection.mockResolvedValue({
      channel: 'stable',
      sequence: 3,
      freshness: 'embedded',
      suggestions: [],
      refreshing: false,
    });
    apiMocks.xConfigRefresh.mockResolvedValue({
      channel: 'stable',
      sequence: 4,
      freshness: 'current',
      suggestions: [{
        seed_id: 'relay-home',
        kind: 'relay',
        display_name: 'Home Relay',
        canonical_origin: 'https://relay.example',
        regions: ['global'],
        freshness: 'current',
        actionable: true,
        source_sequence: 4,
      }],
      refreshing: false,
    });
    const listener = vi.fn();
    const unsubscribe = subscribeXConfigProjection(listener);

    await loadXConfigProjection();
    expect(getXConfigProjection().freshness).toBe('embedded');
    await refreshXConfigProjection();
    expect(getXConfigProjection().sequence).toBe(4);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('deduplicates concurrent refresh and delegates suggestion discovery by seed id', async () => {
    let resolveRefresh!: (value: unknown) => void;
    apiMocks.xConfigRefresh.mockReturnValue(new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    const first = refreshXConfigProjection();
    const second = refreshXConfigProjection();
    expect(apiMocks.xConfigRefresh).toHaveBeenCalledOnce();
    resolveRefresh({
      channel: 'stable',
      freshness: 'unavailable',
      suggestions: [],
      refreshing: false,
    });
    await Promise.all([first, second]);

    apiMocks.xConfigDiscoverSuggestion.mockResolvedValue({
      role: 'relay',
      endpoint_peer_id: 'relay-peer',
      canonical_origin: 'https://relay.example',
      entries: [],
    });
    await discoverXConfigSuggestion('relay-home');
    expect(apiMocks.xConfigDiscoverSuggestion).toHaveBeenCalledWith('relay-home');
  });
});
