import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { FederationResolveView } from '../../services/desktop_api';
import {
  findPeopleScopePresentation,
  friendRequestFederationId,
  localActorToSearchResult,
  mergeActorSearchResults,
  resolvedProfileToSearchResult,
} from './findPeopleIdentity';

describe('Find People identity projection', () => {
  it('presents the selected Federation context without Station topology', () => {
    expect(findPeopleScopePresentation('local', 'fed-local')).toEqual({
      name: 'local',
      labelKey: 'chat.social.findPeople.scopeFederationNamed',
      tooltipKey: 'chat.social.findPeople.scopeFederationTooltip',
    });
  });

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

  it('projects local Station actors without requiring catalog visibility', () => {
    expect(localActorToSearchResult({
      actorPtid: 'ptid:developer',
      username: 'developer',
      displayName: '小小先',
      avatar: '',
      homeStationPeerId: 'station-local',
    })).toEqual({
      id: 'ptid:developer',
      username: 'developer',
      displayName: '小小先',
      avatar: '',
      homeStationPeerId: 'station-local',
    });
  });

  it('merges local and Federation results by canonical Actor PTID', () => {
    const local = localActorToSearchResult({
      actorPtid: 'ptid:alice',
      username: 'alice',
      displayName: 'Alice local',
      avatar: '',
      homeStationPeerId: 'station-local',
    });
    const catalog = {
      id: 'ptid:alice',
      username: 'alice',
      displayName: 'Alice verified',
      avatar: '',
      homeStationPeerId: 'station-local',
      federation: {
        handle: '@alice@station.example',
        homeStationDomain: 'station.example',
        fromCache: false,
        isLocal: true,
        locatorSeq: 1,
      },
    };

    expect(mergeActorSearchResults(local ? [local] : [], [catalog])).toEqual([catalog]);
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

describe('same-Station friend request federation fallback (source contract)', () => {
  it('resolves a local federation context for same-Station targets in Find People', () => {
    // Multi-federation Stations have no single default, which previously left
    // same-Station actors blocked by the identity-incomplete guard. The modal
    // must gate the fallback on a Home Station match, never guess for
    // federated targets, and keep the empty-federation guard intact.
    const modalSource = readFileSync(new URL('./FindPeopleModal.tsx', import.meta.url), 'utf8');
    expect(modalSource).toContain('isSameStationActor');
    expect(modalSource).toContain('localFederationFallback(federations)');
    expect(modalSource).toMatch(/sameStation \? localFederationFallback\(federations\) : ''/);
    expect(modalSource).toContain('if (!federationId || !target.homeStationPeerId)');
  });

  it('applies the same guarded fallback from the profile card primary action', () => {
    const profileActionSource = readFileSync(
      new URL('../profile/ProfilePrimaryAction.tsx', import.meta.url),
      'utf8',
    );
    expect(profileActionSource).toContain('isSameStationActor');
    expect(profileActionSource).toContain('localFederationFallback(federations)');
    expect(profileActionSource).toMatch(/sameStation \? localFederationFallback\(federations\) : ''/);
  });
});
