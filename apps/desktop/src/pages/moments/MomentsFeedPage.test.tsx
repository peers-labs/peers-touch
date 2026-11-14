// @vitest-environment jsdom
import { create } from '@bufbuild/protobuf';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UIProvider } from '@peers-touch/ui';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Audience_Kind, PostSchema } from '../../gen/proto/domain/social/post_pb';
import { MomentsFeedView } from './MomentsFeedPage';

const fixtures = vi.hoisted(() => ({
  moments: {} as Record<string, unknown>,
  privateMoments: {} as Record<string, unknown>,
  social: {} as Record<string, unknown>,
  federation: {} as Record<string, unknown>,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../components/moments/useActiveMomentsStore', () => ({
  useActiveMomentsSlice: (select: (state: unknown) => unknown) => select(fixtures.moments),
  useActivePrivateMomentsSlice: (select: (state: unknown) => unknown) => select(fixtures.privateMoments),
  useActiveSocialChatSlice: (select: (state: unknown) => unknown) => select(fixtures.social),
  useActiveMomentsFederationSlice: (select: (state: unknown) => unknown) => select(fixtures.federation),
  useActiveRelationshipsSlice: (select: (state: unknown) => unknown) => select({
    blockedActors: {}, blockedActorsLoadedAt: 1, blockedActorsError: '',
  }),
}));
vi.mock('../../components/moments/MomentCard', () => ({
  MomentCard: ({ post }: { post: { id: string } }) => <div data-post-id={post.id} />,
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({
    matches: false, addEventListener: () => {}, removeEventListener: () => {},
  }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const post = create(PostSchema, {
    id: 'private-post', authorPtid: 'ptid:bob', audience: { kind: Audience_Kind.FRIENDS },
    author: { id: 'ptid:bob', displayName: 'Stale author', homeStationDomain: 'old.example' },
  });
  const feed = { postIds: [post.id], loading: false, hasMore: false };
  fixtures.moments = {
    feeds: { home: feed, explore: { ...feed, postIds: [] } },
    postsById: { [post.id]: post }, reactions: {}, feedExplanations: {}, timelineSort: 'recent',
  };
  fixtures.privateMoments = { postsById: {
    [post.id]: {
      postId: post.id, authorPtid: post.authorPtid, audienceKind: 'FRIENDS',
      state: 'CONTENT_READY', content: { kind: 'TEXT', text: 'Authorized body' },
    },
  } };
  fixtures.social = { currentUserPtid: 'ptid:alice', currentUserProfile: null, peerProfiles: {} };
  fixtures.federation = { self: null, actorStationEntries: {} };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(query: string) {
  await act(async () => root.render(<UIProvider><MomentsFeedView query={query}
    viewerActorPtid="ptid:alice" scrollRef={{ current: null }}
    onOpenPost={() => {}} onAuthorClick={() => {}}
  /></UIProvider>));
}

it('updates an active author query when the runtime acquires or changes its canonical profile', async () => {
  await render('Bob current');
  expect(host.querySelector('[data-post-id]')).toBeNull();
  fixtures.social = { ...fixtures.social, peerProfiles: {
    'ptid:bob': { display_name: 'Bob current', username: 'bob' },
  } };
  await render('Bob current');
  expect(host.querySelector('[data-post-id="private-post"]')).not.toBeNull();
  fixtures.social = { ...fixtures.social, peerProfiles: {
    'ptid:bob': { display_name: 'Bob renamed', username: 'bob' },
  } };
  await render('Bob current');
  expect(host.querySelector('[data-post-id]')).toBeNull();
  await render('Stale author');
  expect(host.querySelector('[data-post-id]')).toBeNull();
  await render('Bob renamed');
  expect(host.querySelector('[data-post-id="private-post"]')).not.toBeNull();
});

it('searches the matching Station catalog name and profile domain without accepting stale bindings', async () => {
  fixtures.social = { ...fixtures.social, peerProfiles: {
    'ptid:bob': { display_name: 'Bob', home_station_peer_id: 'station-b',
      home_station_domain: 'aspen.example' },
  } };
  fixtures.federation = { self: null, actorStationEntries: {
    'ptid:bob': { homeStationPeerId: 'station-b', homeStationName: 'Aspen Station' },
  } };
  for (const query of ['Aspen Station', 'aspen.example']) {
    await render(query);
    expect(host.querySelector('[data-post-id="private-post"]')).not.toBeNull();
  }
  fixtures.federation = { self: null, actorStationEntries: {
    'ptid:bob': { homeStationPeerId: 'station-other', homeStationName: 'Old Station' },
  } };
  for (const query of ['Old Station', 'old.example']) {
    await render(query);
    expect(host.querySelector('[data-post-id]')).toBeNull();
  }
});

it('uses the current self profile and Station rather than a cached peer profile', async () => {
  fixtures.social = {
    currentUserPtid: 'ptid:bob',
    currentUserProfile: { actorPtid: 'ptid:bob', displayName: 'My current name', username: 'my-handle' },
    peerProfiles: { 'ptid:bob': { display_name: 'Old peer name' } },
  };
  fixtures.federation = {
    self: { home_station_peer_id: 'station-self', home_station_domain: 'self.example' },
    actorStationEntries: { 'ptid:bob': {
      homeStationPeerId: 'station-self', homeStationName: 'My Station',
    } },
  };
  for (const query of ['My current name', 'my-handle', 'My Station', 'self.example']) {
    await render(query);
    expect(host.querySelector('[data-post-id="private-post"]')).not.toBeNull();
  }
  await render('Old peer name');
  expect(host.querySelector('[data-post-id]')).toBeNull();
});
