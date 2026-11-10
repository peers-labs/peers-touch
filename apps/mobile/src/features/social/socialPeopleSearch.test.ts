import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MobileAuthSession } from '../auth/authSession';
import {
  createProfileGateway,
  type ProfileGateway,
} from '../../services/gateways/profileGateway';
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

  it('fails closed when Federation context is missing', async () => {
    await useSocialStore.getState().searchPeople('bob', '');
    expect(useSocialStore.getState().peopleSearchResults).toEqual([]);
    expect(useSocialStore.getState().peopleSearchError?.context.code)
      .toBe('FEDERATION_CONTEXT_REQUIRED');
  });

  it('keeps an unavailable runtime error inside the search projection', async () => {
    useSocialStore.setState({ profileGateway: null });
    await expect(useSocialStore.getState().searchPeople('bob', 'fed-1')).resolves.toBeUndefined();
    expect(useSocialStore.getState().peopleSearchLoading).toBe(false);
    expect(useSocialStore.getState().peopleSearchError?.context.message)
      .toBe('mobile.social.runtimeUnavailable');
  });

  it('searches only within the explicit Federation context', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(catalogResponse('bob'));
    vi.stubGlobal('fetch', fetchMock);

    await useSocialStore.getState().searchPeople('bob', 'fed-1');

    expect(useSocialStore.getState()).toMatchObject({
      peopleSearchResults: [{ ptid: 'ptid:bob' }],
      peopleSearchError: null,
      peopleSearchLoading: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not publish results after the search overlay is cleared', async () => {
    const response = deferredResponse();
    const fetchMock = vi.fn().mockReturnValueOnce(response.promise);
    vi.stubGlobal('fetch', fetchMock);
    const pending = useSocialStore.getState().searchPeople('bob', 'fed-1');
    useSocialStore.getState().clearPeopleSearch();
    response.resolve(catalogResponse('bob'));
    await pending;
    expect(useSocialStore.getState().peopleSearchResults).toEqual([]);
  });

  it('does not publish results into a replacement account scope', async () => {
    const response = deferredResponse();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(response.promise));
    const pending = useSocialStore.getState().searchPeople('bob', 'fed-1');
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
    const earlier = useSocialStore.getState().searchPeople('bob', 'fed-1');
    await useSocialStore.getState().searchPeople('carol', 'fed-1');
    first.resolve(catalogResponse('bob'));
    await earlier;
    expect(useSocialStore.getState().peopleSearchResults[0]?.ptid).toBe('ptid:carol');
  });
});

const activeFederation = {
  federationId: 'fed-1',
  name: 'Federation One',
  status: 'active',
};

function gatewayWithFederationRead(
  read: ProfileGateway['listFederationContexts'],
): ProfileGateway {
  const gateway = createProfileGateway(session);
  vi.spyOn(gateway, 'listFederationContexts').mockImplementation(read);
  return gateway;
}

describe('Social Federation context refresh resilience', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSocialStore.setState({ profileGateway: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    useSocialStore.setState({
      peopleSearchFederations: [],
      peopleSearchFederationsError: null,
      profileGateway: null,
    });
  });

  it('retries an ok-but-empty directory until the Federation becomes visible', async () => {
    const gateway = gatewayWithFederationRead(
      vi.fn()
        .mockResolvedValueOnce({ ok: true, data: [] })
        .mockResolvedValue({ ok: true, data: [activeFederation] }),
    );
    useSocialStore.setState({ profileGateway: gateway });

    const refresh = useSocialStore.getState().refreshFederationContexts();
    await vi.advanceTimersByTimeAsync(500);
    await refresh;

    expect(gateway.listFederationContexts).toHaveBeenCalledTimes(2);
    expect(useSocialStore.getState().peopleSearchFederations)
      .toEqual([activeFederation]);
    expect(useSocialStore.getState().peopleSearchFederationsError).toBeNull();
  });

  it('commits an empty directory without an error after the bounded budget is exhausted', async () => {
    const gateway = gatewayWithFederationRead(
      vi.fn().mockResolvedValue({ ok: true, data: [] }),
    );
    useSocialStore.setState({ profileGateway: gateway });

    const refresh = useSocialStore.getState().refreshFederationContexts();
    await vi.advanceTimersByTimeAsync(2_000);
    await refresh;

    expect(gateway.listFederationContexts).toHaveBeenCalledTimes(5);
    expect(useSocialStore.getState().peopleSearchFederations).toEqual([]);
    expect(useSocialStore.getState().peopleSearchFederationsError).toBeNull();
  });

  it('fails closed on the first hard error without retrying', async () => {
    const gateway = gatewayWithFederationRead(
      vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'GATEWAY_ERROR',
          message: 'mobile.contacts.federationsFailed',
          method: 'GET',
          path: '/sub-federation/federations',
        },
      }),
    );
    useSocialStore.setState({ profileGateway: gateway });

    await useSocialStore.getState().refreshFederationContexts();

    expect(gateway.listFederationContexts).toHaveBeenCalledTimes(1);
    expect(useSocialStore.getState().peopleSearchFederations).toEqual([]);
    expect(useSocialStore.getState().peopleSearchFederationsError).not.toBeNull();
  });

  it('re-reads under the replacement gateway when the session scope changes mid-flight', async () => {
    const replacement = gatewayWithFederationRead(
      vi.fn().mockResolvedValue({ ok: true, data: [activeFederation] }),
    );
    const initial = gatewayWithFederationRead(
      vi.fn().mockImplementation(async () => {
        useSocialStore.setState({ profileGateway: replacement });
        return { ok: true, data: [] };
      }),
    );
    useSocialStore.setState({ profileGateway: initial });

    await useSocialStore.getState().refreshFederationContexts();

    expect(initial.listFederationContexts).toHaveBeenCalledTimes(1);
    expect(replacement.listFederationContexts).toHaveBeenCalledTimes(1);
    expect(useSocialStore.getState().profileGateway).toBe(replacement);
    expect(useSocialStore.getState().peopleSearchFederations)
      .toEqual([activeFederation]);
  });
});
