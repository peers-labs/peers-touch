import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MobileAuthSession } from '../auth/authSession';
import { createProfileGateway } from '../../services/gateways/profileGateway';
import { useSocialStore } from './socialStore';

vi.mock('../../services/stationTransport', () => ({
  executeStationOperation: async (
    _session: unknown,
    operation: Record<string, unknown>,
  ) => {
    const response = await fetch(`https://station.example/${String(operation.operationId)}`);
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      bodyBytes: Array.from(new Uint8Array(await response.arrayBuffer())),
    };
  },
  responseJson: (response: { bodyBytes: number[] }) =>
    JSON.parse(new TextDecoder().decode(Uint8Array.from(response.bodyBytes))),
}));

const session: MobileAuthSession = {
  stationPeerId: 'station-a',
  stationUrl: 'https://station.example',
  sessionId: 'session-a',
  deviceId: 'device-a',
  lifecycleGeneration: 1,
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};

function catalogResponse(username: string): Response {
  return Response.json({
    entries: [{
      actor_ptid: `ptid:${username}`,
      federated_handle: `@${username}@station.example`,
      display_name: username,
      home_station_peer_id: 'station-a',
      home_station_name: 'Station A',
      visibility: 'indexed',
    }],
  });
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((accept) => { resolve = accept; });
  return { promise, resolve };
}

describe('Social people search projection', () => {
  beforeEach(() => {
    useSocialStore.getState().clearPeopleSearch();
    useSocialStore.setState({ profileGateway: createProfileGateway(session) });
  });

  afterEach(() => {
    useSocialStore.getState().clearPeopleSearch();
    useSocialStore.setState({ profileGateway: null });
    vi.unstubAllGlobals();
  });

  it('rejects an explicitly selected Federation with a missing identity', async () => {
    await useSocialStore.getState().searchPeople('bob', { kind: 'federation', federationId: '' });
    expect(useSocialStore.getState().peopleSearchResults).toEqual([]);
    expect(useSocialStore.getState().peopleSearchError?.context.code)
      .toBe('FEDERATION_CONTEXT_REQUIRED');
  });

  it('finds Station actors without a Federation and preserves canonical identities', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({
      items: [{ ref: { ptid: 'ptid:bob' }, username: 'bob', display_name: 'Bob', home_station_peer_id: 'station-a' }],
      total: '1',
    }));
    vi.stubGlobal('fetch', fetchMock);
    useSocialStore.setState({ peopleSearchFederations: [] });
    await useSocialStore.getState().searchPeople(' @bob ', { kind: 'station' });
    expect(useSocialStore.getState()).toMatchObject({
      peopleSearchResults: [{ ptid: 'ptid:bob', homeStationPeerId: 'station-a', displayName: 'Bob' }],
      peopleSearchError: null, peopleSearchLoading: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not silently expand a full remote handle from Station scope', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await useSocialStore.getState().searchPeople('@bob@remote.example', { kind: 'station' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useSocialStore.getState().peopleSearchError?.context.code).toBe('FEDERATION_CONTEXT_REQUIRED');
  });

  it('keeps an unavailable runtime error inside the search projection', async () => {
    useSocialStore.setState({ profileGateway: null });
    await expect(useSocialStore.getState().searchPeople('bob', { kind: 'federation', federationId: 'fed-1' })).resolves.toBeUndefined();
    expect(useSocialStore.getState().peopleSearchLoading).toBe(false);
    expect(useSocialStore.getState().peopleSearchError?.context.message)
      .toBe('mobile.social.runtimeUnavailable');
  });

  it('searches only within the explicit Federation context', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(catalogResponse('bob'));
    vi.stubGlobal('fetch', fetchMock);

    await useSocialStore.getState().searchPeople('bob', { kind: 'federation', federationId: 'fed-1' });

    expect(useSocialStore.getState()).toMatchObject({
      peopleSearchResults: [{ ptid: 'ptid:bob' }],
      peopleSearchError: null,
      peopleSearchLoading: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not publish results after the search page is cleared', async () => {
    const response = deferredResponse();
    const fetchMock = vi.fn().mockReturnValueOnce(response.promise);
    vi.stubGlobal('fetch', fetchMock);
    const pending = useSocialStore.getState().searchPeople('bob', { kind: 'federation', federationId: 'fed-1' });
    useSocialStore.getState().clearPeopleSearch();
    response.resolve(catalogResponse('bob'));
    await pending;
    expect(useSocialStore.getState().peopleSearchResults).toEqual([]);
  });

  it('does not publish results into a replacement account scope', async () => {
    const response = deferredResponse();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(response.promise));
    const pending = useSocialStore.getState().searchPeople('bob', { kind: 'federation', federationId: 'fed-1' });
    useSocialStore.setState({ profileGateway: createProfileGateway({ ...session, stationPeerId: 'station-b' }) });
    response.resolve(catalogResponse('bob'));
    await pending;
    expect(useSocialStore.getState().peopleSearchResults).toEqual([]);
  });

  it('keeps newer scoped search results when an earlier search finishes last', async () => {
    const first = deferredResponse();
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(catalogResponse('carol')));
    const earlier = useSocialStore.getState().searchPeople('bob', { kind: 'federation', federationId: 'fed-1' });
    await useSocialStore.getState().searchPeople('carol', { kind: 'federation', federationId: 'fed-1' });
    first.resolve(catalogResponse('bob'));
    await earlier;
    expect(useSocialStore.getState().peopleSearchResults[0]?.ptid).toBe('ptid:carol');
  });

  it('invalidates a prior reply when a newly selected scope has invalid identity', async () => {
    const first = deferredResponse();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first.promise));
    const earlier = useSocialStore.getState().searchPeople('bob', { kind: 'federation', federationId: 'fed-1' });
    await useSocialStore.getState().searchPeople('bob', { kind: 'federation', federationId: '' });
    first.resolve(catalogResponse('bob'));
    await earlier;
    expect(useSocialStore.getState().peopleSearchResults).toEqual([]);
    expect(useSocialStore.getState().peopleSearchError?.context.code).toBe('FEDERATION_CONTEXT_REQUIRED');
  });

  it('keeps Station results when an earlier Federation reply finishes last', async () => {
    const first = deferredResponse();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(Response.json({
        items: [{ ref: { ptid: 'ptid:carol' }, username: 'carol' }], total: '1',
      })));
    const earlier = useSocialStore.getState().searchPeople('bob', { kind: 'federation', federationId: 'fed-1' });
    await useSocialStore.getState().searchPeople('carol', { kind: 'station' });
    first.resolve(catalogResponse('bob'));
    await earlier;
    expect(useSocialStore.getState().peopleSearchResults[0]?.ptid).toBe('ptid:carol');
  });
});
