import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { FederationResolveView } from '../../services/desktop_api';
import {
  findPeopleScopePresentation,
  friendRequestFederationId,
  localActorToSearchResult,
  mergeActorSearchResults,
  orderFederationOptions,
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

describe('Find People federation chip ordering', () => {
  const options = [
    { federationId: 'f-release-3', federationName: 'Release 0.0.1 32e51f6f' },
    { federationId: 'f-local', federationName: 'local' },
    { federationId: 'f-w8', federationName: 'Secure Content W8 Fixture' },
    { federationId: 'f-accept', federationName: 'chat-native-acceptance' },
  ];

  it('sorts by Latin alphabetical label when there is no recent context', () => {
    // chat- (c) < local (l) < release (r) < secure (s).
    expect(orderFederationOptions(options).map((o) => o.federationId)).toEqual([
      'f-accept',
      'f-local',
      'f-release-3',
      'f-w8',
    ]);
  });

  it('does not mutate the input array', () => {
    const snapshot = options.map((o) => o.federationId);
    orderFederationOptions(options);
    expect(options.map((o) => o.federationId)).toEqual(snapshot);
  });

  it('pins the most-recent federation first, keeping the rest alphabetical', () => {
    const ordered = orderFederationOptions(options, 'f-w8');
    expect(ordered.map((o) => o.federationId)).toEqual([
      'f-w8',
      'f-accept',
      'f-local',
      'f-release-3',
    ]);
  });

  it('ignores an unknown or blank recent id and stays alphabetical', () => {
    const alphabetical = ['f-accept', 'f-local', 'f-release-3', 'f-w8'];
    expect(orderFederationOptions(options, 'does-not-exist').map((o) => o.federationId))
      .toEqual(alphabetical);
    expect(orderFederationOptions(options, '  ').map((o) => o.federationId))
      .toEqual(alphabetical);
  });

  it('falls back to the id when the display name is empty', () => {
    const fallback = orderFederationOptions([
      { federationId: 'zebra-id', federationName: '' },
      { federationId: 'alpha-id', federationName: '' },
    ]);
    expect(fallback.map((o) => o.federationId)).toEqual(['alpha-id', 'zebra-id']);
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

describe('Find People all-scope fan-out and stable dialog geometry (source contract)', () => {
  const modalSource = readFileSync(new URL('./FindPeopleModal.tsx', import.meta.url), 'utf8');
  const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');

  it('fans the "all" scope out to every Federation catalog, not just local actors', () => {
    // Regression guard: with multiple federations there is no single default,
    // so "all" previously searched only actorSearchActors and missed the
    // catalog (where the local/self entries live). It must map every federation
    // option into a catalog search and merge the responses.
    expect(modalSource).toContain(
      "federationOptions.map((option) => option.federationId)",
    );
    expect(modalSource).toContain('catalogResponses.flatMap');
    expect(modalSource).toContain('anyCatalogResponse');
  });

  it('orders chips through the shared helper and persists the recent selection', () => {
    expect(modalSource).toContain('orderFederationOptions(');
    expect(modalSource).toContain('writeRecentFederationId(federationId)');
    expect(modalSource).toContain('readRecentFederationId()');
  });

  it('keeps scope chips on one collapsible row with a More toggle', () => {
    expect(modalSource).toContain('data-chat-find-people-scope-more');
    expect(modalSource).toContain('data-chat-find-people-scopes-expanded');
    const scopesRule = chatCss.match(/\.sc-find__scopes\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(scopesRule).toContain('flex-wrap: nowrap');
    expect(chatCss).toContain("data-chat-find-people-scopes-expanded='true'");
  });

  it('gives the result well a fixed height so the dialog never resizes with results', () => {
    const listRule = chatCss.match(/\.sc-find__list\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(listRule).toContain('height: 320px');
    expect(listRule).toContain('max-height: 320px');
    expect(listRule).toContain('overflow: auto');
  });
});
