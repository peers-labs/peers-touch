import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { api } from '../../services/desktop_api';
import { Audience_Kind } from '../../gen/proto/domain/social/post_pb';

declare const __PT_SOURCE_COMMIT__: string;

const registered: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {};

const momentsState = {
  composerDraft: null as Record<string, unknown> | null,
  feeds: {
    explore: {
      postIds: [] as string[],
    },
  },
  postsById: {} as Record<string, unknown>,
  setComposerDraft: vi.fn((draft: Record<string, unknown>) => {
    momentsState.composerDraft = draft;
  }),
  clearComposerDraft: vi.fn(() => {
    momentsState.composerDraft = null;
  }),
  createPost: vi.fn(),
  loadFeed: vi.fn(),
};

const privateState = {
  platform: 'browser',
  scope: {
    actorPtid: 'ptid:test:alice',
    rendererGeneration: 9,
    nativeSessionGeneration: null as string | null,
  },
  publish: {
    state: 'IDLE',
  } as Record<string, unknown>,
  postsById: {} as Record<string, unknown>,
  readMoment: vi.fn(),
  recoverMoment: vi.fn(),
  openMedia: vi.fn(),
  clearPublishState: vi.fn(() => {
    privateState.publish = { state: 'IDLE' };
  }),
};

const privateCommentsState = {
  threadsByPost: {} as Record<string, {
    comments: Array<Record<string, unknown>>;
    errorCode?: string;
    hasMore: boolean;
    loaded: boolean;
    loading: boolean;
    nextCursor: string;
    state?: string;
  }>,
  submitComment: vi.fn(),
  loadComments: vi.fn(),
};

const sessionState = {
  sessionEpoch: 7,
  currentUser: {
    actorPtid: 'ptid:test:alice',
  } as { actorPtid: string } | null,
};

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
  }

  emitOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  emitMessage(data: string) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(Object.assign(new Event('close'), { code: 1000 }));
  }
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../../services/desktop_api', () => ({
  api: {
    federationGetSelf: vi.fn(),
    federationListFederations: vi.fn(),
    ossResolveUrl: vi.fn(),
    ossUploadEncryptedAttachmentSocial: vi.fn(),
    socialFriendRequestAccept: vi.fn(),
    socialFriendRequestList: vi.fn(),
    socialFriendRequestSend: vi.fn(),
    stationList: vi.fn(),
  },
}));

vi.mock('../../store/moments', () => ({
  useMomentsStore: {
    getState: () => momentsState,
  },
}));

vi.mock('../../store/privateMoments', () => ({
  usePrivateMomentsStore: {
    getState: () => privateState,
  },
}));

vi.mock('../../store/privateComments', () => ({
  selectPrivateCommentThread: (
    state: typeof privateCommentsState,
    postId: string,
  ) => state.threadsByPost[postId] ?? {
    comments: [],
    hasMore: false,
    loaded: false,
    loading: false,
    nextCursor: '',
  },
  usePrivateCommentsStore: {
    getState: () => privateCommentsState,
  },
}));

vi.mock('../../store/session', () => ({
  useSessionStore: {
    getState: () => sessionState,
  },
}));

vi.mock('../registry', () => ({
  registerAcceptanceHarness: (
    namespace: string,
    methods: Record<string, (...args: unknown[]) => Promise<unknown>>,
  ) => {
    registered[namespace] = methods;
  },
}));

import { installAcceptanceHarness } from './harness';

function harness() {
  const value = registered.moments;
  if (!value) throw new Error('moments harness was not registered');
  return value;
}

