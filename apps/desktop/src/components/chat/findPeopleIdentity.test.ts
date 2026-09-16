import { describe, expect, it } from 'vitest';

import type { FederationResolveView } from '../../services/desktop_api';
import { resolvedProfileToSearchResult } from './findPeopleIdentity';

describe('Find People identity projection', () => {
  it('uses ActorRef PTID instead of the legacy profile URL identity', () => {
    const view = {
      federatedHandle: '@alice@station.example',
      homeStationPeerId: 'station-peer-id',
      homeStationDomain: 'station.example',
      fromCache: false,
      isLocal: true,
      locatorSeq: 74n,
      profile: {
        id: '/users/alice',
        username: 'alice',
        displayName: 'Alice',
        avatar: 'https://station.example/alice.png',
        peersTouch: {
          networkId: 'legacy-network-id-must-not-win',
        },
        ref: {
          ptid: 'ptid:alice',
        },
      },
    } as unknown as FederationResolveView;

    expect(resolvedProfileToSearchResult(view)).toMatchObject({
      id: 'ptid:alice',
      username: 'alice',
      federation: {
        handle: '@alice@station.example',
        homeStationDomain: 'station.example',
      },
    });
  });

  it('fails closed when the resolved profile has no canonical ActorRef', () => {
    const view = {
      federatedHandle: '@alice@station.example',
      homeStationPeerId: 'station-peer-id',
      homeStationDomain: 'station.example',
      fromCache: false,
      isLocal: true,
      locatorSeq: 74n,
      profile: {
        id: '/users/alice',
        username: 'alice',
        displayName: 'Alice',
        avatar: '',
        peersTouch: {
          networkId: 'ptid:legacy-alice',
        },
      },
    } as unknown as FederationResolveView;

    expect(resolvedProfileToSearchResult(view)).toBeNull();
  });
});
