// Tests for the Moments store reducer paths.
//
// Why these specific shapes get tested:
//   - `loadFeed` must dedupe across pages (server can return overlap
//     when a new post lands between requests). A naive concat would
//     show duplicates in the timeline.
//   - `createPost` must place the new id at the head of the HOME
//     feed and ingest the author for cheap re-render.
//   - `deletePost` must scrub the id from EVERY feed (home, explore,
//     userFeeds, circleFeeds) — partial removal would leave a ghost
//     row that 404s on click.
//   - `loadComments` must update the per-post cursor + has_more so
//     pagination keeps working. Reactions must be replaced wholesale
//     (not merged) since the server returns the full summary list.
//   - Optimistic follow flip in `relationships` must roll back on
//     failure — otherwise the follow button stays in the wrong state
//     after a network error.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { toBinary, create } from '@bufbuild/protobuf';
import {
  AudienceSchema,
  CreatePostResponseSchema,
  GetPostResponseSchema,
  GetTimelineResponseSchema,
  ListPostsResponseSchema,
  ReactToPostResponseSchema,
  PostType,
  ReactionKind,
  type Audience,
} from '../gen/proto/domain/social/post_pb';
import {
  GetCommentsResponseSchema,
  CreateCommentResponseSchema,
} from '../gen/proto/domain/social/comment_pb';
import {
  FollowResponseSchema,
} from '../gen/proto/domain/social/relationship_pb';
import { useMomentsStore } from '../store/moments';
import { useRelationshipsStore } from '../store/relationships';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

// Helpers — build proto-shaped fixtures and serialize them as the
// Tauri command would. The store consumes the byte array via
// `invokeRustProto`, so we mirror that wire layer faithfully.
//
// Why a command-aware mock dispatcher (vs `mockResolvedValueOnce`):
//   The store's logger calls `invoke('frontend_log', ...)` on every
//   error path. Those side-channel calls consume slots from a naive
//   `mockResolvedValueOnce` queue and shift the real social_*
//   responses, breaking the test in a way that LOOKS like a store
//   bug. Dispatching by command name keeps the queue stable and the
//   logger silent.

function bytesOk(schema: any, value: any) {
  const msg = create(schema, value);
  const bytes = Array.from(toBinary(schema, msg));
  return { ok: true, data: bytes };
}

interface QueuedReply {
  match: (cmd: string) => boolean;
  result: unknown;
}

let pending: QueuedReply[] = [];

function enqueue(cmd: string, result: unknown) {
  pending.push({ match: (c) => c === cmd, result });
}

function audience(): Audience {
  return create(AudienceSchema, { kind: 1 /* PUBLIC */ }) as Audience;
}

beforeEach(() => {
  invokeMock.mockReset();
  pending = [];
  useMomentsStore.getState().reset();
  useRelationshipsStore.getState().reset();
  invokeMock.mockImplementation((cmd: string, _args?: unknown) => {
    if (cmd === 'frontend_log') return Promise.resolve(undefined);
    const idx = pending.findIndex((p) => p.match(cmd));
    if (idx === -1) {
      return Promise.reject(new Error(`unexpected invoke(${cmd}) — no fixture queued`));
    }
    const [{ result }] = pending.splice(idx, 1);
    return Promise.resolve(result);
  });
});

describe('moments store: loadFeed', () => {
  it('ingests posts and dedupes across two pages', async () => {
    enqueue('social_get_timeline',
      bytesOk(GetTimelineResponseSchema, {
        posts: [
          { id: 'p1', authorId: 'a', type: PostType.TEXT },
          { id: 'p2', authorId: 'a', type: PostType.TEXT },
        ],
        nextCursor: 'cur1',
        hasMore: true,
      }),
    );
    enqueue('social_get_timeline',
      bytesOk(GetTimelineResponseSchema, {
        // Server returned p2 again (race with new insert) plus p3.
        // The store must not emit p2 a second time.
        posts: [
          { id: 'p2', authorId: 'a', type: PostType.TEXT },
          { id: 'p3', authorId: 'a', type: PostType.TEXT },
        ],
        nextCursor: 'cur2',
        hasMore: false,
      }),
    );

    await useMomentsStore.getState().loadFeed('home');
    await useMomentsStore.getState().loadFeed('home');

    const ids = useMomentsStore.getState().feeds.home.postIds;
    expect(ids).toEqual(['p1', 'p2', 'p3']);
    expect(useMomentsStore.getState().feeds.home.hasMore).toBe(false);
  });

  it('replaces (not appends) when refresh=true', async () => {
    enqueue('social_get_timeline',
      bytesOk(GetTimelineResponseSchema, {
        posts: [{ id: 'p1', authorId: 'a', type: PostType.TEXT }],
        nextCursor: '',
        hasMore: false,
      }),
    );
    enqueue('social_get_timeline',
      bytesOk(GetTimelineResponseSchema, {
        posts: [{ id: 'p9', authorId: 'a', type: PostType.TEXT }],
        nextCursor: '',
        hasMore: false,
      }),
    );

    await useMomentsStore.getState().loadFeed('home');
    await useMomentsStore.getState().loadFeed('home', { refresh: true });

    expect(useMomentsStore.getState().feeds.home.postIds).toEqual(['p9']);
  });
});

