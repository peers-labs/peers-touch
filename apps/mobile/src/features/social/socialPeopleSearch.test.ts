import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MobileAuthSession } from '../auth/authSession';
import { createProfileGateway } from '../../services/gateways/profileGateway';
import { useSocialStore } from './socialStore';

vi.mock('../../services/stationTransport', () => ({
  executeStationOperation: async (
    _session: unknown,
    operation: Record<string, unknown>,
  ) => {
    const path = operation.operationId === 'actor_search'
      ? `/api/v1/social/users/search?q=${encodeURIComponent(String(operation.query))}`
      : '/sub-federation/federations';
    const response = await fetch(`https://station.example${path}`);
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
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};

function actorResponse(username: string): Response {
  return Response.json({
    items: [{
      username,
      home_station_peer_id: 'station-a',
      federated_handle: `@${username}@station.example`,
      ref: { ptid: `ptid:${username}` },
    }],
    total: '1',
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

  it('keeps an unavailable runtime error inside the search projection', async () => {
    useSocialStore.setState({ profileGateway: null });
    await expect(useSocialStore.getState().searchPeople('bob')).resolves.toBeUndefined();
    expect(useSocialStore.getState().peopleSearchLoading).toBe(false);
    expect(useSocialStore.getState().peopleSearchError?.context.message)
      .toBe('mobile.social.runtimeUnavailable');
  });

  it('preserves valid people when no Federation membership exists', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(actorResponse('bob'))
      .mockResolvedValueOnce(Response.json({ federations: [] })));

    await useSocialStore.getState().searchPeople('bob');

    expect(useSocialStore.getState()).toMatchObject({
      peopleSearchResults: [{ ptid: 'ptid:bob' }],
      peopleSearchFederations: [],
      peopleSearchFederationsError: null,
      peopleSearchError: null,
      peopleSearchLoading: false,
    });
    expect(useSocialStore.getState().peopleSearchResults[0]).not.toHaveProperty('federationId');
  });

  it('keeps Federation failure distinct from an empty actor search', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(actorResponse('bob'))
      .mockResolvedValueOnce(Response.json({ message: 'unavailable' }, { status: 503 })));

    await useSocialStore.getState().searchPeople('bob');

    expect(useSocialStore.getState().peopleSearchResults).toHaveLength(1);
    expect(useSocialStore.getState().peopleSearchError).toBeNull();
    expect(useSocialStore.getState().peopleSearchFederationsError?.context.status).toBe(503);
  });

  it('does not publish results after the search overlay is cleared', async () => {
    const response = deferredResponse();
    const fetchMock = vi.fn().mockReturnValueOnce(response.promise);
    vi.stubGlobal('fetch', fetchMock);
    const pending = useSocialStore.getState().searchPeople('bob');
    useSocialStore.getState().clearPeopleSearch();
    response.resolve(actorResponse('bob'));
    await pending;
    expect(useSocialStore.getState().peopleSearchResults).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not publish results into a replacement account scope', async () => {
    const response = deferredResponse();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(response.promise));
    const pending = useSocialStore.getState().searchPeople('bob');
    useSocialStore.setState({ profileGateway: createProfileGateway({ ...session, stationPeerId: 'station-b' }) });
    response.resolve(actorResponse('bob'));
    await pending;
    expect(useSocialStore.getState().peopleSearchResults).toEqual([]);
  });

  it('keeps newer search results when an earlier search finishes last', async () => {
    const first = deferredResponse();
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(actorResponse('carol'))
      .mockResolvedValueOnce(Response.json({ federations: [] })));
    const earlier = useSocialStore.getState().searchPeople('bob');
    await useSocialStore.getState().searchPeople('carol');
    first.resolve(actorResponse('bob'));
    await earlier;
    expect(useSocialStore.getState().peopleSearchResults[0]?.ptid).toBe('ptid:carol');
  });
});