describe('Moments acceptance harness', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: {
        href: 'https://desktop.invalid/moments',
        origin: 'https://desktop.invalid',
      },
    });
    vi.stubGlobal('document', {
      scripts: [{ src: 'https://desktop.invalid/assets/app.js' }],
    });
    vi.stubGlobal('performance', {
      getEntriesByType: vi.fn(() => []),
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([9, 8, 7]).buffer,
    })));
    momentsState.composerDraft = null;
    momentsState.feeds.explore.postIds = [];
    momentsState.postsById = {};
    momentsState.setComposerDraft.mockClear();
    momentsState.clearComposerDraft.mockClear();
    momentsState.createPost.mockReset();
    momentsState.loadFeed.mockReset();
    privateState.platform = 'browser';
    privateState.scope = {
      actorPtid: 'ptid:test:alice',
      rendererGeneration: 9,
      nativeSessionGeneration: null,
    };
    privateState.publish = { state: 'IDLE' };
    privateState.postsById = {};
    privateState.readMoment.mockReset();
    privateState.recoverMoment.mockReset();
    privateState.openMedia.mockReset();
    privateState.clearPublishState.mockClear();
    privateCommentsState.threadsByPost = {};
    privateCommentsState.submitComment.mockReset();
    privateCommentsState.loadComments.mockReset();
    sessionState.sessionEpoch = 7;
    sessionState.currentUser = { actorPtid: 'ptid:test:alice' };
    vi.mocked(invoke).mockReset();
    vi.mocked(api.ossResolveUrl).mockReset();
    vi.mocked(api.ossUploadEncryptedAttachmentSocial).mockReset();
    vi.mocked(api.federationGetSelf).mockReset();
    vi.mocked(api.federationListFederations).mockReset();
    vi.mocked(api.socialFriendRequestAccept).mockReset();
    vi.mocked(api.socialFriendRequestList).mockReset();
    vi.mocked(api.socialFriendRequestSend).mockReset();
    vi.mocked(api.stationList).mockReset();
    vi.mocked(api.stationList).mockResolvedValue({
      active_url: 'https://station.invalid/',
      binding: {
        phase: 'bound',
        bound_url: 'https://station.invalid',
        generation: 1,
      },
      entries: [{
        url: 'https://station.invalid',
        peer_id: 'peer-station-four',
        online: true,
      }],
    });
    vi.stubGlobal('window', {
      location: new URL('http://localhost:3210/'),
    });
    vi.stubGlobal('document', {
      scripts: [{ src: 'http://localhost:3210/assets/app.js' }],
    });
    vi.stubGlobal('performance', {
      getEntriesByType: vi.fn(() => []),
      mark: vi.fn(),
    });
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('renderer bundle').buffer,
    })));
    installAcceptanceHarness();
  });

  it('creates an accepted friendship through Social authority', async () => {
    vi.mocked(api.federationGetSelf).mockResolvedValue({
      homeStationPeerId: 'station-four',
      joinedFederations: [],
    } as never);
    vi.mocked(api.federationListFederations).mockResolvedValue({
      federations: [{ federationId: 'federation-1' }],
    } as never);
    vi.mocked(api.socialFriendRequestSend).mockResolvedValue({
      request: { requestId: 'friend-request-1' },
    } as never);
    vi.mocked(api.socialFriendRequestList).mockResolvedValue({
      requests: [{
        requestId: 'friend-request-1',
        sender: { ptid: 'ptid:test:alice' },
        senderHomeStationPeerId: 'station-four',
        federationId: 'federation-1',
      }],
      total: 1,
    } as never);
    vi.mocked(api.socialFriendRequestAccept).mockResolvedValue({
      request: { requestId: 'friend-request-1' },
    } as never);

    await expect(harness().friendshipAuthority()).resolves.toEqual({
      federationId: 'federation-1',
      homeStationPeerId: 'station-four',
    });
    await expect(harness().sendFriendRequest({
      actorPtid: 'ptid:test:bob',
      federationId: 'federation-1',
      homeStationPeerId: 'station-four',
    })).resolves.toEqual({ requestId: 'friend-request-1' });
    await expect(harness().acceptFriendRequest({
      actorPtid: 'ptid:test:alice',
    })).resolves.toEqual({
      accepted: true,
      requestId: 'friend-request-1',
    });

    expect(api.socialFriendRequestSend).toHaveBeenCalledWith({
      receiverPtid: 'ptid:test:bob',
      receiverHomeStationPeerId: 'station-four',
      federationId: 'federation-1',
      message: 'secure-content-w7 friendship',
    });
    expect(api.socialFriendRequestAccept).toHaveBeenCalledWith({
      requestId: 'friend-request-1',
      senderPtid: 'ptid:test:alice',
      senderHomeStationPeerId: 'station-four',
      federationId: 'federation-1',
      message: '',
    });
  });

  it('keeps private draft plaintext and paths out of returned evidence', async () => {
    const plaintext = 'private browser draft';
    const filePath = '/tmp/private-image.png';

    const staged = await harness().stageFriendsDraft({
      draftId: 'draft-1',
      revision: 1,
      text: plaintext,
      files: [{ intentId: 'image-1', filePath }],
    });

    const serialized = JSON.stringify(staged);
    expect(serialized).not.toContain(plaintext);
    expect(serialized).not.toContain(filePath);
    expect(staged).toMatchObject({
      present: true,
      revision: 1,
      audienceKind: 'FRIENDS',
      fileCount: 1,
    });
  });

  it('stages an exact non-FRIENDS audience through the production draft store', async () => {
    const staged = await harness().stagePrivateDraft({
      draftId: 'draft-circle',
      revision: 2,
      text: 'circle only',
      audienceKind: 'CIRCLE',
      targetId: '77',
    });

    expect(staged).toMatchObject({
      present: true,
      revision: 2,
      audienceKind: 'CIRCLE',
    });
    expect(momentsState.setComposerDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: expect.objectContaining({
          kind: Audience_Kind.CIRCLE,
          targetId: 77n,
        }),
      }),
    );
  });

  it('returns the store-owned Browser unsupported state without a publish fallback', async () => {
    await harness().stageFriendsDraft({
      draftId: 'draft-2',
      revision: 3,
      text: 'browser private publish',
    });
    momentsState.createPost.mockImplementation(async () => {
      privateState.publish = {
        state: 'PRIVATE_UNSUPPORTED',
        errorCode: 'PRIVATE_UNSUPPORTED',
      };
      throw new Error('PRIVATE_UNSUPPORTED');
    });

    const result = await harness().publishFriendsDraft();

    expect(result).toMatchObject({
      platform: 'browser',
      state: 'PRIVATE_UNSUPPORTED',
      errorCode: 'PRIVATE_UNSUPPORTED',
    });
    expect(result).not.toHaveProperty('transientPostId');
  });

  it('uses Native-verified private media evidence without refetching local URLs', async () => {
    const plaintextSha256 = 'a'.repeat(64);
    privateState.platform = 'native';
    privateState.readMoment.mockImplementation(async (postId: string) => {
      privateState.postsById[postId] = {
        postId,
        contentId: 'content-1',
        generation: '7',
        authorPtid: 'ptid:test:alice',
        audienceKind: 'FRIENDS',
        state: 'CONTENT_READY',
        content: {
          kind: 'IMAGE',
          text: 'private image text',
          media: [{
            objectId: 'object-1',
            state: 'MEDIA_READY',
            renderUrl: 'asset://localhost/private-image',
            plaintextSha256,
            plaintextSize: 4,
            mimeType: 'image/png',
          }],
        },
      };
    });
    const fetchMedia = vi.fn();
    vi.stubGlobal('fetch', fetchMedia);

    const result = await harness().readPrivateMoment({
      postId: 'post-1',
      openMedia: true,
    });
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      platform: 'native',
      state: 'CONTENT_READY',
      contentKind: 'IMAGE',
      textByteLength: 18,
      media: [{
        state: 'MEDIA_READY',
        mimeType: 'image/png',
        plaintextSha256,
        byteLength: 4,
      }],
    });
    expect(fetchMedia).not.toHaveBeenCalled();
    expect(serialized).not.toContain('private image text');
    expect(serialized).not.toContain('asset://localhost/private-image');
  });

  it('reads historical private content through the recovery path', async () => {
    privateState.platform = 'native';
    privateState.recoverMoment.mockImplementation(async (postId: string) => {
      privateState.postsById[postId] = {
        postId,
        contentId: 'content-recovered',
        generation: '7',
        authorPtid: 'ptid:test:alice',
        audienceKind: 'FRIENDS',
        state: 'CONTENT_READY',
        content: {
          kind: 'TEXT',
          text: 'historical private text',
        },
      };
    });

    const result = await harness().recoverPrivateMoment({
      postId: 'post-recovered',
    });

    expect(privateState.recoverMoment).toHaveBeenCalledWith('post-recovered');
    expect(result).toMatchObject({
      platform: 'native',
      state: 'CONTENT_READY',
      textByteLength: 23,
    });
    expect(JSON.stringify(result)).not.toContain('historical private text');
  });

  it('submits and reads private Comment evidence without exposing plaintext', async () => {
    const comment = {
      authorPtid: 'ptid:test:bob',
      commentId: 'comment-1',
      contentId: 'comment-content-1',
      generation: '1',
      postId: 'post-1',
      replyToCommentId: '',
      state: 'COMMENT_POSTED',
      text: 'private comment text',
      reactionsCount: 0,
      repliesCount: 0,
    };
    privateCommentsState.submitComment.mockImplementation(async () => {
      privateCommentsState.threadsByPost['post-1'] = {
        comments: [comment],
        hasMore: false,
        loaded: true,
        loading: false,
        nextCursor: '',
      };
    });
    privateCommentsState.loadComments.mockResolvedValue(undefined);

    const submitted = await harness().submitPrivateComment({
      postId: 'post-1',
      text: comment.text,
    });
    const read = await harness().readPrivateComments({
      postId: 'post-1',
      refresh: true,
    });

    expect(submitted).toMatchObject({
      state: 'COMMENT_POSTED',
      textByteLength: comment.text.length,
    });
    expect(read).toMatchObject({
      comments: [{
        state: 'COMMENT_POSTED',
        textByteLength: comment.text.length,
      }],
      loaded: true,
    });
    expect(JSON.stringify({ submitted, read })).not.toContain(comment.text);
    expect(privateCommentsState.submitComment).toHaveBeenCalledWith(
      'post-1',
      comment.text,
    );
  });

  it('projects unauthorized private Comment reads without plaintext', async () => {
    privateCommentsState.loadComments.mockImplementation(async () => {
      privateCommentsState.threadsByPost['post-denied'] = {
        comments: [],
        errorCode: 'SOCIAL_PRIVATE_NOT_FOUND',
        hasMore: false,
        loaded: true,
        loading: false,
        nextCursor: '',
        state: 'COMMENT_PARENT_UNAVAILABLE',
      };
      throw new Error('denied');
    });

    const result = await harness().readPrivateComments({
      postId: 'post-denied',
      refresh: true,
    });

    expect(result).toEqual({
      comments: [],
      errorCode: 'SOCIAL_PRIVATE_NOT_FOUND',
      hasMore: false,
      loaded: true,
      state: 'COMMENT_PARENT_UNAVAILABLE',
    });
  });

  it('returns a hashed Native process identity for restart fencing', async () => {
    privateState.platform = 'native';
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        bootIdentitySha256: 'd'.repeat(64),
        sessionGeneration: 11,
        sourceCommit: __PT_SOURCE_COMMIT__,
        executableSha256: 'a'.repeat(64),
        stationRuntimeIdentitySha256: 'b'.repeat(64),
        stationEndpointSha256: 'c'.repeat(64),
      },
    });

    const result = await harness().snapshot();

    expect(result).toMatchObject({
      platform: 'native',
      authenticationState: 'AUTHENTICATED',
      bootIdentitySha256: 'd'.repeat(64),
      sessionGeneration: 11,
      nativeRuntimeIdentitySha256: 'd'.repeat(64),
    });
    expect(
      (result as { nativeRuntimeIdentitySha256?: string })
        .nativeRuntimeIdentitySha256,
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(
      (result as { sessionIdentitySha256?: string }).sessionIdentitySha256,
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(
      (result as { clientArtifactSha256?: string }).clientArtifactSha256,
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(result).toMatchObject({
      stationRuntimeIdentitySha256: 'b'.repeat(64),
      stationEndpointSha256: 'c'.repeat(64),
    });
    expect((result as { sourceCommit?: string }).sourceCommit).toBe(
      __PT_SOURCE_COMMIT__,
    );
    expect(result).not.toHaveProperty('processId');
    expect(result).not.toHaveProperty('bootId');
    expect(invoke).toHaveBeenCalledWith(
      'social_private_moments_acceptance_runtime_identity',
      {
        input: {
          actor_ptid: 'ptid:test:alice',
          renderer_generation: 9,
        },
      },
    );
  });

  it('fails closed when Native cannot report its active Station identity', async () => {
    privateState.platform = 'native';
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        bootIdentitySha256: 'd'.repeat(64),
        sessionGeneration: 11,
        sourceCommit: __PT_SOURCE_COMMIT__,
        executableSha256: 'a'.repeat(64),
      },
    });

    await expect(harness().snapshot()).rejects.toThrow(
      'moments.acceptance.nativeRuntimeIdentityMissing',
    );
  });

  it('changes the live Browser artifact digest when renderer bytes change', async () => {
    const first = await harness().snapshot() as {
      clientArtifactSha256: string;
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder()
        .encode('different renderer bundle')
        .buffer,
    })));
    installAcceptanceHarness();

    const changed = await harness().snapshot() as {
      clientArtifactSha256: string;
    };

    expect(first.clientArtifactSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(changed.clientArtifactSha256).not.toBe(first.clientArtifactSha256);
  });

  it('keeps the session identity stable until the owner session epoch changes', async () => {
    const first = await harness().snapshot() as {
      bootIdentitySha256: string;
      sessionGeneration: number;
      sessionIdentitySha256: string;
    };
    const unchanged = await harness().snapshot() as {
      bootIdentitySha256: string;
      sessionGeneration: number;
      sessionIdentitySha256: string;
    };

    sessionState.sessionEpoch += 1;
    const replaced = await harness().snapshot() as {
      bootIdentitySha256: string;
      sessionGeneration: number;
      sessionIdentitySha256: string;
    };

    expect(first.bootIdentitySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(unchanged.bootIdentitySha256).toBe(first.bootIdentitySha256);
    expect(replaced.bootIdentitySha256).toBe(first.bootIdentitySha256);
    expect(first.sessionGeneration).toBe(7);
    expect(unchanged.sessionGeneration).toBe(7);
    expect(replaced.sessionGeneration).toBe(8);
    expect(first.sessionIdentitySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(unchanged.sessionIdentitySha256).toBe(first.sessionIdentitySha256);
    expect(replaced.sessionIdentitySha256).not.toBe(first.sessionIdentitySha256);
  });

  it('keeps live boot and session identity independent of mutable product state', async () => {
    const first = await harness().snapshot() as {
      bootIdentitySha256: string;
      sessionGeneration: number;
    };
    momentsState.postsById = { mutable: { id: 'mutable' } };
    privateState.publish = { state: 'PUBLISHED', postId: 'mutable' };
    privateState.postsById = { mutable: { state: 'CONTENT_READY' } };

    const afterMutation = await harness().snapshot() as {
      bootIdentitySha256: string;
      sessionGeneration: number;
    };

    expect(afterMutation.bootIdentitySha256).toBe(first.bootIdentitySha256);
    expect(afterMutation.sessionGeneration).toBe(first.sessionGeneration);
  });

  it('does not accept caller-supplied boot or session identities', async () => {
    const result = await harness().snapshot({
      bootIdentitySha256: 'f'.repeat(64),
      sessionGeneration: 999,
    }) as {
      bootIdentitySha256: string;
      sessionGeneration: number;
    };

    expect(result.bootIdentitySha256).not.toBe('f'.repeat(64));
    expect(result.sessionGeneration).toBe(sessionState.sessionEpoch);
  });

  it('rejects malformed Native owner boot and session identity', async () => {
    privateState.platform = 'native';
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        bootIdentitySha256: 'attacker-controlled',
        sessionGeneration: 0,
        sourceCommit: __PT_SOURCE_COMMIT__,
        executableSha256: 'a'.repeat(64),
        stationRuntimeIdentitySha256: 'b'.repeat(64),
        stationEndpointSha256: 'c'.repeat(64),
      },
    });

    await expect(harness().snapshot()).rejects.toThrow(
      'moments.acceptance.nativeRuntimeIdentityMissing',
    );
  });

  it('persists a typed marker for the exact observed interval', async () => {
    const actionId = 'browser-private-read';
    const runtimeManifestDigest = 'a'.repeat(64);
    const capture = await harness().beginNetworkCapture({
      actionId,
      runtimeManifestDigest,
    }) as {
      captureId: string;
      initialObserverSequence: number;
    };
    await fetch('https://station.invalid/api/v1/social/moments/control');
    const socket = new WebSocket('wss://station.invalid/events') as unknown as FakeWebSocket;
    socket.emitOpen();
    socket.emitMessage('first');
    socket.emitMessage('second');

    const marker = await harness().emitTerminalMarker({
      captureId: capture.captureId,
      actionId,
      finalObserverSequence: 999,
      captureIntervalDigest: 'f'.repeat(64),
    }) as {
      schemaVersion: number;
      captureId: string;
      actionId: string;
      runtimeManifestDigest: string;
      finalObserverSequence: number;
      openStreamIdentityDigests: string[];
      captureIntervalDigest: string;
      markerDigest: string;
    };
    const canonicalMarker = JSON.stringify({
      actionId,
      captureId: capture.captureId,
      captureIntervalDigest: marker.captureIntervalDigest,
      finalObserverSequence: marker.finalObserverSequence,
      openStreamIdentityDigests: marker.openStreamIdentityDigests,
      runtimeManifestDigest,
      schemaVersion: 1,
    });
    const expectedMarkerDigest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(canonicalMarker),
    ).then((digest) => Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(''));

    expect(marker).toMatchObject({
      schemaVersion: 1,
      captureId: capture.captureId,
      actionId,
      runtimeManifestDigest,
    });
    expect(marker.finalObserverSequence).toBe(
      capture.initialObserverSequence + 5,
    );
    expect(marker.finalObserverSequence).not.toBe(999);
    expect(marker.openStreamIdentityDigests).toHaveLength(1);
    expect(marker.openStreamIdentityDigests[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(marker.captureIntervalDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(marker.captureIntervalDigest).not.toBe('f'.repeat(64));
    expect(marker.markerDigest).toBe(expectedMarkerDigest);

    const markCalls = vi.mocked(performance.mark).mock.calls;
    const markCall = markCalls[markCalls.length - 1];
    expect(markCall?.[0]).toMatch(/^sc-terminal-v1:[A-Za-z0-9_-]+$/);
    const encoded = String(markCall?.[0]).slice('sc-terminal-v1:'.length);
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
      .padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    expect(JSON.parse(atob(padded))).toEqual({
      actionId,
      captureId: capture.captureId,
      captureIntervalDigest: marker.captureIntervalDigest,
      finalObserverSequence: marker.finalObserverSequence,
      openStreamIdentityDigests: marker.openStreamIdentityDigests,
      runtimeManifestDigest,
      schemaVersion: 1,
    });
    expect(markCall?.[1]).toEqual({ detail: marker });

    const persisted = JSON.stringify(marker);
    socket.emitMessage('post-marker');
    const nextCapture = await harness().beginNetworkCapture({
      actionId: 'browser-empty-interval',
      runtimeManifestDigest,
    }) as {
      captureId: string;
      initialObserverSequence: number;
    };
    const nextMarker = await harness().emitTerminalMarker({
      captureId: nextCapture.captureId,
      actionId: 'browser-empty-interval',
    }) as {
      finalObserverSequence: number;
      captureIntervalDigest: string;
    };
    expect(JSON.stringify(marker)).toBe(persisted);
    expect(nextCapture.initialObserverSequence).toBe(
      marker.finalObserverSequence + 1,
    );
    expect(nextMarker.finalObserverSequence).toBe(
      nextCapture.initialObserverSequence,
    );
    expect(nextMarker.captureIntervalDigest).not.toBe(
      marker.captureIntervalDigest,
    );
    await expect(harness().emitTerminalMarker({
      captureId: capture.captureId,
      actionId,
    })).rejects.toThrow('moments.acceptance.captureIdentityMismatch');
  });

  it('reports an anonymous Browser identity without inventing an actor', async () => {
    sessionState.currentUser = null;

    const result = await harness().snapshot();

    expect(result).toMatchObject({
      platform: 'browser',
      authenticationState: 'ANONYMOUS',
    });
    expect(
      (result as { sessionIdentitySha256?: string }).sessionIdentitySha256,
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(
      (result as { stationRuntimeIdentitySha256?: string })
        .stationRuntimeIdentitySha256,
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(
      (result as { stationEndpointSha256?: string }).stationEndpointSha256,
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(result).not.toHaveProperty('actorPtidSha256');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('fails closed when Browser cannot resolve the active Station peer', async () => {
    vi.mocked(api.stationList).mockResolvedValue({
      active_url: 'https://station.invalid',
      binding: {
        phase: 'bound',
        bound_url: 'https://station.invalid',
        generation: 1,
      },
      entries: [{
        url: 'https://station.invalid',
        online: true,
      }],
    });

    await expect(harness().snapshot()).rejects.toThrow(
      'moments.acceptance.stationIdentityMissing',
    );
  });

  it.each([
    'unbound',
    'connecting',
    'access_gate',
    'switching',
    'failed',
  ] as const)(
    'fails closed when Browser Station binding phase is %s',
    async (phase) => {
      vi.mocked(api.stationList).mockResolvedValue({
        active_url: 'https://station.invalid',
        binding: {
          phase,
          bound_url: 'https://station.invalid',
          generation: 2,
        },
        entries: [{
          url: 'https://station.invalid',
          peer_id: 'peer-station-four',
          online: true,
        }],
      });

      await expect(harness().snapshot()).rejects.toThrow(
        'moments.acceptance.stationIdentityMissing',
      );
    },
  );

  it('fails closed when Browser active and bound Station URLs diverge', async () => {
    vi.mocked(api.stationList).mockResolvedValue({
      active_url: 'https://station-two.invalid',
      binding: {
        phase: 'bound',
        bound_url: 'https://station-one.invalid',
        generation: 2,
      },
      entries: [{
        url: 'https://station-one.invalid',
        peer_id: 'peer-station-four',
        online: true,
      }],
    });

    await expect(harness().snapshot()).rejects.toThrow(
      'moments.acceptance.stationIdentityMissing',
    );
  });

  it('fails closed when Browser Station binding changes during capture', async () => {
    vi.mocked(api.stationList)
      .mockResolvedValueOnce({
        active_url: 'https://station-one.invalid',
        binding: {
          phase: 'bound',
          bound_url: 'https://station-one.invalid',
          generation: 2,
        },
        entries: [{
          url: 'https://station-one.invalid',
          peer_id: 'peer-station-one',
          online: true,
        }],
      })
      .mockResolvedValueOnce({
        active_url: 'https://station-two.invalid',
        binding: {
          phase: 'bound',
          bound_url: 'https://station-two.invalid',
          generation: 3,
        },
        entries: [{
          url: 'https://station-two.invalid',
          peer_id: 'peer-station-two',
          online: true,
        }],
      });

    await expect(harness().snapshot()).rejects.toThrow(
      'moments.acceptance.stationIdentityMissing',
    );
  });

  it('reads public image bytes through the production OSS resolver', async () => {
    const publicText = 'public image control';
    momentsState.loadFeed.mockImplementation(async () => {
      momentsState.feeds.explore.postIds = ['public-post'];
      momentsState.postsById['public-post'] = {
        id: 'public-post',
        content: {
          case: 'imagePost',
          value: {
            text: publicText,
            images: [{ url: 'oss://station/public-image' }],
          },
        },
      };
    });
    vi.mocked(api.ossResolveUrl).mockResolvedValue({
      host: 'station',
      key: 'public-image',
      url: 'https://station.invalid/public-image',
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([5, 6, 7]).buffer,
    })));

    const result = await harness().findPublicMoment({ text: publicText });
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      found: true,
      textByteLength: publicText.length,
      media: [{ byteLength: 3 }],
    });
    expect(serialized).not.toContain(publicText);
    expect(serialized).not.toContain('oss://station/public-image');
    expect(serialized).not.toContain('https://station.invalid/public-image');
  });
});
