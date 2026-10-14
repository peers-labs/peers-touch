import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AccountProfile,
  FederationCatalogEntry,
} from '../services/desktop_api';

const mocks = vi.hoisted(() => ({
  federationCatalogSearch: vi.fn(),
  federationListContexts: vi.fn(),
  profileGet: vi.fn(),
  profileUpdate: vi.fn(),
}));
const session = vi.hoisted(() => ({
  actorPtid: 'ptid:alice' as string | null,
  sessionEpoch: 1,
}));

vi.mock('../services/desktop_api', () => ({
  api: {
    federationCatalogSearch: mocks.federationCatalogSearch,
    federationListContexts: mocks.federationListContexts,
    profileGet: mocks.profileGet,
    profileUpdate: mocks.profileUpdate,
  },
}));

vi.mock('./session', () => ({
  currentAuthenticatedActorPtid: () => session.actorPtid,
  useSessionStore: {
    getState: () => ({
      sessionEpoch: session.sessionEpoch,
    }),
  },
}));

import { resolveFederationStationName, useFederationStore } from './federation';

describe('federation actor Station directory', () => {
  beforeEach(() => {
    mocks.federationCatalogSearch.mockReset();
    mocks.federationListContexts.mockReset();
    mocks.profileGet.mockReset();
    mocks.profileUpdate.mockReset();
    session.actorPtid = 'ptid:alice';
    session.sessionEpoch = 1;
    useFederationStore.getState().clearSession();
    useFederationStore.setState({
      self: null,
      loading: false,
      lastError: null,
      federations: [],
      actorStationEntries: {},
    });
  });

  it('loads only the context projection exposed to ordinary clients', async () => {
    mocks.federationListContexts.mockResolvedValue({
      contexts: [{
        federationId: 'federation-1',
        name: 'Development',
        status: 'active',
      }],
    });

    await useFederationStore.getState().refreshFederationContexts();

    expect(useFederationStore.getState().federations).toEqual([{
      federationId: 'federation-1',
      name: 'Development',
      status: 'active',
    }]);
  });

  it('retains the authoritative Station name from the matching actor row', async () => {
    mocks.federationCatalogSearch.mockResolvedValue({
      entries: [
        {
          actorPtid: 'ptid:other',
          homeStationPeerId: 'station-other',
          homeStationName: 'Other Station',
        },
        {
          actorPtid: 'ptid:bob',
          homeStationPeerId: 'station-bob',
          homeStationName: 'Aspen Station',
        },
      ],
    });

    await useFederationStore.getState().resolveActorStations([{
      actorPtid: 'ptid:bob',
      federationId: 'federation-1',
      username: 'bob',
    }]);

    expect(mocks.federationCatalogSearch).toHaveBeenCalledWith({
      federation_id: 'federation-1',
      prefix: 'bob',
      page_size: 20,
    });
    expect(useFederationStore.getState().actorStationEntries['ptid:bob'])
      .toMatchObject({
        homeStationPeerId: 'station-bob',
        homeStationName: 'Aspen Station',
      });
  });

  it('does not issue a second lookup after the actor Station is known', async () => {
    useFederationStore.getState().rememberCatalogEntries([{
      actorPtid: 'ptid:bob',
      homeStationPeerId: 'station-bob',
      homeStationName: 'Aspen Station',
    } as FederationCatalogEntry]);

    await useFederationStore.getState().resolveActorStations([{
      actorPtid: 'ptid:bob',
      federationId: 'federation-1',
      username: 'bob',
    }]);

    expect(mocks.federationCatalogSearch).not.toHaveBeenCalled();
  });

  it('resolves a human-readable authority Station only from the actor catalog row', () => {
    expect(resolveFederationStationName({
      actorPtid: 'ptid:bob',
      stationPeerId: 'station-bob',
      actorStationEntries: {
        'ptid:bob': {
          actorPtid: 'ptid:bob',
          homeStationPeerId: 'station-bob',
          homeStationName: 'Aspen Station',
        } as FederationCatalogEntry,
      },
    })).toBe('Aspen Station');

    expect(resolveFederationStationName({
      stationPeerId: 'station-unknown',
      actorStationEntries: {},
    })).toBe('');
  });

  it('retries a contact-policy mutation against the authoritative conflict snapshot', async () => {
    const initial = accountProfile({
      profile_revision: 4,
      contact_policy: 'anyone',
    });
    const conflict = accountProfile({
      profile_revision: 5,
      contact_policy: 'anyone',
    });
    const applied = accountProfile({
      profile_revision: 6,
      contact_policy: 'federations',
    });
    useFederationStore.setState({ self: initial });
    mocks.profileUpdate
      .mockResolvedValueOnce({
        outcome: 'PROFILE_UPDATE_OUTCOME_CONFLICT',
        profile: conflict,
      })
      .mockResolvedValueOnce({
        outcome: 'PROFILE_UPDATE_OUTCOME_APPLIED',
        profile: applied,
      });

    await useFederationStore.getState().setContactPolicy('federations');

    expect(mocks.profileUpdate).toHaveBeenNthCalledWith(1, {
      contact_policy: 'federations',
      observed_revision: 4,
    });
    expect(mocks.profileUpdate).toHaveBeenNthCalledWith(2, {
      contact_policy: 'federations',
      observed_revision: 5,
    });
    expect(useFederationStore.getState().self).toBe(applied);
  });

  it('writes a complete scoped snapshot and promotes global visibility atomically', async () => {
    const initial = accountProfile({
      profile_revision: 9,
      discoverability: 'by_handle',
      federation_visibility: {
        'federation-existing': 'hidden',
      },
    });
    const applied = accountProfile({
      profile_revision: 10,
      discoverability: 'indexed',
      federation_visibility: {
        'federation-existing': 'hidden',
        'federation-target': 'indexed',
      },
    });
    useFederationStore.setState({ self: initial });
    mocks.profileUpdate.mockResolvedValue({
      outcome: 'PROFILE_UPDATE_OUTCOME_APPLIED',
      profile: applied,
    });

    await useFederationStore.getState().setFederationVisibility(
      'federation-target',
      'indexed',
    );

    expect(mocks.profileUpdate).toHaveBeenCalledWith({
      discoverability: 'indexed',
      federation_visibility: {
        'federation-existing': 'hidden',
        'federation-target': 'indexed',
      },
      observed_revision: 9,
    });
    expect(useFederationStore.getState().self).toBe(applied);
  });

  it('serializes profile controls against the latest authoritative revision', async () => {
    const initial = accountProfile({ profile_revision: 20 });
    const visibilityApplied = accountProfile({
      profile_revision: 21,
      discoverability: 'indexed',
    });
    const policyApplied = accountProfile({
      profile_revision: 22,
      discoverability: 'indexed',
      contact_policy: 'federations',
    });
    let resolveVisibility!: (result: {
      outcome: 'PROFILE_UPDATE_OUTCOME_APPLIED';
      profile: AccountProfile;
    }) => void;
    mocks.profileUpdate
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveVisibility = resolve;
      }))
      .mockResolvedValueOnce({
        outcome: 'PROFILE_UPDATE_OUTCOME_APPLIED',
        profile: policyApplied,
      });
    useFederationStore.setState({ self: initial });

    const visibility = useFederationStore.getState().setVisibility('indexed');
    const policy = useFederationStore.getState().setContactPolicy('federations');
    await Promise.resolve();
    expect(mocks.profileUpdate).toHaveBeenCalledTimes(1);

    resolveVisibility({
      outcome: 'PROFILE_UPDATE_OUTCOME_APPLIED',
      profile: visibilityApplied,
    });
    await Promise.all([visibility, policy]);

    expect(mocks.profileUpdate).toHaveBeenNthCalledWith(2, {
      contact_policy: 'federations',
      observed_revision: 21,
    });
    expect(useFederationStore.getState().self).toBe(policyApplied);
  });

  it('invalidates in-flight and queued profile work on actor switch', async () => {
    const actorA = accountProfile({ profile_revision: 30 });
    const actorAResult = accountProfile({
      profile_revision: 31,
      discoverability: 'indexed',
    });
    const actorB = accountProfile({
      id: 'ptid:bob',
      username: 'bob',
      profile_revision: 4,
      peers_touch: { network_id: 'ptid:bob' },
    });
    let resolveActorA!: (result: {
      outcome: 'PROFILE_UPDATE_OUTCOME_APPLIED';
      profile: AccountProfile;
    }) => void;
    mocks.profileUpdate.mockReturnValueOnce(new Promise((resolve) => {
      resolveActorA = resolve;
    }));
    useFederationStore.setState({ self: actorA });

    const inFlight = useFederationStore.getState().setVisibility('indexed');
    const queued = useFederationStore.getState().setContactPolicy('nobody');
    await Promise.resolve();
    useFederationStore.getState().clearSession();
    useFederationStore.setState({ self: actorB });
    resolveActorA({
      outcome: 'PROFILE_UPDATE_OUTCOME_APPLIED',
      profile: actorAResult,
    });
    await Promise.all([inFlight, queued]);

    expect(mocks.profileUpdate).toHaveBeenCalledTimes(1);
    expect(useFederationStore.getState().self).toBe(actorB);
  });

  it('drops in-flight profile reads after the same actor starts a new session', async () => {
    const current = accountProfile({ profile_revision: 40 });
    const stale = accountProfile({
      profile_revision: 41,
      display_name: 'Stale Alice',
    });
    let resolveProfile!: (profile: AccountProfile) => void;
    mocks.profileGet.mockReturnValueOnce(new Promise((resolve) => {
      resolveProfile = resolve;
    }));
    useFederationStore.setState({ self: current });

    const refresh = useFederationStore.getState().refreshSelf();
    session.sessionEpoch += 1;
    resolveProfile(stale);
    await refresh;

    expect(useFederationStore.getState().self).toBe(current);
  });

  it('does not run queued profile mutations in a replacement session', async () => {
    const initial = accountProfile({ profile_revision: 50 });
    const staleResult = accountProfile({
      profile_revision: 51,
      discoverability: 'indexed',
    });
    let resolveFirst!: (result: {
      outcome: 'PROFILE_UPDATE_OUTCOME_APPLIED';
      profile: AccountProfile;
    }) => void;
    mocks.profileUpdate.mockReturnValueOnce(new Promise((resolve) => {
      resolveFirst = resolve;
    }));
    useFederationStore.setState({ self: initial });

    const first = useFederationStore.getState().setVisibility('indexed');
    const queued = useFederationStore.getState().setContactPolicy('nobody');
    await Promise.resolve();
    session.sessionEpoch += 1;
    resolveFirst({
      outcome: 'PROFILE_UPDATE_OUTCOME_APPLIED',
      profile: staleResult,
    });
    await Promise.all([first, queued]);

    expect(mocks.profileUpdate).toHaveBeenCalledTimes(1);
    expect(useFederationStore.getState().self).toBe(initial);
  });
});

function accountProfile(
  overrides: Partial<AccountProfile> = {},
): AccountProfile {
  return {
    id: 'ptid:alice',
    profile_revision: 1,
    username: 'alice',
    acct: 'alice@station.test',
    display_name: 'Alice',
    note: '',
    url: '',
    avatar: '',
    header: '',
    locked: false,
    created_at: '',
    statuses_count: 0,
    following_count: 0,
    followers_count: 0,
    region: '',
    timezone: '',
    tags: [],
    links: [],
    default_visibility: 'public',
    manually_approves_followers: false,
    contact_policy: 'anyone',
    federation_visibility: {},
    auto_expire_days: 0,
    federated_handle: '@alice@station.test',
    home_station_peer_id: 'station-peer',
    home_station_domain: 'station.test',
    discoverability: 'by_handle',
    peers_touch: { network_id: 'ptid:alice' },
    ...overrides,
  };
}
