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
  ReactionSummarySchema,
  UpsertStationModerationPolicyResponseSchema,
  DeleteStationModerationPolicyResponseSchema,
  PostType,
  PostSchema,
  ReactionKind,
  RelationshipReason_Kind,
  type Audience,
} from '../gen/proto/domain/social/post_pb';
import {
  CreateCommentResponseSchema,
} from '../gen/proto/domain/social/comment_pb';
import { ListMomentCommentsResponseSchema } from '../gen/proto/domain/social/private_content_pb';
import {
  FollowResponseSchema,
} from '../gen/proto/domain/social/relationship_pb';
import { ListMyCirclesResponseSchema } from '../gen/proto/domain/social/circle_pb';
import { selectMomentComments, useMomentsStore } from '../store/moments';
import { usePrivateMomentsStore } from '../store/privateMoments';
import {
  selectPrivateCommentDraft,
  selectPrivateCommentThread,
  usePrivateCommentsStore,
} from '../store/privateComments';
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
  type MomentDraft,
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

function installEventWindowStub(): Array<() => void> {
  const target = new EventTarget();
  const intervalCallbacks: Array<() => void> = [];
  vi.stubGlobal('window', {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    setInterval: vi.fn((callback: () => void) => {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    }),
    clearInterval: vi.fn(),
  });
  return intervalCallbacks;
}

function dataOk(status: unknown) {
  return { ok: true, data: { status: JSON.stringify(status) } };
}

