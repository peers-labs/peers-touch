import { describe, expect, it } from 'vitest';

import type { FederationResolveView } from '../../services/desktop_api';
import {
  friendRequestFederationId,
  resolvedProfileToSearchResult,
} from './findPeopleIdentity';

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

  it('reuses the unique relationship federation for a rejected-request retry', () => {
    expect(friendRequestFederationId([
      {
        senderPtid: 'ptid:bob',
        receiverPtid: 'ptid:alice',
        federationId: 'federation-shared',
      },
      {
        senderPtid: 'ptid:bob',
        receiverPtid: 'ptid:alice',
        federationId: 'federation-shared',
      },
      {
        senderPtid: 'ptid:unrelated',
        receiverPtid: 'ptid:alice',
        federationId: 'federation-other',
      },
    ], 'ptid:bob', 'ptid:alice')).toBe('federation-shared');
  });

  it('does not guess when relationship history spans multiple federations', () => {
    expect(friendRequestFederationId([
      {
        senderPtid: 'ptid:bob',
        receiverPtid: 'ptid:alice',
        federationId: 'federation-a',
      },
      {
        senderPtid: 'ptid:alice',
        receiverPtid: 'ptid:bob',
        federationId: 'federation-b',
      },
    ], 'ptid:bob', 'ptid:alice')).toBe('');
  });
});
