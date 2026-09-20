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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { toBinary, create } from '@bufbuild/protobuf';
import type { DescMessage, MessageInitShape } from '@bufbuild/protobuf';
import {
  AudienceSchema,
  Audience_Kind,
  CreatePostResponseSchema,
  GetPostResponseSchema,
  GetTimelineResponseSchema,
  SyncMomentsProjectionResponseSchema,
  ListPostsResponseSchema,
  ReactToPostResponseSchema,
  UpsertStationModerationPolicyResponseSchema,
  DeleteStationModerationPolicyResponseSchema,
  PostType,
  PostSchema,
  PostVisibility,
  ReactionKind,
  RelationshipReason_Kind,
  type Audience,
} from '../gen/proto/domain/social/post_pb';
import {
  GetCommentsResponseSchema,
  CreateCommentResponseSchema,
} from '../gen/proto/domain/social/comment_pb';
import {
  FollowResponseSchema,
} from '../gen/proto/domain/social/relationship_pb';
import { ListMyCirclesResponseSchema } from '../gen/proto/domain/social/circle_pb';
import { selectMomentComments, useMomentsStore } from '../store/moments';
import { usePrivateMomentsStore } from '../store/privateMoments';
import { normalizePrivateMomentProjection } from '../services/privateMomentsNative';
import { useRelationshipsStore } from '../store/relationships';
import { useSessionStore } from '../store/session';
import { EVENT, eventBus } from '../kernel/events';
import {
  ensureMomentDetailProjection,
  isPrivateMomentPost,
  momentsRuntime,
} from '../runtimes/momentsRuntime';
import {
  socialStationModerationDelete,
  socialStationModerationUpsert,
} from '../services/social_api';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((path: string, protocol = 'asset') => (
    `${protocol}://localhost/${encodeURIComponent(path)}`
  )),
  invoke: vi.fn(),
}));