beforeEach(() => {
  momentsRuntime.teardown();
  invokeMock.mockReset();
  pending = [];
  useMomentsStore.getState().reset();
  usePrivateCommentsStore.getState().reset();
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
  vi.restoreAllMocks();
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

  it('composes authored Native private projections into HOME without copying plaintext', async () => {
    usePrivateMomentsStore.getState().activateActor('ptid:author', 7);
    usePrivateMomentsStore.setState({
      postsById: {
        'private-author-post': {
          postId: 'private-author-post',
          contentId: 'private-author-post',
          generation: '1',
          authorPtid: 'ptid:author',
          audienceKind: 'FRIENDS',
          state: 'CONTENT_READY',
          mentions: [],
          content: {
            kind: 'TEXT',
            text: 'private author plaintext',
          },
          createdAtMillis: 2_000,
          updatedAtMillis: 2_000,
        },
      },
    });
    enqueue('social_sync_moments_projection',
      bytesOk(SyncMomentsProjectionResponseSchema, {
        homeTimeline: {
          posts: [{ id: 'public-home-post', authorPtid: 'ptid:author', type: PostType.TEXT }],
          nextCursor: '',
          hasMore: false,
        },
        publicTimeline: { posts: [], nextCursor: '', hasMore: false },
      }),
    );

    await useMomentsStore.getState().syncProjection('private-author-recovery');

    const state = useMomentsStore.getState();
    expect(state.feeds.home.postIds).toEqual([
      'private-author-post',
      'public-home-post',
    ]);
    expect(state.postsById['private-author-post']).toMatchObject({
      id: 'private-author-post',
      authorPtid: 'ptid:author',
      type: PostType.TEXT,
      audience: { kind: Audience_Kind.FRIENDS },
      content: { case: undefined },
    });
    expect(state.postsById['private-author-post']?.content.case).toBeUndefined();
  });

  it('composes authorized recipient Native private projections into HOME', async () => {
    usePrivateMomentsStore.getState().activateActor('ptid:viewer', 7);
    usePrivateMomentsStore.setState({
      postsById: {
        'private-recipient-post': {
          postId: 'private-recipient-post',
          contentId: 'private-recipient-post',
          generation: '1',
          authorPtid: 'ptid:author',
          audienceKind: 'FRIENDS',
          state: 'CONTENT_READY',
          mentions: [],
          content: {
            kind: 'TEXT',
            text: 'private recipient plaintext',
          },
          createdAtMillis: 2_000,
          updatedAtMillis: 2_000,
        },
      },
    });
    enqueue('social_sync_moments_projection',
      bytesOk(SyncMomentsProjectionResponseSchema, {
        homeTimeline: { posts: [], nextCursor: '', hasMore: false },
        publicTimeline: { posts: [], nextCursor: '', hasMore: false },
      }),
    );

    await useMomentsStore.getState().syncProjection('private-recipient-recovery');

    const state = useMomentsStore.getState();
    expect(state.feeds.home.postIds).toEqual(['private-recipient-post']);
    expect(state.postsById['private-recipient-post']).toMatchObject({
      id: 'private-recipient-post',
      authorPtid: 'ptid:author',
      type: PostType.TEXT,
      audience: { kind: Audience_Kind.FRIENDS },
      content: { case: undefined },
    });
    expect(state.postsById['private-recipient-post']?.content.case).toBeUndefined();
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
      audience: { kind: 'FRIENDS' },
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
    expect(useMomentsStore.getState().feeds.home.postIds[0]).toBe('pPRIVATE');
    expect(useMomentsStore.getState().postsById.pPRIVATE).toMatchObject({
      id: 'pPRIVATE',
      authorPtid,
      type: PostType.IMAGE,
      audience: { kind: Audience_Kind.FRIENDS },
      content: { case: undefined },
    });
    expect(useMomentsStore.getState().postsById.pPRIVATE?.content.case)
      .toBeUndefined();
  });

  it('invalidates stale remote recipient readiness after a draft edit', async () => {
    const authorPtid = 'ptid:author';
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

    let resolveAdmission!: (value: unknown) => void;
    let nativeInput: Record<string, unknown> | undefined;
    enqueueMatch(
      (cmd, args) => {
        if (cmd !== 'social_private_moment_publish') return false;
        nativeInput = (args as { input?: Record<string, unknown> }).input;
        return true;
      },
      new Promise((resolve) => {
        resolveAdmission = resolve;
      }),
    );

    const admission = usePrivateMomentsStore.getState().admitMoment(
      {
        draftId: 'draft-remote',
        draftRevision: 1,
        audience: { kind: 'FRIENDS' },
        momentKind: 'TEXT',
        text: 'before edit',
        files: [],
      },
      'CHECKING_REMOTE_READINESS',
    );
    expect(usePrivateMomentsStore.getState().publish).toMatchObject({
      state: 'CHECKING_REMOTE_READINESS',
      draftId: 'draft-remote',
    });
    expect(nativeInput).toMatchObject({
      draft_id: 'draft-remote',
      draft_revision: 1,
      admission_only: true,
    });

    usePrivateMomentsStore.getState().clearPublishState();
    resolveAdmission(statusOk({
      state: 'READY_PRIVATE',
      draft_id: 'draft-remote',
    }));

    await expect(admission).resolves.toMatchObject({
      state: 'READY_PRIVATE',
      draftId: 'draft-remote',
    });
    expect(usePrivateMomentsStore.getState().publish).toEqual({ state: 'IDLE' });
  });

  it('createPost(private repost) delegates the source identity to Native', async () => {
    const authorPtid = 'ptid:author';
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
      draft_id: 'draft-private-repost',
      post_id: 'private-repost',
      projection: {
        post_id: 'private-repost',
        content_id: 'private-repost',
        generation: '1',
        author_ptid: authorPtid,
        audience_kind: 'FRIENDS',
        state: 'CONTENT_READY',
        content: {
          kind: 'REPOST',
          comment: 'quoted source',
          source_post_id: '701',
          source_author_ptid: 'ptid:source',
          source_kind: 'TEXT',
          source_text: 'public source',
        },
      },
    }));

    const id = await useMomentsStore.getState().createPost({
      kind: 'repost',
      originalPostId: '701',
      comment: 'quoted source',
      audience: create(AudienceSchema, {
        kind: Audience_Kind.FRIENDS,
      }),
      draftId: 'draft-private-repost',
      draftRevision: 2,
    });

    expect(id).toBe('private-repost');
    expect(nativeInput).toMatchObject({
      moment_kind: 'REPOST',
      text: 'quoted source',
      files: [],
      repost: { source_post_id: '701' },
    });
  });

  it('routes every remaining private subtype through the production store', async () => {
    const authorPtid = 'ptid:author';
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
    const privateAudience = create(AudienceSchema, {
      kind: Audience_Kind.FRIENDS,
    });
    const expiresAtSeconds = 4_000_000_000;
    const cases: Array<{
      draftId: string;
      draft: MomentDraft;
      projectionContent: Record<string, unknown>;
      expectedNative: Record<string, unknown>;
    }> = [
      {
        draftId: 'draft-private-video',
        draft: {
          kind: 'video',
          text: 'private video',
          audience: privateAudience,
          localFiles: [{
            intentId: 'video-source',
            filePath: '/private/video.mp4',
            previewSrc: 'asset://localhost/private/video.mp4',
          }],
        },
        projectionContent: {
          kind: 'VIDEO',
          text: 'private video',
          media: [],
        },
        expectedNative: {
          moment_kind: 'VIDEO',
          text: 'private video',
          files: [{
            intent_id: 'video-source',
            file_path: '/private/video.mp4',
          }],
        },
      },
      {
        draftId: 'draft-private-link',
        draft: {
          kind: 'link',
          text: 'private link',
          audience: privateAudience,
          link: {
            url: 'https://example.test/private',
            title: 'Private link',
            description: 'description',
          },
        },
        projectionContent: {
          kind: 'LINK',
          text: 'private link',
          url: 'https://example.test/private',
          title: 'Private link',
        },
        expectedNative: {
          moment_kind: 'LINK',
          text: 'private link',
          files: [],
          link: {
            url: 'https://example.test/private',
            title: 'Private link',
            description: 'description',
          },
        },
      },
      {
        draftId: 'draft-private-poll',
        draft: {
          kind: 'poll',
          text: 'private poll',
          audience: privateAudience,
          poll: {
            question: 'Choose one',
            options: ['First', 'Second'],
            minChoices: 1,
            maxChoices: 1,
            expiresAtSeconds,
            durationHours: 1,
            multipleChoice: false,
          },
        },
        projectionContent: {
          kind: 'POLL',
          text: 'private poll',
          question: 'Choose one',
          options: ['First', 'Second'],
          min_choices: 1,
          max_choices: 1,
          expires_at_seconds: expiresAtSeconds,
        },
        expectedNative: {
          moment_kind: 'POLL',
          text: 'private poll',
          files: [],
          poll: {
            question: 'Choose one',
            options: ['First', 'Second'],
            min_choices: 1,
            max_choices: 1,
            expires_at_seconds: expiresAtSeconds,
          },
        },
      },
      {
        draftId: 'draft-private-location',
        draft: {
          kind: 'location',
          text: 'private location',
          audience: privateAudience,
          location: {
            name: 'Central Park',
            latitude: 40.7829,
            longitude: -73.9654,
            address: 'New York',
            placeId: 'central-park',
          },
        },
        projectionContent: {
          kind: 'LOCATION',
          text: 'private location',
          name: 'Central Park',
          latitude: '40.7829',
          longitude: '-73.9654',
          address: 'New York',
        },
        expectedNative: {
          moment_kind: 'LOCATION',
          text: 'private location',
          files: [],
          location: {
            name: 'Central Park',
            latitude: 40.7829,
            longitude: -73.9654,
            address: 'New York',
            place_id: 'central-park',
          },
        },
      },
    ];

    for (const [index, item] of cases.entries()) {
      let nativeInput: Record<string, unknown> | undefined;
      enqueueMatch((cmd, args) => {
        if (cmd !== 'social_private_moment_publish') return false;
        nativeInput = (args as { input?: Record<string, unknown> }).input;
        return true;
      }, statusOk({
        state: 'PUBLISHED',
        draft_id: item.draftId,
        post_id: `private-subtype-${index}`,
        projection: {
          post_id: `private-subtype-${index}`,
          content_id: `private-subtype-${index}`,
          generation: '1',
          author_ptid: authorPtid,
          audience_kind: 'FRIENDS',
          state: 'CONTENT_READY',
          content: item.projectionContent,
        },
      }));

      const id = await useMomentsStore.getState().createPost({
        ...item.draft,
        draftId: item.draftId,
        draftRevision: 1,
      });

      expect(id).toBe(`private-subtype-${index}`);
      expect(nativeInput).toMatchObject({
        draft_id: item.draftId,
        audience: { kind: 'FRIENDS' },
        ...item.expectedNative,
      });
    }
  });

  it.each([
    {
      label: 'CIRCLE',
      kind: Audience_Kind.CIRCLE,
      target: { case: 'circleId' as const, value: 77n },
      expectedAudience: { kind: 'CIRCLE', circleId: '77' },
    },
    {
      label: 'GROUP',
      kind: Audience_Kind.GROUP,
      target: {
        case: 'groupConversationId' as const,
        value: '01J9Z7Y6M5N4P3Q2R1S0TUVWXY',
      },
      expectedAudience: {
        kind: 'GROUP',
        groupConversationId: '01J9Z7Y6M5N4P3Q2R1S0TUVWXY',
      },
    },
  ])('preserves the exact $label audience in the Native publish intent', async ({
    kind,
    target,
    expectedAudience,
  }) => {
    const authorPtid = 'ptid:author';
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
    usePrivateMomentsStore.getState().activateActor(authorPtid, 2);

    let nativeInput: Record<string, unknown> | undefined;
    enqueueMatch((cmd, args) => {
      if (cmd !== 'social_private_moment_publish') return false;
      nativeInput = (args as { input?: Record<string, unknown> }).input;
      return true;
    }, statusOk({
      state: 'PUBLISHED',
      draft_id: 'draft-targeted',
      post_id: 'targeted-post',
      projection: {
        post_id: 'targeted-post',
        content_id: 'targeted-post',
        generation: '1',
        author_ptid: authorPtid,
        audience_kind: expectedAudience.kind,
        state: 'CONTENT_READY',
        content: { kind: 'TEXT', text: 'targeted audience' },
      },
    }));

    await useMomentsStore.getState().createPost({
      kind: 'text',
      text: 'targeted audience',
      audience: create(AudienceSchema, {
        kind,
        target,
      }),
      draftId: 'draft-targeted',
      draftRevision: 1,
    });

    expect(nativeInput).toMatchObject({
      audience: expectedAudience,
      moment_kind: 'TEXT',
    });
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

  it('rejects CUSTOM_DENY(PUBLIC) at the production audience boundary', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    useSessionStore.setState({
      authenticated: true,
      currentUser: {
        actorPtid: 'ptid:author',
        name: 'author',
        email: '',
        loginMethod: 'password',
      },
    });
    usePrivateMomentsStore.getState().reset();
    usePrivateMomentsStore.getState().activateActor('ptid:author', 3);

    await expect(
      useMomentsStore.getState().createPost({
        kind: 'text',
        text: 'unsupported public deny',
        audience: create(AudienceSchema, {
          kind: Audience_Kind.CUSTOM_DENY,
          baseKind: Audience_Kind.PUBLIC,
          actorPtids: ['ptid:eve'],
        }),
        draftId: 'draft-public-deny',
        draftRevision: 1,
      }),
    ).rejects.toThrow('PRIVATE_AUDIENCE_INVALID');

    expect(invokeMock).not.toHaveBeenCalledWith(
      'social_private_moment_publish',
      expect.anything(),
    );
  });

  it('routes every non-public Moment through the Secure Content runtime', () => {
    for (const kind of [
      Audience_Kind.FRIENDS,
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
      }))).toBe(true);
    }
    expect(isPrivateMomentPost(create(PostSchema, {
      id: 'public',
      audience: create(AudienceSchema, { kind: Audience_Kind.PUBLIC }),
    }))).toBe(false);
    expect(isPrivateMomentPost(create(PostSchema, {
      id: 'unspecified',
      audience: create(AudienceSchema, {
        kind: Audience_Kind.KIND_UNSPECIFIED,
      }),
    }))).toBe(false);
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
          mentions: [],
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

  it('retains a typed revocation tombstone after Native material is purged', async () => {
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
          mentions: [],
          content: { kind: 'TEXT', text: 'private' },
        },
      },
    });
    enqueue('social_private_moment_purge', statusOk({ ok: true }));

    await usePrivateMomentsStore.getState().revokeMoment(
      'private-post',
      'RECIPIENT_BLOCKED',
    );

    expect(usePrivateMomentsStore.getState().postsById['private-post']).toMatchObject({
      state: 'DELETED_OR_REVOKED',
      revocationReason: 'RECIPIENT_BLOCKED',
      content: undefined,
      errorCode: 'SOCIAL_PRIVATE_RECIPIENT_BLOCKED',
    });
    await usePrivateMomentsStore.getState().readMoment('private-post');
    await usePrivateMomentsStore.getState().recoverMoment('private-post');
    await usePrivateMomentsStore.getState().openMedia(
      'private-post',
      'object-stale',
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);
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
          mentions: [],
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
          plaintext_sha256: 'a'.repeat(64),
          plaintext_size: 13,
          mime_type: 'image/jpeg',
        }],
      },
    });

    expect(projection.content?.kind).toBe('IMAGE');
    if (projection.content?.kind !== 'IMAGE') return;
    expect(projection.content.media[0]?.renderUrl).toBe(
      'private-media://localhost/01ARZ3NDEKTSV4RRFFQ69G5FAV',
    );
    expect(projection.content.media[0]?.plaintextSha256).toBe('a'.repeat(64));
    expect(projection.content.media[0]?.plaintextSize).toBe(13);
  });

  it('rejects ready private media without Native-verified plaintext evidence', () => {
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
          render_url: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
          mime_type: 'image/jpeg',
        }],
      },
    })).toThrow('ready private media projection is incomplete');
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
          mentions: [],
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

  it('keeps verified content visible while a remote source retry is pending', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    usePrivateMomentsStore.getState().reset();
    usePrivateMomentsStore.getState().activateActor('ptid:viewer', 5);
    enqueue('social_private_moment_read', statusOk({
      post_id: 'post-private-offline',
      content_id: 'post-private-offline',
      generation: '1',
      author_ptid: 'ptid:author',
      audience_kind: 'FRIENDS',
      state: 'REMOTE_SOURCE_UNAVAILABLE',
      error_code: 'REMOTE_SOURCE_UNAVAILABLE',
      content: {
        kind: 'TEXT',
        text: 'verified offline content',
      },
    }));

    await usePrivateMomentsStore.getState().readMoment('post-private-offline');
    const privateProjection =
      usePrivateMomentsStore.getState().postsById['post-private-offline'];
    expect(privateProjection?.content).toEqual({
      kind: 'TEXT',
      text: 'verified offline content',
    });

    useMomentsStore.getState().hydratePrivateMoments([privateProjection!]);
    expect(useMomentsStore.getState().feeds.home.postIds)
      .toContain('post-private-offline');
  });

  it('refreshes Native private content and comments for a direct-link detail', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    usePrivateMomentsStore.getState().reset();
    usePrivateMomentsStore.getState().activateActor('ptid:viewer', 6);
    usePrivateCommentsStore.getState().activateActor('ptid:viewer', 6);
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
    enqueue('social_private_comments_list', statusOk({
      post_id: 'post-private-direct',
      comments: [{
        comment_id: 'comment-private-direct',
        content_id: 'comment-private-direct',
        generation: '1',
        post_id: 'post-private-direct',
        reply_to_comment_id: '',
        author_ptid: 'ptid:author',
        state: 'COMMENT_POSTED',
        text: 'verified private reply',
        reactions_count: 0,
        replies_count: 0,
      }],
      next_cursor: '',
      has_more: false,
    }));

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
    expect(
      selectPrivateCommentThread(
        usePrivateCommentsStore.getState(),
        'post-private-direct',
      ).comments[0]?.text,
    ).toBe('verified private reply');
    expect(invokeMock).toHaveBeenCalledWith(
      'social_private_comments_list',
      expect.objectContaining({
        input: expect.objectContaining({
          post_id: 'post-private-direct',
          limit: 20,
        }),
      }),
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
          mentions: [],
          content: {
            kind: 'IMAGE',
            text: 'secret',
            media: [{
              objectId: 'object-1',
              state: 'MEDIA_READY',
              accessPath: 'HOME_STATION_LOCAL_OBJECT',
              retryable: false,
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

  it('restores only the newest revision for a reused private Comment draft ID', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    usePrivateCommentsStore.getState().activateActor('ptid:viewer', 12);
    enqueue('social_private_comments_bootstrap', statusOk({
      actor_ptid: 'ptid:viewer',
      device_id: 'device-1',
      session_generation: '9',
      drafts: [
        {
          draft_id: 'draft-reused',
          draft_revision: 2,
          post_id: 'private-post',
          reply_to_comment_id: '',
          text: 'newest text',
          state: 'COMMENT_RATE_LIMITED',
          retry_after_seconds: 15,
        },
        {
          draft_id: 'draft-reused',
          draft_revision: 1,
          post_id: 'private-post',
          reply_to_comment_id: '',
          text: 'stale text',
          state: 'COMMENT_FAILED',
        },
      ],
      comments: [],
    }));

    await usePrivateCommentsStore.getState().bootstrap(12);

    expect(selectPrivateCommentDraft(
      usePrivateCommentsStore.getState(),
      'private-post',
    )).toMatchObject({
      draftId: 'draft-reused',
      draftRevision: 2,
      text: 'newest text',
      state: 'COMMENT_RATE_LIMITED',
      retryAfterSeconds: 15,
    });
  });

  it('does not let a late bootstrap overwrite a newer local private Comment state', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    const draftId = '00000000-0000-4000-8000-000000000005';
    const mentions = [{
      actorPtid: 'ptid:bob',
      offset: 0,
      length: 5,
      display: 'newer',
    }];
    vi.stubGlobal('crypto', { randomUUID: () => draftId });
    let resolveBootstrap: ((value: ReturnType<typeof statusOk>) => void) | undefined;
    const bootstrapResponse = new Promise<ReturnType<typeof statusOk>>((resolve) => {
      resolveBootstrap = resolve;
    });
    usePrivateCommentsStore.getState().activateActor('ptid:viewer', 16);
    enqueue('social_private_comments_bootstrap', bootstrapResponse);
    const pendingBootstrap = usePrivateCommentsStore.getState().bootstrap(16);
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'social_private_comments_bootstrap',
        expect.anything(),
      );
    });
    enqueue('social_private_comment_stage', statusOk({
      draft_id: draftId,
      draft_revision: 1,
      post_id: 'private-post',
      reply_to_comment_id: '',
      text: 'newer local text',
      mentions: [{
        actor_ptid: 'ptid:bob',
        offset: 0,
        length: 5,
        display: 'newer',
      }],
      state: 'COMMENT_EDITING',
    }));
    enqueue('social_private_comment_prepare', statusOk({
      draft_id: draftId,
      draft_revision: 1,
      post_id: 'private-post',
      reply_to_comment_id: '',
      text: 'newer local text',
      mentions: [{
        actor_ptid: 'ptid:bob',
        offset: 0,
        length: 5,
        display: 'newer',
      }],
      state: 'COMMENT_SUBMITTING',
      publication_state: 'PENDING_PUBLICATION',
    }));
    enqueue('social_private_comment_submit', statusOk({
      draft: {
        draft_id: draftId,
        draft_revision: 1,
        post_id: 'private-post',
        reply_to_comment_id: '',
        text: '',
        state: 'COMMENT_POSTED',
        comment_id: 'private-comment',
        publication_state: 'PUBLISHED',
      },
      comment: {
        comment_id: 'private-comment',
        content_id: 'private-comment',
        generation: '1',
        post_id: 'private-post',
        reply_to_comment_id: '',
        author_ptid: 'ptid:viewer',
        state: 'COMMENT_POSTED',
        text: 'newer local text',
        mentions: [{
          actor_ptid: 'ptid:bob',
          offset: 0,
          length: 5,
          display: 'newer',
        }],
        reactions_count: 0,
        replies_count: 0,
      },
    }));

    await usePrivateCommentsStore.getState().submitComment(
      'private-post',
      'newer local text',
      undefined,
      mentions,
    );
    expect(invokeMock).toHaveBeenCalledWith(
      'social_private_comment_stage',
      {
        input: expect.objectContaining({
          mentions: [{
            actor_ptid: 'ptid:bob',
            offset: 0,
            length: 5,
            display: 'newer',
          }],
        }),
      },
    );
    resolveBootstrap?.(statusOk({
      actor_ptid: 'ptid:viewer',
      device_id: 'device-1',
      session_generation: '10',
      drafts: [{
        draft_id: 'stale-bootstrap-draft',
        draft_revision: 4,
        post_id: 'private-post',
        reply_to_comment_id: '',
        text: 'stale bootstrap plaintext',
        state: 'COMMENT_EDITING',
      }],
      comments: [],
    }));
    await pendingBootstrap;

    expect(selectPrivateCommentDraft(
      usePrivateCommentsStore.getState(),
      'private-post',
    )).toBeUndefined();
    expect(usePrivateCommentsStore.getState().draftsById[draftId]).toMatchObject({
      state: 'COMMENT_POSTED',
      text: '',
      publicationState: 'PUBLISHED',
    });
    expect(
      usePrivateCommentsStore.getState().threadsByPost['private-post']?.comments[0]?.mentions,
    ).toEqual(mentions);
    expect(
      usePrivateCommentsStore.getState().activeDraftByPost['private-post'],
    ).toBeUndefined();
  });

  it('paginates via per-post cursor', async () => {
    enqueueMatch(
      (cmd, args) => cmd === 'social_get_comments'
        && (args as { input?: { limit?: number } })?.input?.limit === 20,
      bytesOk(ListMomentCommentsResponseSchema, {
        comments: [{
          metadata: {
            commentId: 'c1',
            contentId: 'c1',
            postId: 'p1',
            author: { ptid: 'ptid:a', acct: 'a@example.com' },
          },
          body: { case: 'publicContent', value: { text: 'a' } },
        }],
        nextCursor: 'cc1',
        hasMore: true,
      }),
    );
    enqueueMatch(
      (cmd, args) => cmd === 'social_get_comments'
        && (args as { input?: { cursor?: string; limit?: number } })?.input?.cursor === 'cc1'
        && (args as { input?: { cursor?: string; limit?: number } })?.input?.limit === 20,
      bytesOk(ListMomentCommentsResponseSchema, {
        comments: [
          {
            metadata: {
              commentId: 'c1',
              contentId: 'c1',
              postId: 'p1',
              author: { ptid: 'ptid:a', acct: 'a@example.com' },
            },
            body: { case: 'publicContent', value: { text: 'a' } },
          },
          {
            metadata: {
              commentId: 'c2',
              contentId: 'c2',
              postId: 'p1',
              author: { ptid: 'ptid:b', acct: 'b@example.com' },
            },
            body: { case: 'publicContent', value: { text: 'b' } },
          },
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

  it('decrypts private Comment pages through Native and keeps projections separate', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    usePrivateCommentsStore.getState().activateActor('ptid:viewer', 12);
    enqueue('social_private_comments_list', statusOk({
      post_id: 'private-post',
      comments: [{
        comment_id: 'private-comment',
        content_id: 'private-comment',
        generation: '3',
        post_id: 'private-post',
        reply_to_comment_id: '',
        author_ptid: 'ptid:author',
        author_acct: 'author@example.com',
        state: 'COMMENT_POSTED',
        text: 'verified plaintext',
        reactions_count: 2,
        replies_count: 0,
      }],
      next_cursor: 'private-cursor',
      has_more: true,
    }));

    await usePrivateCommentsStore.getState().loadComments('private-post', true);

    const thread = selectPrivateCommentThread(
      usePrivateCommentsStore.getState(),
      'private-post',
    );
    expect(thread.comments).toEqual([
      expect.objectContaining({
        commentId: 'private-comment',
        text: 'verified plaintext',
        state: 'COMMENT_POSTED',
      }),
    ]);
    expect(thread.nextCursor).toBe('private-cursor');
    expect(thread.hasMore).toBe(true);
  });

  it('retains a rate-limited private draft and retries the same Native identity', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    const draftId = '00000000-0000-4000-8000-000000000001';
    vi.stubGlobal('crypto', { randomUUID: () => draftId });
    usePrivateCommentsStore.getState().activateActor('ptid:viewer', 13);
    enqueue('social_private_comment_stage', statusOk({
      draft_id: draftId,
      draft_revision: 1,
      post_id: 'private-post',
      reply_to_comment_id: '',
      text: 'keep this text',
      state: 'COMMENT_EDITING',
    }));
    enqueue('social_private_comment_prepare', statusOk({
      draft_id: draftId,
      draft_revision: 1,
      post_id: 'private-post',
      reply_to_comment_id: '',
      text: 'keep this text',
      state: 'COMMENT_SUBMITTING',
    }));
    enqueue('social_private_comment_submit', {
      ok: false,
      error: {
        code: 'INVALID_ARGUMENT',
        message: 'rate limited',
        details: {
          state: 'COMMENT_RATE_LIMITED',
          native_error_code: 'COMMENT_RATE_LIMITED',
          retry_after_seconds: 9,
          retry_not_before_unix_ms: 20_000,
        },
      },
    });
    vi.spyOn(Date, 'now').mockReturnValue(10_000);

    await expect(
      usePrivateCommentsStore.getState().submitComment(
        'private-post',
        'keep this text',
      ),
    ).rejects.toThrow('rate limited');

    const retained = selectPrivateCommentDraft(
      usePrivateCommentsStore.getState(),
      'private-post',
    );
    expect(retained).toMatchObject({
      draftId,
      draftRevision: 1,
      text: 'keep this text',
      state: 'COMMENT_RATE_LIMITED',
      retryAfterSeconds: 9,
      retryNotBeforeUnixMs: 20_000,
    });

    const callsBeforeEarlyRetry = invokeMock.mock.calls.length;
    await expect(
      usePrivateCommentsStore.getState().retryComment('private-post'),
    ).rejects.toThrow('COMMENT_RATE_LIMITED');
    expect(invokeMock.mock.calls).toHaveLength(callsBeforeEarlyRetry);
    vi.mocked(Date.now).mockReturnValue(20_000);
    enqueueMatch(
      (cmd, args) => {
        const input = (args as {
          input?: { draft_id?: string; draft_revision?: number };
        })?.input;
        return cmd === 'social_private_comment_prepare'
          && input?.draft_id === draftId
          && input?.draft_revision === 1;
      },
      statusOk({
        draft_id: draftId,
        draft_revision: 1,
        post_id: 'private-post',
        reply_to_comment_id: '',
        text: 'keep this text',
        state: 'COMMENT_RATE_LIMITED',
        error_code: 'COMMENT_RATE_LIMITED',
        retry_after_seconds: 9,
        retry_not_before_unix_ms: 20_000,
      }),
    );
    enqueueMatch(
      (cmd, args) => {
        const input = (args as {
          input?: { draft_id?: string; draft_revision?: number };
        })?.input;
        return cmd === 'social_private_comment_submit'
          && input?.draft_id === draftId
          && input?.draft_revision === 1;
      },
      statusOk({
        draft: {
          draft_id: draftId,
          draft_revision: 1,
          post_id: 'private-post',
          reply_to_comment_id: '',
          text: '',
          state: 'COMMENT_POSTED',
          comment_id: 'private-comment',
        },
        comment: {
          comment_id: 'private-comment',
          content_id: 'private-comment',
          generation: '1',
          post_id: 'private-post',
          reply_to_comment_id: '',
          author_ptid: 'ptid:viewer',
          state: 'COMMENT_POSTED',
          text: 'keep this text',
          reactions_count: 0,
          replies_count: 0,
        },
      }),
    );

    await usePrivateCommentsStore.getState().retryComment('private-post');

    expect(selectPrivateCommentDraft(
      usePrivateCommentsStore.getState(),
      'private-post',
    )).toBeUndefined();
    expect(
      selectPrivateCommentThread(
        usePrivateCommentsStore.getState(),
        'private-post',
      ).comments[0]?.text,
    ).toBe('keep this text');
  });

  it('reconciles a committed private Comment without plaintext or republication', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    const draftId = '00000000-0000-4000-8000-000000000003';
    usePrivateCommentsStore.getState().activateActor('ptid:viewer', 14);
    enqueue('social_private_comments_bootstrap', statusOk({
      actor_ptid: 'ptid:viewer',
      device_id: 'device-1',
      session_generation: '10',
      drafts: [{
        draft_id: draftId,
        draft_revision: 4,
        post_id: 'private-post',
        reply_to_comment_id: '',
        text: '',
        state: 'COMMENT_FAILED',
        comment_id: 'private-comment',
        error_code: 'COMMENT_READBACK_PENDING',
        retry_after_seconds: 10,
        retry_not_before_unix_ms: 20_000,
        publication_state: 'COMMITTED_PENDING_READBACK',
      }],
      comments: [],
    }));
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    await usePrivateCommentsStore.getState().bootstrap(14);

    expect(selectPrivateCommentDraft(
      usePrivateCommentsStore.getState(),
      'private-post',
    )).toMatchObject({
      draftId,
      draftRevision: 4,
      text: '',
      state: 'COMMENT_FAILED',
      retryNotBeforeUnixMs: 20_000,
      publicationState: 'COMMITTED_PENDING_READBACK',
    });

    const callsBeforeEarlyReadback = invokeMock.mock.calls.length;
    await expect(
      usePrivateCommentsStore.getState().retryComment('private-post'),
    ).rejects.toThrow('COMMENT_RATE_LIMITED');
    expect(invokeMock.mock.calls).toHaveLength(callsBeforeEarlyReadback);
    vi.mocked(Date.now).mockReturnValue(20_000);
    enqueueMatch(
      (cmd, args) => {
        const input = (args as {
          input?: { draft_id?: string; draft_revision?: number };
        })?.input;
        return cmd === 'social_private_comment_submit'
          && input?.draft_id === draftId
          && input?.draft_revision === 4;
      },
      statusOk({
        draft: {
          draft_id: draftId,
          draft_revision: 4,
          post_id: 'private-post',
          reply_to_comment_id: '',
          text: '',
          state: 'COMMENT_POSTED',
          comment_id: 'private-comment',
          publication_state: 'PUBLISHED',
        },
        comment: {
          comment_id: 'private-comment',
          content_id: 'private-comment',
          generation: '1',
          post_id: 'private-post',
          reply_to_comment_id: '',
          author_ptid: 'ptid:viewer',
          state: 'COMMENT_POSTED',
          text: 'already committed',
          reactions_count: 0,
          replies_count: 0,
        },
      }),
    );

    await usePrivateCommentsStore.getState().retryComment('private-post');

    const publicationCommands = invokeMock.mock.calls
      .map(([command]) => command)
      .filter((command) => [
        'social_private_comment_stage',
        'social_private_comment_prepare',
        'social_private_comment_submit',
      ].includes(command));
    expect(publicationCommands).toEqual(['social_private_comment_submit']);
    expect(selectPrivateCommentDraft(
      usePrivateCommentsStore.getState(),
      'private-post',
    )).toBeUndefined();
    expect(
      selectPrivateCommentThread(
        usePrivateCommentsStore.getState(),
        'private-post',
      ).comments[0]?.text,
    ).toBe('already committed');
  });

  it('blocks private Comment retry after the parent becomes unavailable', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    const draftId = '00000000-0000-4000-8000-000000000006';
    usePrivateCommentsStore.getState().activateActor('ptid:viewer', 17);
    enqueue('social_private_comments_bootstrap', statusOk({
      actor_ptid: 'ptid:viewer',
      device_id: 'device-1',
      session_generation: '11',
      drafts: [{
        draft_id: draftId,
        draft_revision: 1,
        post_id: 'private-post',
        reply_to_comment_id: '',
        text: 'retained text',
        state: 'COMMENT_FAILED',
        error_code: 'COMMENT_SUBMIT_FAILED',
        publication_state: 'PENDING_PUBLICATION',
      }],
      comments: [],
    }));
    await usePrivateCommentsStore.getState().bootstrap(17);
    let resolveList: ((value: ReturnType<typeof statusOk>) => void) | undefined;
    const listResponse = new Promise<ReturnType<typeof statusOk>>((resolve) => {
      resolveList = resolve;
    });
    enqueue('social_private_comments_list', listResponse);
    const pendingList = usePrivateCommentsStore.getState().loadComments(
      'private-post',
      true,
    );
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'social_private_comments_list',
        expect.anything(),
      );
    });
    usePrivateCommentsStore.getState().markParentUnavailable(
      'private-post',
      'COMMENT_PARENT_UNAVAILABLE',
    );
    resolveList?.(statusOk({
      post_id: 'private-post',
      comments: [{
        comment_id: 'stale-comment',
        content_id: 'stale-comment',
        generation: '1',
        post_id: 'private-post',
        reply_to_comment_id: '',
        author_ptid: 'ptid:viewer',
        state: 'COMMENT_POSTED',
        text: 'stale list result',
        reactions_count: 0,
        replies_count: 0,
      }],
      next_cursor: '',
      has_more: false,
    }));
    await pendingList;

    const callsBeforeRetry = invokeMock.mock.calls.length;
    await expect(
      usePrivateCommentsStore.getState().retryComment('private-post'),
    ).rejects.toThrow('COMMENT_PARENT_UNAVAILABLE');
    expect(invokeMock.mock.calls).toHaveLength(callsBeforeRetry);
    expect(selectPrivateCommentThread(
      usePrivateCommentsStore.getState(),
      'private-post',
    )).toMatchObject({
      comments: [],
      state: 'COMMENT_PARENT_UNAVAILABLE',
      errorCode: 'COMMENT_PARENT_UNAVAILABLE',
    });
  });

  it('preserves parent-unavailable after a late private Comment list failure', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    usePrivateCommentsStore.getState().activateActor('ptid:viewer', 18);
    let rejectList: ((reason: Error) => void) | undefined;
    const listResponse = new Promise<never>((_resolve, reject) => {
      rejectList = reject;
    });
    enqueue('social_private_comments_list', listResponse);
    const pendingList = usePrivateCommentsStore.getState().loadComments(
      'private-post',
      true,
    );
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'social_private_comments_list',
        expect.anything(),
      );
    });
    usePrivateCommentsStore.getState().markParentUnavailable(
      'private-post',
      'COMMENT_PARENT_UNAVAILABLE',
    );
    rejectList?.(new Error('late list failure'));

    await expect(pendingList).rejects.toThrow('late list failure');
    expect(selectPrivateCommentThread(
      usePrivateCommentsStore.getState(),
      'private-post',
    )).toMatchObject({
      comments: [],
      loading: false,
      state: 'COMMENT_PARENT_UNAVAILABLE',
      errorCode: 'COMMENT_PARENT_UNAVAILABLE',
    });
  });

  it('rejects a concurrent private Comment revision before another Native call', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    const draftId = '00000000-0000-4000-8000-000000000004';
    vi.stubGlobal('crypto', { randomUUID: () => draftId });
    let resolveStage: ((value: ReturnType<typeof statusOk>) => void) | undefined;
    const stageResponse = new Promise<ReturnType<typeof statusOk>>((resolve) => {
      resolveStage = resolve;
    });
    usePrivateCommentsStore.getState().activateActor('ptid:viewer', 15);
    enqueue('social_private_comment_stage', stageResponse);
    enqueue('social_private_comment_prepare', statusOk({
      draft_id: draftId,
      draft_revision: 1,
      post_id: 'private-post',
      reply_to_comment_id: '',
      text: 'one submission',
      state: 'COMMENT_SUBMITTING',
    }));
    enqueue('social_private_comment_submit', statusOk({
      draft: {
        draft_id: draftId,
        draft_revision: 1,
        post_id: 'private-post',
        reply_to_comment_id: '',
        text: '',
        state: 'COMMENT_POSTED',
        comment_id: 'private-comment',
      },
      comment: {
        comment_id: 'private-comment',
        content_id: 'private-comment',
        generation: '1',
        post_id: 'private-post',
        reply_to_comment_id: '',
        author_ptid: 'ptid:viewer',
        state: 'COMMENT_POSTED',
        text: 'one submission',
        reactions_count: 0,
        replies_count: 0,
      },
    }));

    const pendingSubmit = usePrivateCommentsStore.getState().submitComment(
      'private-post',
      'one submission',
    );
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'social_private_comment_stage',
        expect.anything(),
      );
    });
    const callsBeforeConcurrentSubmit = invokeMock.mock.calls.length;
    await expect(
      usePrivateCommentsStore.getState().submitComment(
        'private-post',
        'one submission',
      ),
    ).rejects.toThrow('COMMENT_BUSY');
    expect(invokeMock.mock.calls).toHaveLength(callsBeforeConcurrentSubmit);

    resolveStage?.(statusOk({
      draft_id: draftId,
      draft_revision: 1,
      post_id: 'private-post',
      reply_to_comment_id: '',
      text: 'one submission',
      state: 'COMMENT_EDITING',
    }));
    await pendingSubmit;
  });

  it('drops a stale private Comment prepare before submit after actor switch', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    const draftId = '00000000-0000-4000-8000-000000000002';
    vi.stubGlobal('crypto', { randomUUID: () => draftId });
    let resolvePrepare: ((value: ReturnType<typeof statusOk>) => void) | undefined;
    const prepareResponse = new Promise<ReturnType<typeof statusOk>>((resolve) => {
      resolvePrepare = resolve;
    });
    usePrivateCommentsStore.getState().activateActor('ptid:alice', 21);
    enqueue('social_private_comment_stage', statusOk({
      draft_id: draftId,
      draft_revision: 1,
      post_id: 'private-post',
      reply_to_comment_id: '',
      text: 'alice plaintext',
      state: 'COMMENT_EDITING',
    }));
    enqueue('social_private_comment_prepare', prepareResponse);

    const pendingSubmit = usePrivateCommentsStore.getState().submitComment(
      'private-post',
      'alice plaintext',
    );
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'social_private_comment_prepare',
        expect.anything(),
      );
    });
    usePrivateCommentsStore.getState().activateActor('ptid:bob', 22);
    resolvePrepare?.(statusOk({
      draft_id: draftId,
      draft_revision: 1,
      post_id: 'private-post',
      reply_to_comment_id: '',
      text: 'alice plaintext',
      state: 'COMMENT_SUBMITTING',
    }));
    await pendingSubmit;

    expect(invokeMock).not.toHaveBeenCalledWith(
      'social_private_comment_submit',
      expect.anything(),
    );
    expect(usePrivateCommentsStore.getState().scope.actorPtid).toBe('ptid:bob');
    expect(usePrivateCommentsStore.getState().draftsById).toEqual({});
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

  it('routes a private Reaction through Native and hydrates the source summary', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    usePrivateMomentsStore.getState().activateActor('ptid:viewer', 31);
    usePrivateMomentsStore.setState({
      postsById: {
        'private-reaction-post': {
          postId: 'private-reaction-post',
          contentId: 'private-reaction-post',
          generation: '1',
          authorPtid: 'ptid:author',
          audienceKind: 'FRIENDS',
          state: 'CONTENT_READY',
          mentions: [],
          reactions: [],
          reactionRevision: '1',
          reactionsHydrated: true,
          content: { kind: 'TEXT', text: 'private' },
        },
      },
    });
    useMomentsStore.setState({
      postsById: {
        'private-reaction-post': create(PostSchema, {
          id: 'private-reaction-post',
          audience: create(AudienceSchema, { kind: Audience_Kind.FRIENDS }),
        }),
      },
    });
    enqueue('social_private_react', statusOk({
      command: {
        command_id: 'reaction-v1-1',
        post_id: 'private-reaction-post',
        kind: ReactionKind.REACTION_LIKE,
        operation: 'REACT',
        state: 'REACTION_COMMITTED',
        attempt_count: 1,
        projection_revision: '2',
      },
      reactions: [{
        kind: ReactionKind.REACTION_LIKE,
        count: '1',
        reacted_by_viewer: true,
      }],
      projection_revision: '2',
      exact_replay: false,
    }));

    await useMomentsStore
      .getState()
      .reactToPost('private-reaction-post', ReactionKind.REACTION_LIKE);

    expect(invokeMock).toHaveBeenCalledWith(
      'social_private_react',
      expect.objectContaining({
        input: expect.objectContaining({
          post_id: 'private-reaction-post',
          kind: ReactionKind.REACTION_LIKE,
        }),
      }),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      'social_react',
      expect.anything(),
    );
    expect(
      useMomentsStore.getState().reactions['private-reaction-post']?.[0],
    ).toMatchObject({
      count: 1n,
      reactedByViewer: true,
    });
  });

  it('preserves known reactions until the private projection is hydrated', () => {
    usePrivateMomentsStore.getState().activateActor('ptid:viewer', 34);
    useMomentsStore.setState({
      postsById: {
        'private-unhydrated-post': create(PostSchema, {
          id: 'private-unhydrated-post',
          audience: create(AudienceSchema, { kind: Audience_Kind.FRIENDS }),
          reactions: [{
            kind: ReactionKind.REACTION_LOVE,
            count: 2n,
            reactedByViewer: true,
          }],
        }),
      },
      reactions: {
        'private-unhydrated-post': [create(ReactionSummarySchema, {
          kind: ReactionKind.REACTION_LOVE,
          count: 2n,
          reactedByViewer: true,
        })],
      },
    });

    useMomentsStore.getState().hydratePrivateMoments([{
      postId: 'private-unhydrated-post',
      contentId: 'private-unhydrated-post',
      generation: '1',
      authorPtid: 'ptid:author',
      audienceKind: 'FRIENDS',
      state: 'CONTENT_READY',
      mentions: [],
      reactions: [],
      reactionRevision: '0',
      reactionsHydrated: false,
      content: { kind: 'TEXT', text: 'private' },
    }]);

    expect(
      useMomentsStore.getState().reactions['private-unhydrated-post']?.[0],
    ).toMatchObject({
      kind: ReactionKind.REACTION_LOVE,
      count: 2n,
      reactedByViewer: true,
    });
    expect(
      useMomentsStore.getState().postsById['private-unhydrated-post']?.reactions[0],
    ).toMatchObject({
      kind: ReactionKind.REACTION_LOVE,
      count: 2n,
      reactedByViewer: true,
    });
  });

  it('retries an unknown private Reaction with its durable command ID', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    usePrivateMomentsStore.getState().activateActor('ptid:viewer', 32);
    usePrivateMomentsStore.setState({
      postsById: {
        'private-retry-post': {
          postId: 'private-retry-post',
          contentId: 'private-retry-post',
          generation: '1',
          authorPtid: 'ptid:author',
          audienceKind: 'FRIENDS',
          state: 'CONTENT_READY',
          mentions: [],
          reactions: [],
          reactionRevision: '1',
          reactionsHydrated: true,
          content: { kind: 'TEXT', text: 'private' },
        },
      },
    });
    useMomentsStore.setState({
      postsById: {
        'private-retry-post': create(PostSchema, {
          id: 'private-retry-post',
          audience: create(AudienceSchema, { kind: Audience_Kind.FRIENDS }),
        }),
      },
    });
    enqueue('social_private_react', statusOk({
      command: {
        command_id: 'reaction-v1-stable',
        post_id: 'private-retry-post',
        kind: ReactionKind.REACTION_LOVE,
        operation: 'REACT',
        state: 'REACTION_PENDING',
        attempt_count: 1,
        projection_revision: '1',
        error_code: 'REACTION_RESULT_UNKNOWN',
      },
      reactions: [],
      projection_revision: '1',
      exact_replay: false,
    }));
    await useMomentsStore
      .getState()
      .reactToPost('private-retry-post', ReactionKind.REACTION_LOVE);
    expect(
      usePrivateMomentsStore.getState().reactionsByPost['private-retry-post'],
    ).toMatchObject({
      commandId: 'reaction-v1-stable',
      state: 'REACTION_PENDING',
    });

    enqueue('social_private_reaction_retry', statusOk({
      command: {
        command_id: 'reaction-v1-stable',
        post_id: 'private-retry-post',
        kind: ReactionKind.REACTION_LOVE,
        operation: 'REACT',
        state: 'REACTION_COMMITTED',
        attempt_count: 2,
        projection_revision: '2',
      },
      reactions: [{
        kind: ReactionKind.REACTION_LOVE,
        count: '1',
        reacted_by_viewer: true,
      }],
      projection_revision: '2',
      exact_replay: true,
    }));
    const retried = await usePrivateMomentsStore
      .getState()
      .retryReaction('private-retry-post');

    expect(retried.exactReplay).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith(
      'social_private_reaction_retry',
      expect.objectContaining({
        input: expect.objectContaining({
          command_id: 'reaction-v1-stable',
        }),
      }),
    );
    expect(
      usePrivateMomentsStore.getState().reactionsByPost['private-retry-post'],
    ).toBeUndefined();
  });

  it('does not let a late bootstrap resurrect an older private Reaction command', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    usePrivateMomentsStore.getState().activateActor('ptid:viewer', 35);
    usePrivateMomentsStore.setState({
      scope: {
        actorPtid: 'ptid:viewer',
        rendererGeneration: 35,
        nativeSessionGeneration: '8',
      },
      postsById: {
        'private-bootstrap-reaction': {
          postId: 'private-bootstrap-reaction',
          contentId: 'private-bootstrap-reaction',
          generation: '1',
          authorPtid: 'ptid:author',
          audienceKind: 'FRIENDS',
          state: 'CONTENT_READY',
          mentions: [],
          reactions: [],
          reactionRevision: '1',
          reactionsHydrated: true,
          content: { kind: 'TEXT', text: 'private' },
        },
      },
    });
    let resolveBootstrap: ((value: ReturnType<typeof statusOk>) => void) | undefined;
    const bootstrapResponse = new Promise<ReturnType<typeof statusOk>>((resolve) => {
      resolveBootstrap = resolve;
    });
    enqueue('social_private_moments_bootstrap', bootstrapResponse);
    const pendingBootstrap = usePrivateMomentsStore.getState().bootstrap(35);
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'social_private_moments_bootstrap',
        expect.anything(),
      );
    });
    enqueue('social_private_react', statusOk({
      command: {
        command_id: 'reaction-v1-new',
        post_id: 'private-bootstrap-reaction',
        kind: ReactionKind.REACTION_LIKE,
        operation: 'REACT',
        state: 'REACTION_COMMITTED',
        attempt_count: 1,
        projection_revision: '2',
      },
      reactions: [{
        kind: ReactionKind.REACTION_LIKE,
        count: '1',
        reacted_by_viewer: true,
      }],
      projection_revision: '2',
      exact_replay: false,
    }));
    await usePrivateMomentsStore
      .getState()
      .reactToPost('private-bootstrap-reaction', ReactionKind.REACTION_LIKE);

    resolveBootstrap?.(statusOk({
      actor_ptid: 'ptid:viewer',
      device_id: 'device-1',
      session_generation: '9',
      projections: [{
        post_id: 'private-bootstrap-reaction',
        content_id: 'private-bootstrap-reaction',
        generation: '1',
        author_ptid: 'ptid:author',
        audience_kind: 'FRIENDS',
        state: 'CONTENT_READY',
        reactions: [],
        reaction_revision: '1',
        reactions_hydrated: true,
        content: { kind: 'TEXT', text: 'private' },
      }],
      reaction_commands: [{
        command_id: 'reaction-v1-old',
        post_id: 'private-bootstrap-reaction',
        kind: ReactionKind.REACTION_LOVE,
        operation: 'REACT',
        state: 'REACTION_PENDING',
        attempt_count: 1,
        projection_revision: '1',
      }],
    }));
    await pendingBootstrap;

    expect(
      usePrivateMomentsStore.getState().reactionsByPost['private-bootstrap-reaction'],
    ).toBeUndefined();
    expect(
      usePrivateMomentsStore.getState().postsById['private-bootstrap-reaction']
        ?.reactionRevision,
    ).toBe('2');
  });

  it('rejects duplicate private Reaction command histories from Native', async () => {
    installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    usePrivateMomentsStore.getState().activateActor('ptid:viewer', 33);
    enqueue('social_private_moments_bootstrap', statusOk({
      actor_ptid: 'ptid:viewer',
      device_id: 'device-1',
      session_generation: '9',
      projections: [],
      reaction_commands: [
        {
          command_id: 'reaction-v1-new',
          post_id: 'private-history-post',
          kind: ReactionKind.REACTION_LIKE,
          operation: 'REACT',
          state: 'REACTION_COMMITTED',
          attempt_count: 2,
          projection_revision: '4',
        },
        {
          command_id: 'reaction-v1-old',
          post_id: 'private-history-post',
          kind: ReactionKind.REACTION_LIKE,
          operation: 'REACT',
          state: 'REACTION_REJECTED',
          attempt_count: 1,
          projection_revision: '1',
          error_code: 'REACTION_REJECTED',
        },
      ],
    }));

    await expect(
      usePrivateMomentsStore.getState().bootstrap(33),
    ).rejects.toMatchObject({
      code: 'PRIVATE_PROJECTION_INVALID',
    });
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
  it('retries a failed native bootstrap on the periodic reconciliation tick', async () => {
    const intervalCallbacks = installEventWindowStub();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    useSessionStore.setState({
      authenticated: true,
      currentUser: {
        actorPtid: 'ptid:viewer',
        name: 'Viewer',
        email: '',
        loginMethod: 'password',
      },
      restoring: false,
      sessionEpoch: 9,
    });
    enqueue('social_private_moments_bootstrap', {
      ok: false,
      error: {
        code: 'PRIVATE_NATIVE_COMMAND_FAILED',
        message: 'secure content supervisor is not active',
      },
    });

    momentsRuntime.install();

    await vi.waitFor(() => {
      expect(invokeMock.mock.calls.filter(
        ([command]) => command === 'social_private_moments_bootstrap',
      )).toHaveLength(1);
    });
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'frontend_log',
        {
          input: expect.objectContaining({
            message: 'moments projection bootstrap failed',
          }),
        },
      );
    });

    enqueue('social_private_moments_bootstrap', statusOk({
      actor_ptid: 'ptid:viewer',
      device_id: 'device-1',
      session_generation: '2',
      projections: [],
    }));
    enqueue('social_private_comments_bootstrap', statusOk({
      actor_ptid: 'ptid:viewer',
      device_id: 'device-1',
      session_generation: '2',
      drafts: [],
      comments: [],
    }));
    enqueue('actor_get_my_profile', dataOk({
      id: 'viewer',
      displayName: 'Viewer',
      username: 'viewer',
      avatar: '',
    }));
    enqueue('social_sync_moments_projection',
      bytesOk(SyncMomentsProjectionResponseSchema, {
        homeTimeline: { posts: [], nextCursor: '', hasMore: false },
        publicTimeline: { posts: [], nextCursor: '', hasMore: false },
      }),
    );
    enqueue('social_circle_list_mine', bytesOk(ListMyCirclesResponseSchema, { circles: [] }));
    enqueue('social_private_moments_reconcile', statusOk({
      actor_ptid: 'ptid:viewer',
      device_id: 'device-1',
      session_generation: '2',
      projections: [],
    }));

    intervalCallbacks[0]?.();

    await vi.waitFor(() => {
      expect(usePrivateMomentsStore.getState().scope.nativeSessionGeneration).toBe('2');
      expect(invokeMock.mock.calls.filter(
        ([command]) => command === 'social_private_moments_bootstrap',
      )).toHaveLength(2);
    });
  });

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