describe('moments store: createPost / deletePost', () => {
  it('createPost prepends id to HOME and stores the post', async () => {
    enqueue('social_create_moment',
      bytesOk(CreatePostResponseSchema, {
        post: { id: 'pNEW', authorId: 'a', type: PostType.TEXT },
      }),
    );

    const id = await useMomentsStore
      .getState()
      .createPost({ kind: 'text', text: 'hi', audience: audience() });

    expect(id).toBe('pNEW');
    expect(useMomentsStore.getState().feeds.home.postIds[0]).toBe('pNEW');
    expect(useMomentsStore.getState().postsById['pNEW']?.id).toBe('pNEW');
  });

  it('deletePost scrubs the id from every feed', async () => {
    enqueue('social_get_timeline',
      bytesOk(GetTimelineResponseSchema, {
        posts: [{ id: 'p1', authorId: 'a' }, { id: 'p2', authorId: 'a' }],
        nextCursor: '',
        hasMore: false,
      }),
    );
    enqueue('social_list_by_author',
      bytesOk(ListPostsResponseSchema, {
        posts: [{ id: 'p2', authorId: 'a' }, { id: 'p3', authorId: 'a' }],
        nextCursor: '',
        hasMore: false,
      }),
    );
    // The Rust DELETE returns the response proto; an empty {} encodes to zero bytes.
    enqueue('social_delete_moment', bytesOk(GetPostResponseSchema, {}));

    await useMomentsStore.getState().loadFeed('home');
    await useMomentsStore.getState().loadUserFeed('a');
    await useMomentsStore.getState().deletePost('p2');

    expect(useMomentsStore.getState().feeds.home.postIds).toEqual(['p1']);
    expect(useMomentsStore.getState().userFeeds['a'].postIds).toEqual(['p3']);
    expect(useMomentsStore.getState().postsById['p2']).toBeUndefined();
  });
});

describe('moments store: comments', () => {
  it('paginates via per-post cursor', async () => {
    enqueue('social_get_comments',
      bytesOk(GetCommentsResponseSchema, {
        comments: [{ id: 'c1', postId: 'p1', content: 'a' }],
        nextCursor: 'cc1',
        hasMore: true,
      }),
    );
    enqueue('social_get_comments',
      bytesOk(GetCommentsResponseSchema, {
        comments: [
          // c1 returned again — must dedupe.
          { id: 'c1', postId: 'p1', content: 'a' },
          { id: 'c2', postId: 'p1', content: 'b' },
        ],
        nextCursor: '',
        hasMore: false,
      }),
    );

    await useMomentsStore.getState().loadComments('p1');
    await useMomentsStore.getState().loadComments('p1');

    expect(useMomentsStore.getState().comments['p1']?.map((c) => c.id)).toEqual([
      'c1',
      'c2',
    ]);
    expect(useMomentsStore.getState().commentsHasMore['p1']).toBe(false);
  });

  it('createComment optimistically bumps stats.commentsCount', async () => {
    enqueue('social_get_timeline',
      bytesOk(GetTimelineResponseSchema, {
        posts: [
          {
            id: 'p1',
            authorId: 'a',
            type: PostType.TEXT,
            stats: { commentsCount: 0n, likesCount: 0n, repostsCount: 0n, viewsCount: 0n },
          },
        ],
        nextCursor: '',
        hasMore: false,
      }),
    );
    enqueue('social_create_comment',
      bytesOk(CreateCommentResponseSchema, {
        comment: { id: 'cNEW', postId: 'p1', content: 'hello' },
      }),
    );

    await useMomentsStore.getState().loadFeed('home');
    await useMomentsStore.getState().createComment('p1', 'hello');

    expect(useMomentsStore.getState().postsById['p1']?.stats?.commentsCount).toBe(1n);
    expect(useMomentsStore.getState().comments['p1']?.[0]?.id).toBe('cNEW');
  });
});

describe('moments store: reactions', () => {
  it('replaces (not merges) the reaction list from server', async () => {
    enqueue('social_react',
      bytesOk(ReactToPostResponseSchema, {
        success: true,
        reactions: [
          { kind: ReactionKind.REACTION_LIKE, count: 1n, reactedByViewer: true },
        ],
      }),
    );

    await useMomentsStore.getState().reactToPost('p1', ReactionKind.REACTION_LIKE);

    expect(useMomentsStore.getState().reactions['p1']?.length).toBe(1);
    expect(useMomentsStore.getState().reactions['p1']?.[0]?.kind).toBe(
      ReactionKind.REACTION_LIKE,
    );
  });
});

describe('relationships store: optimistic follow', () => {
  it('flips following=true immediately and confirms with server payload', async () => {
    enqueue('social_follow',
      bytesOk(FollowResponseSchema, {
        success: true,
        relationship: {
          id: 'r1',
          targetActorId: 'u2',
          following: true,
          followedBy: false,
        },
      }),
    );

    const promise = useRelationshipsStore.getState().follow('u2');
    // Optimistic state visible synchronously (before server resolves).
    expect(useRelationshipsStore.getState().relations['u2']?.following).toBe(true);
    await promise;
    expect(useRelationshipsStore.getState().relations['u2']?.following).toBe(true);
    expect(useRelationshipsStore.getState().relations['u2']?.id).toBe('r1');
  });

  it('rolls back on follow failure', async () => {
    enqueue('social_follow', {
      ok: false,
      error: { code: 'NETWORK', message: 'boom' },
    });

    await expect(
      useRelationshipsStore.getState().follow('u3'),
    ).rejects.toThrow();
    expect(useRelationshipsStore.getState().relations['u3']?.following).toBe(false);
  });
});