vi.mock('../storage/desktopClientStorage', () => ({
  readDesktopPreferenceSync: vi.fn(() => undefined),
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

function bytesOk<Desc extends DescMessage>(
  schema: Desc,
  value: MessageInitShape<Desc>,
) {
  const msg = create(schema, value);
  const bytes = Array.from(toBinary(schema, msg));
  return { ok: true, data: bytes };
}

interface QueuedReply {
  match: (cmd: string, args?: unknown) => boolean;
  result: unknown;
}

let pending: QueuedReply[] = [];

function enqueue(cmd: string, result: unknown) {
  pending.push({ match: (c) => c === cmd, result });
}

function enqueueMatch(match: QueuedReply['match'], result: unknown) {
  pending.push({ match, result });
}

function statusOk(value: unknown) {
  return { ok: true, data: { status: JSON.stringify(value) } };
}

function audience(): Audience {
  return create(AudienceSchema, { kind: 1 /* PUBLIC */ }) as Audience;
}

function installEventWindowStub(): void {
  const target = new EventTarget();
  vi.stubGlobal('window', {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
  });
}

function dataOk(status: unknown) {
  return { ok: true, data: { status: JSON.stringify(status) } };
}

beforeEach(() => {
  momentsRuntime.teardown();
  invokeMock.mockReset();
  pending = [];
  useMomentsStore.getState().reset();
  usePrivateMomentsStore.getState().reset();
  useRelationshipsStore.getState().reset();
  useSessionStore.getState().reset();
  invokeMock.mockImplementation((cmd: string, _args?: unknown) => {
    if (cmd === 'frontend_log') return Promise.resolve(undefined);
    const idx = pending.findIndex((p) => p.match(cmd, _args));
    if (idx === -1) {
      return Promise.reject(new Error(`unexpected invoke(${cmd}) — no fixture queued`));
    }
    const [{ result }] = pending.splice(idx, 1);
    return Promise.resolve(result);
  });
});

afterEach(() => {
  momentsRuntime.teardown();
  vi.unstubAllGlobals();
});

describe('moments store: loadFeed', () => {
  it('ingests posts and dedupes across two pages', async () => {
    enqueue('social_get_timeline',
      bytesOk(GetTimelineResponseSchema, {
        posts: [
          { id: 'p1', authorPtid: 'a', type: PostType.TEXT },
          { id: 'p2', authorPtid: 'a', type: PostType.TEXT },
        ],
        explanations: [
          {
            objectId: 'p1',
            relationshipReason: {
              kind: RelationshipReason_Kind.RELATIONSHIP_REASON_FOLLOWING,
            },
          },
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
          { id: 'p2', authorPtid: 'a', type: PostType.TEXT },
          { id: 'p3', authorPtid: 'a', type: PostType.TEXT },
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
    expect(useMomentsStore.getState().feedExplanations['p1']?.relationshipReason?.kind).toBe(
      RelationshipReason_Kind.RELATIONSHIP_REASON_FOLLOWING,
    );
  });

  it('replaces (not appends) when refresh=true', async () => {
    enqueue('social_get_timeline',
      bytesOk(GetTimelineResponseSchema, {
        posts: [{ id: 'p1', authorPtid: 'a', type: PostType.TEXT }],
        nextCursor: '',
        hasMore: false,
      }),
    );
    enqueue('social_get_timeline',
      bytesOk(GetTimelineResponseSchema, {
        posts: [{ id: 'p9', authorPtid: 'a', type: PostType.TEXT }],
        nextCursor: '',
        hasMore: false,
      }),
    );

    await useMomentsStore.getState().loadFeed('home');
    await useMomentsStore.getState().loadFeed('home', { refresh: true });

    expect(useMomentsStore.getState().feeds.home.postIds).toEqual(['p9']);
  });
});

describe('moments store: syncProjection', () => {
  it('replaces HOME and Explore from the projection sync snapshot', async () => {
    enqueue('social_sync_moments_projection',
      bytesOk(SyncMomentsProjectionResponseSchema, {
        homeTimeline: {
          posts: [{ id: 'home-new', authorPtid: 'a', type: PostType.TEXT }],
          explanations: [
            {
              objectId: 'home-new',
              relationshipReason: {
                kind: RelationshipReason_Kind.RELATIONSHIP_REASON_SELF,
              },
            },
          ],
          nextCursor: 'home-cur',
          hasMore: true,
        },
        publicTimeline: {
          posts: [{ id: 'pub-new', authorPtid: 'b', type: PostType.TEXT }],
          nextCursor: 'pub-cur',
          hasMore: false,
        },
        syncToken: 'home-cur:pub-cur',
      }),
    );

    await useMomentsStore.getState().syncProjection('test');

    const state = useMomentsStore.getState();
    expect(state.feeds.home.postIds).toEqual(['home-new']);
    expect(state.feeds.home.nextCursor).toBe('home-cur');
    expect(state.feeds.home.hasMore).toBe(true);
    expect(state.feeds.explore.postIds).toEqual(['pub-new']);
    expect(state.feeds.explore.nextCursor).toBe('pub-cur');
    expect(state.postsById['home-new']?.id).toBe('home-new');
    expect(state.postsById['pub-new']?.id).toBe('pub-new');
    expect(state.feedExplanations['home-new']?.relationshipReason?.kind).toBe(
      RelationshipReason_Kind.RELATIONSHIP_REASON_SELF,
    );
  });

  it('drops a projection response that completes after actor reset', async () => {
    let resolveResponse:
      | ((value: ReturnType<typeof bytesOk<typeof SyncMomentsProjectionResponseSchema>>) => void)
      | undefined;
    const response = new Promise<
      ReturnType<typeof bytesOk<typeof SyncMomentsProjectionResponseSchema>>
    >((resolve) => {
      resolveResponse = resolve;
    });
    enqueue('social_sync_moments_projection', response);

    const pendingSync = useMomentsStore.getState().syncProjection('stale-actor');
    useMomentsStore.getState().reset();
    resolveResponse?.(bytesOk(SyncMomentsProjectionResponseSchema, {
      homeTimeline: {
        posts: [{ id: 'stale-private', authorPtid: 'old-actor', type: PostType.TEXT }],
      },
      publicTimeline: {
        posts: [],
      },
    }));
    await pendingSync;

    expect(useMomentsStore.getState().feeds.home.postIds).toEqual([]);
    expect(useMomentsStore.getState().postsById['stale-private']).toBeUndefined();
  });
});

describe('moments store: createPost / deletePost', () => {
  it('createPost prepends id to HOME and stores the post', async () => {
    enqueue('social_create_moment',
      bytesOk(CreatePostResponseSchema, {
        post: { id: 'pNEW', authorPtid: 'a', type: PostType.TEXT },
      }),
    );

    const id = await useMomentsStore
      .getState()
      .createPost({ kind: 'text', text: 'hi', audience: audience() });

    expect(id).toBe('pNEW');
    expect(useMomentsStore.getState().feeds.home.postIds[0]).toBe('pNEW');
    expect(useMomentsStore.getState().postsById['pNEW']?.id).toBe('pNEW');
  });

  it('createPost(image) carries image_ids through the wire layer', async () => {
    // The store delegates to socialCreateMoment which delegates to
    // buildCreatePostRequest. We don't need to introspect the bytes
    // here — what matters is the call succeeds and the returned id
    // ingests as IMAGE so the renderer picks the image branch.
    enqueue('social_create_moment',
      bytesOk(CreatePostResponseSchema, {
        post: { id: 'pIMG', authorPtid: 'a', type: PostType.IMAGE },
      }),
    );

    const id = await useMomentsStore.getState().createPost({
      kind: 'image',
      text: 'family weekend',
      imageIds: [
        'oss://station.local/2026/04/29/aaa.png',
        'oss://station.local/2026/04/29/bbb.jpg',
      ],
      audience: audience(),
    });

    expect(id).toBe('pIMG');
    const stored = useMomentsStore.getState().postsById['pIMG'];
    expect(stored?.type).toBe(PostType.IMAGE);
    expect(useMomentsStore.getState().feeds.home.postIds[0]).toBe('pIMG');
  });

  it('createPost(private image) delegates local file intent to Native only', async () => {
    const authorPtid = 'did:peers:author';
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    useSessionStore.setState({
      authenticated: true,
      currentUser: {
        actorPtid: authorPtid,
        name: 'author',
        email: '',
        loginMethod: 'password',
      },
    });
    usePrivateMomentsStore.getState().reset();
    usePrivateMomentsStore.getState().activateActor(authorPtid, 1);

    let nativeInput: Record<string, unknown> | undefined;
    enqueueMatch((cmd, args) => {
      if (cmd !== 'social_private_moment_publish') return false;
      nativeInput = (args as { input?: Record<string, unknown> }).input;
      return true;
    }, statusOk({
      state: 'PUBLISHED',
      draft_id: 'draft-private-image',
      post_id: 'pPRIVATE',
      projection: {
        post_id: 'pPRIVATE',
        content_id: 'pPRIVATE',
        generation: '1',
        author_ptid: authorPtid,
        audience_kind: 'FRIENDS',
        state: 'CONTENT_READY',
        content: {
          kind: 'IMAGE',
          text: 'private family photo',
          media: [],
        },
      },
    }));

    const id = await useMomentsStore.getState().createPost({
      kind: 'image',
      text: 'private family photo',
      imageIds: [],
      audience: create(AudienceSchema, { kind: Audience_Kind.FRIENDS }),
      draftId: 'draft-private-image',
      draftRevision: 3,
      localFiles: [{
        intentId: 'image-1',
        filePath: '/private/family.png',
        previewSrc: 'asset://localhost/private/family.png',
      }],
    });

    expect(id).toBe('pPRIVATE');
    expect(nativeInput).toMatchObject({
      actor_ptid: authorPtid,
      renderer_generation: 1,
      draft_id: 'draft-private-image',
      draft_revision: 3,
      audience_kind: 'FRIENDS',
      text: 'private family photo',
      files: [{ intent_id: 'image-1', file_path: '/private/family.png' }],
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      'social_create_moment',
      expect.anything(),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      'signaling_envelope_seal',
      expect.anything(),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      'oss_upload_encrypted_attachment_social',
      expect.anything(),
    );
  });

  it('rejects private Browser publish before invoking any backend command', async () => {
    installEventWindowStub();
    Object.assign(window, { __PT_GATEWAY_BASE__: '/api' });
    usePrivateMomentsStore.getState().reset();
    usePrivateMomentsStore.getState().activateActor('ptid:browser-author', 2);

    await expect(
      useMomentsStore.getState().createPost({
        kind: 'text',
        text: 'browser-private-draft',
        audience: create(AudienceSchema, { kind: Audience_Kind.FRIENDS }),
        draftId: 'browser-private-draft',
        draftRevision: 1,
      }),
    ).rejects.toThrow('PRIVATE_UNSUPPORTED');

    expect(invokeMock).not.toHaveBeenCalledWith(
      'social_create_moment',
      expect.anything(),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      'social_private_moment_publish',
      expect.anything(),
    );
  });

  it('routes only FRIENDS Moments through the Secure Content runtime', () => {
    expect(isPrivateMomentPost(create(PostSchema, {
      id: 'friends',
      audience: create(AudienceSchema, { kind: Audience_Kind.FRIENDS }),
    }))).toBe(true);
    for (const kind of [
      Audience_Kind.PUBLIC,
      Audience_Kind.FOLLOWERS,
      Audience_Kind.CIRCLE,
      Audience_Kind.GROUP,
      Audience_Kind.SELF,
      Audience_Kind.CUSTOM_ALLOW,
      Audience_Kind.CUSTOM_DENY,
    ]) {
      expect(isPrivateMomentPost(create(PostSchema, {
        id: `post-${kind}`,
        audience: create(AudienceSchema, { kind }),
      }))).toBe(false);
    }
    expect(isPrivateMomentPost(create(PostSchema, {
      id: 'legacy-private',
      visibility: PostVisibility.PRIVATE,
      audience: create(AudienceSchema, {
        kind: Audience_Kind.KIND_UNSPECIFIED,
      }),
    }))).toBe(true);
  });

  it('purges Native private material before removing the renderer projection', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    usePrivateMomentsStore.getState().reset();
    usePrivateMomentsStore.getState().activateActor('ptid:alice', 9);
    usePrivateMomentsStore.setState({
      postsById: {
        'private-post': {
          postId: 'private-post',
          contentId: 'private-post',
          generation: '1',
          authorPtid: 'ptid:bob',
          audienceKind: 'FRIENDS',
          state: 'CONTENT_READY',
          content: { kind: 'TEXT', text: 'private' },
        },
      },
    });
    enqueue('social_private_moment_purge', statusOk({ ok: true }));

    await usePrivateMomentsStore.getState().purgeMoment('private-post');

    expect(invokeMock).toHaveBeenCalledWith('social_private_moment_purge', {
      input: {
        actor_ptid: 'ptid:alice',
        renderer_generation: 9,
        post_id: 'private-post',
      },
    });
    expect(usePrivateMomentsStore.getState().postsById['private-post']).toBeUndefined();
  });

  it('retains a cleanup tombstone when Native purge fails', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    usePrivateMomentsStore.getState().reset();
    usePrivateMomentsStore.getState().activateActor('ptid:alice', 9);
    usePrivateMomentsStore.setState({
      postsById: {
        'private-post': {
          postId: 'private-post',
          contentId: 'private-post',
          generation: '1',
          authorPtid: 'ptid:bob',
          audienceKind: 'FRIENDS',
          state: 'CONTENT_READY',
          content: { kind: 'TEXT', text: 'private' },
        },
      },
    });
    enqueue('social_private_moment_purge', {
      ok: false,
      error: {
        code: 'PRIVATE_PURGE_FAILED',
        details: { state: 'INTEGRITY_FAILURE' },
      },
    });

    await expect(
      usePrivateMomentsStore.getState().purgeMoment('private-post'),
    ).rejects.toThrow();
    expect(usePrivateMomentsStore.getState().postsById['private-post']).toMatchObject({
      state: 'DELETED_OR_REVOKED',
      content: undefined,
    });
  });

  it('deletePost scrubs the id from every feed', async () => {
    enqueue('social_get_timeline',
      bytesOk(GetTimelineResponseSchema, {
        posts: [{ id: 'p1', authorPtid: 'a' }, { id: 'p2', authorPtid: 'a' }],
        explanations: [
          {
            objectId: 'p2',
            relationshipReason: {
              kind: RelationshipReason_Kind.RELATIONSHIP_REASON_FOLLOWING,
            },
          },
        ],
        nextCursor: '',
        hasMore: false,
      }),
    );
    enqueue('social_list_by_author',
      bytesOk(ListPostsResponseSchema, {
        posts: [{ id: 'p2', authorPtid: 'a' }, { id: 'p3', authorPtid: 'a' }],
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
    expect(useMomentsStore.getState().feedExplanations['p2']).toBeUndefined();
  });
});

describe('private Moments Native projection', () => {
  it('accepts only an opaque window-authorized private media URL', () => {
    const projection = normalizePrivateMomentProjection({
      post_id: 'post-private-media',
      content_id: 'content-private-media',
      generation: '1',
      author_ptid: 'ptid:author',
      audience_kind: 'FRIENDS',
      state: 'CONTENT_READY',
      content: {
        kind: 'IMAGE',
        text: 'private image',
        media: [{
          object_id: 'object-1',
          state: 'MEDIA_READY',
          render_url: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
          mime_type: 'image/jpeg',
        }],
      },
    });

    expect(projection.content?.kind).toBe('IMAGE');
    if (projection.content?.kind !== 'IMAGE') return;
    expect(projection.content.media[0]?.renderUrl).toBe(
      'private-media://localhost/01ARZ3NDEKTSV4RRFFQ69G5FAV',
    );
  });

  it('rejects a private media projection that exposes its local path', () => {
    expect(() => normalizePrivateMomentProjection({
      post_id: 'post-private-media',
      content_id: 'content-private-media',
      generation: '1',
      author_ptid: 'ptid:author',
      audience_kind: 'FRIENDS',
      state: 'CONTENT_READY',
      content: {
        kind: 'IMAGE',
        text: 'private image',
        media: [{
          object_id: 'object-1',
          state: 'MEDIA_READY',
          local_path: '/private/cache/object-1.jpg',
          mime_type: 'image/jpeg',
        }],
      },
    })).toThrow('exposed a local path');
  });

  it('accepts typed non-ready projections without fabricated author metadata', () => {
    const projection = normalizePrivateMomentProjection({
      post_id: 'post-denied',
      content_id: 'unavailable:post-denied',
      generation: '0',
      author_ptid: '',
      audience_kind: 'FRIENDS',
      state: 'NOT_FOUND_OR_NOT_AUTHORIZED',
      error_code: 'ERROR_CODE_NOT_FOUND',
    });

    expect(projection.state).toBe('NOT_FOUND_OR_NOT_AUTHORIZED');
    expect(projection.authorPtid).toBe('');
  });

  it('replaces a loading projection with the typed Native read failure', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    usePrivateMomentsStore.getState().reset();
    usePrivateMomentsStore.getState().activateActor('ptid:viewer', 4);
    usePrivateMomentsStore.setState({
      postsById: {
        'post-private': {
          postId: 'post-private',
          contentId: 'content-private',
          generation: '8',
          authorPtid: 'ptid:author',
          audienceKind: 'FRIENDS',
          state: 'CONTENT_READY',
          content: { kind: 'TEXT', text: 'secret' },
        },
      },
    });
    enqueue('social_private_moment_read', {
      ok: false,
      error: {
        code: 'NOT_FOUND_OR_NOT_AUTHORIZED',
        message: 'not found',
        details: { state: 'NOT_FOUND_OR_NOT_AUTHORIZED' },
      },
    });

    await usePrivateMomentsStore.getState().readMoment('post-private');

    const projection = usePrivateMomentsStore.getState().postsById['post-private'];
    expect(projection?.state).toBe('NOT_FOUND_OR_NOT_AUTHORIZED');
    expect(projection?.content).toBeUndefined();
  });

  it('falls through an empty legacy projection to Native private direct-link read', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    usePrivateMomentsStore.getState().reset();
    usePrivateMomentsStore.getState().activateActor('ptid:viewer', 6);
    enqueue(
      'social_get_moment',
      bytesOk(GetPostResponseSchema, {}),
    );
    enqueue('social_private_moment_read', {
      ok: true,
      data: {
        post_id: 'post-private-direct',
        content_id: 'content-private-direct',
        generation: '1',
        author_ptid: 'ptid:author',
        audience_kind: 'FRIENDS',
        state: 'CONTENT_READY',
        content: {
          kind: 'TEXT',
          text: 'direct private content',
        },
      },
    });

    await ensureMomentDetailProjection('post-private-direct');

    expect(
      usePrivateMomentsStore.getState().postsById['post-private-direct'],
    ).toMatchObject({
      state: 'CONTENT_READY',
      content: {
        kind: 'TEXT',
        text: 'direct private content',
      },
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      'social_get_comments',
      expect.anything(),
    );
  });

  it('preserves a verified local media projection across same-generation reconcile', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    usePrivateMomentsStore.getState().activateActor('ptid:viewer', 5);
    usePrivateMomentsStore.setState({
      postsById: {
        'post-private': {
          postId: 'post-private',
          contentId: 'content-private',
          generation: '8',
          authorPtid: 'ptid:author',
          audienceKind: 'FRIENDS',
          state: 'CONTENT_READY',
          content: {
            kind: 'IMAGE',
            text: 'secret',
            media: [{
              objectId: 'object-1',
              state: 'MEDIA_READY',
              renderUrl: 'private-media://localhost/01ARZ3NDEKTSV4RRFFQ69G5FAV',
            }],
          },
        },
      },
    });
    enqueue('social_private_moments_bootstrap', statusOk({
      actor_ptid: 'ptid:viewer',
      device_id: 'device-1',
      session_generation: '9',
      projections: [{
        post_id: 'post-private',
        content_id: 'content-private',
        generation: '8',
        author_ptid: 'ptid:author',
        audience_kind: 'FRIENDS',
        state: 'CONTENT_READY',
        content: {
          kind: 'IMAGE',
          text: 'secret',
          media: [{ object_id: 'object-1', state: 'MEDIA_PLACEHOLDER' }],
        },
      }],
    }));

    await usePrivateMomentsStore.getState().bootstrap(5);

    const projection = usePrivateMomentsStore.getState().postsById['post-private'];
    expect(projection?.content?.kind).toBe('IMAGE');
    if (projection?.content?.kind !== 'IMAGE') return;
    expect(projection.content.media[0]?.state).toBe('MEDIA_READY');
    expect(projection.content.media[0]?.renderUrl).toBe(
      'private-media://localhost/01ARZ3NDEKTSV4RRFFQ69G5FAV',
    );
  });
});

describe('moments store: comments', () => {
  it('returns a stable empty comments fallback for missing post threads', () => {
    const state = useMomentsStore.getState();

    expect(selectMomentComments(state, 'missing')).toBe(selectMomentComments(state, 'missing'));
    expect(selectMomentComments(state, 'missing')).toBe(selectMomentComments(state, 'other-missing'));
  });

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
            authorPtid: 'a',
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
    const publishSpy = vi.spyOn(eventBus, 'publish').mockImplementation(() => undefined);
    enqueue('social_follow',
      bytesOk(FollowResponseSchema, {
        success: true,
        relationship: {
          id: 'r1',
          targetActorPtid: 'u2',
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
    expect(publishSpy).toHaveBeenCalledWith(EVENT.RELATIONSHIP_CHANGED, {
      targetActorPtid: 'u2',
      action: 'follow',
    });
    publishSpy.mockRestore();
  });

  it('rolls back on follow failure', async () => {
    const publishSpy = vi.spyOn(eventBus, 'publish').mockImplementation(() => undefined);
    enqueue('social_follow', {
      ok: false,
      error: { code: 'NETWORK', message: 'boom' },
    });

    await expect(
      useRelationshipsStore.getState().follow('u3'),
    ).rejects.toThrow();
    expect(useRelationshipsStore.getState().relations['u3']?.following).toBe(false);
    expect(publishSpy).not.toHaveBeenCalledWith(EVENT.RELATIONSHIP_CHANGED, expect.anything());
    publishSpy.mockRestore();
  });
});

describe('station moderation bridge: moments projection signal', () => {
  it('publishes moment.resync_requested after station policy upsert succeeds', async () => {
    const publishSpy = vi.spyOn(eventBus, 'publish').mockImplementation(() => undefined);
    enqueue('social_station_moderation_upsert',
      bytesOk(UpsertStationModerationPolicyResponseSchema, {
        policy: {
          stationDomain: 'station-b.example',
          kind: 1,
        },
      }),
    );

    await socialStationModerationUpsert({ stationDomain: 'station-b.example' });

    expect(publishSpy).toHaveBeenCalledWith(EVENT.MOMENT_RESYNC_REQUESTED, {
      reason: 'station_moderation_upsert',
    });
    publishSpy.mockRestore();
  });

  it('publishes moment.resync_requested after station policy delete succeeds', async () => {
    const publishSpy = vi.spyOn(eventBus, 'publish').mockImplementation(() => undefined);
    enqueue('social_station_moderation_delete',
      bytesOk(DeleteStationModerationPolicyResponseSchema, { success: true }),
    );

    await socialStationModerationDelete({ stationDomain: 'station-b.example' });

    expect(publishSpy).toHaveBeenCalledWith(EVENT.MOMENT_RESYNC_REQUESTED, {
      reason: 'station_moderation_delete',
    });
    publishSpy.mockRestore();
  });
});

describe('moments runtime: realtime recovery', () => {
  it('refreshes the Moments projection after realtime reconnect', async () => {
    installEventWindowStub();
    useSessionStore.setState({
      authenticated: true,
      currentUser: {
        actorPtid: 'viewer',
        name: 'Viewer',
        email: '',
        loginMethod: 'password',
      },
      restoring: false,
    });
    enqueue('actor_get_my_profile', dataOk({
      id: 'viewer',
      displayName: 'Viewer',
      username: 'viewer',
      avatar: '',
    }));
    enqueue('social_sync_moments_projection',
      bytesOk(SyncMomentsProjectionResponseSchema, {
        homeTimeline: {
          posts: [{ id: 'bootstrap-post', authorPtid: 'viewer', type: PostType.TEXT }],
          nextCursor: '',
          hasMore: false,
        },
        publicTimeline: {
          posts: [],
          nextCursor: '',
          hasMore: false,
        },
      }),
    );
    enqueue('social_circle_list_mine', bytesOk(ListMyCirclesResponseSchema, { circles: [] }));

    momentsRuntime.install();

    await vi.waitFor(() => {
      expect(useMomentsStore.getState().feeds.home.postIds).toEqual(['bootstrap-post']);
    });

    enqueue('social_sync_moments_projection',
      bytesOk(SyncMomentsProjectionResponseSchema, {
        homeTimeline: {
          posts: [{ id: 'reconnected-post', authorPtid: 'remote', type: PostType.TEXT }],
          explanations: [
            {
              objectId: 'reconnected-post',
              relationshipReason: {
                kind: RelationshipReason_Kind.RELATIONSHIP_REASON_FOLLOWING,
              },
            },
          ],
          nextCursor: '',
          hasMore: false,
        },
        publicTimeline: {
          posts: [],
          nextCursor: '',
          hasMore: false,
        },
      }),
    );
    enqueue('social_circle_list_mine', bytesOk(ListMyCirclesResponseSchema, { circles: [] }));

    eventBus.publish(EVENT.REALTIME_CONNECTION_STATE, {
      connected: false,
      reason: 'network_lost',
    });
    eventBus.publish(EVENT.REALTIME_CONNECTION_STATE, {
      connected: true,
      reason: 'network_resumed',
    });

    await vi.waitFor(() => {
      expect(useMomentsStore.getState().feeds.home.postIds).toEqual(['reconnected-post']);
      expect(
        useMomentsStore.getState().feedExplanations['reconnected-post']?.relationshipReason?.kind,
      ).toBe(RelationshipReason_Kind.RELATIONSHIP_REASON_FOLLOWING);
    });
  });
});
