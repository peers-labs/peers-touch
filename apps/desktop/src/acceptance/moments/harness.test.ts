import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { api } from '../../services/desktop_api';
import {
  socialBlockActor,
  socialFollow,
  socialGetRelationship,
  socialUnblockActor,
} from '../../services/social_api';
import {
  Audience_Kind,
  ReactionKind,
} from '../../gen/proto/domain/social/post_pb';
import {
  SocialRelationshipCommandResultKind,
} from '../../gen/proto/domain/social/relationship_pb';
import { privateMomentsNative } from '../../services/privateMomentsNative';

declare const __PT_SOURCE_COMMIT__: string;

const registered: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {};

const momentsState = {
  composerDraft: null as Record<string, unknown> | null,
  feeds: {
    explore: {
      postIds: [] as string[],
    },
  },
  reactions: {} as Record<string, Array<{
    kind: number;
    count: bigint;
    reactedByViewer: boolean;
  }>>,
  postsById: {} as Record<string, unknown>,
  setComposerDraft: vi.fn((draft: Record<string, unknown>) => {
    momentsState.composerDraft = draft;
  }),
  clearComposerDraft: vi.fn(() => {
    momentsState.composerDraft = null;
  }),
  createPost: vi.fn(),
  deletePost: vi.fn(),
  reactToPost: vi.fn(),
  unreactToPost: vi.fn(),
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
  purgeMoment: vi.fn(),
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
    federationCreate: vi.fn(),
    federationGetSelf: vi.fn(),
    federationJoin: vi.fn(),
    federationListFederations: vi.fn(),
    federationListMemberStations: vi.fn(),
    federationResolve: vi.fn(),
    ossResolveUrl: vi.fn(),
    ossUploadAttachmentSocial: vi.fn(),
    ossUploadEncryptedAttachmentSocial: vi.fn(),
    socialFriendRequestAccept: vi.fn(),
    socialFriendRequestList: vi.fn(),
    socialFriendRequestSend: vi.fn(),
    stationList: vi.fn(),
  },
}));

vi.mock('../../services/social_api', () => ({
  socialBlockActor: vi.fn(),
  socialFollow: vi.fn(),
  socialGetRelationship: vi.fn(),
  socialUnblockActor: vi.fn(),
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
    momentsState.reactions = {};
    momentsState.postsById = {};
    momentsState.setComposerDraft.mockClear();
    momentsState.clearComposerDraft.mockClear();
    momentsState.createPost.mockReset();
    momentsState.deletePost.mockReset();
    momentsState.reactToPost.mockReset();
    momentsState.unreactToPost.mockReset();
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
    privateState.purgeMoment.mockReset();
    privateState.clearPublishState.mockClear();
    privateCommentsState.threadsByPost = {};
    privateCommentsState.submitComment.mockReset();
    privateCommentsState.loadComments.mockReset();
    sessionState.sessionEpoch = 7;
    sessionState.currentUser = { actorPtid: 'ptid:test:alice' };
    vi.mocked(invoke).mockReset();
    vi.mocked(api.ossResolveUrl).mockReset();
    vi.mocked(api.ossUploadAttachmentSocial).mockReset();
    vi.mocked(api.ossUploadEncryptedAttachmentSocial).mockReset();
    vi.mocked(socialBlockActor).mockReset();
    vi.mocked(socialFollow).mockReset();
    vi.mocked(socialGetRelationship).mockReset();
    vi.mocked(socialUnblockActor).mockReset();
    vi.mocked(api.federationCreate).mockReset();
    vi.mocked(api.federationGetSelf).mockReset();
    vi.mocked(api.federationJoin).mockReset();
    vi.mocked(api.federationListFederations).mockReset();
    vi.mocked(api.federationListMemberStations).mockReset();
    vi.mocked(api.federationResolve).mockReset();
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
      federations: [{
        federationId: 'federation-1',
        status: 'active',
      }],
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

  it('reads and resolves a federated Actor identity through production APIs', async () => {
    vi.mocked(api.federationGetSelf).mockResolvedValue({
      federatedHandle: '@alice@four.invalid',
      homeStationPeerId: 'station-four',
    } as never);
    vi.mocked(api.federationResolve).mockResolvedValue({
      federatedHandle: '@remote@five-arm.invalid',
      homeStationPeerId: 'station-five-arm',
      profile: {
        ref: { ptid: 'ptid:test:remote' },
      },
    } as never);

    await expect(harness().federatedActorIdentity()).resolves.toEqual({
      actorPtid: 'ptid:test:alice',
      federatedHandle: '@alice@four.invalid',
      homeStationPeerId: 'station-four',
    });
    await expect(harness().resolveFederatedActorIdentity({
      federatedHandle: '@remote@five-arm.invalid',
    })).resolves.toEqual({
      actorPtid: 'ptid:test:remote',
      federatedHandle: '@remote@five-arm.invalid',
      homeStationPeerId: 'station-five-arm',
    });
    expect(api.federationResolve).toHaveBeenCalledWith(
      '@remote@five-arm.invalid',
    );
  });

  it('joins and verifies the shared Federation through production APIs', async () => {
    vi.mocked(api.federationGetSelf).mockResolvedValue({
      homeStationPeerId: 'station-five-arm',
    } as never);
    vi.mocked(api.federationListFederations).mockResolvedValue({
      federations: [{
        federationId: 'federation-1',
        sequencerStationPeerId: 'station-four',
        status: 'active',
      }],
    } as never);
    vi.mocked(api.federationJoin).mockResolvedValue({
      status: 'active',
      proposalId: 'proposal-1',
    } as never);
    vi.mocked(api.federationListMemberStations).mockResolvedValue({
      stations: [
        {
          stationPeerId: 'station-five-arm',
          stationUrl: 'https://five-arm.invalid',
          status: 'active',
        },
        {
          stationPeerId: 'station-four',
          stationUrl: 'https://four.invalid',
          status: 'active',
        },
        {
          stationPeerId: 'station-retired',
          stationUrl: 'https://retired.invalid',
          status: 'left',
        },
      ],
    } as never);

    await expect(harness().federationJoinAuthority()).resolves.toEqual({
      federationEndpoint: 'https://four.invalid',
      federationId: 'federation-1',
      homeStationPeerId: 'station-five-arm',
    });
    await expect(harness().joinAcceptanceFederation({
      federationEndpoint: 'https://four.invalid',
      federationId: 'federation-1',
    })).resolves.toEqual({
      federationId: 'federation-1',
      status: 'active',
      proposalId: 'proposal-1',
    });
    await expect(harness().federationMemberStations({
      federationId: 'federation-1',
    })).resolves.toEqual({
      federationId: 'federation-1',
      stationPeerIds: ['station-five-arm', 'station-four'],
    });

    expect(api.federationJoin).toHaveBeenCalledWith({
      federation_endpoint: 'https://four.invalid',
      federation_id: 'federation-1',
      message: 'secure-content-w8 remote recipient fixture',
    });
    expect(api.federationListMemberStations).toHaveBeenCalledWith(
      'federation-1',
    );
  });

  it('creates a Federation when active membership has no sequencer endpoint', async () => {
    vi.mocked(api.federationGetSelf).mockResolvedValue({
      homeStationPeerId: 'station-four',
    } as never);
    vi.mocked(api.federationListFederations).mockResolvedValue({
      federations: [{
        federationId: 'stale-federation',
        sequencerStationPeerId: 'station-four',
        status: 'active',
      }],
    } as never);
    vi.mocked(api.federationListMemberStations)
      .mockResolvedValueOnce({
        stations: [{
          stationPeerId: 'station-four',
          stationUrl: '',
          status: 'active',
        }],
      } as never)
      .mockResolvedValueOnce({
        stations: [{
          stationPeerId: 'station-four',
          stationUrl: 'https://four.invalid',
          status: 'active',
        }],
      } as never);
    vi.mocked(api.federationCreate).mockResolvedValue({
      federationId: 'created-federation',
    } as never);

    await expect(harness().federationJoinAuthority()).resolves.toEqual({
      federationEndpoint: 'https://four.invalid',
      federationId: 'created-federation',
      homeStationPeerId: 'station-four',
    });
    expect(api.federationCreate).toHaveBeenCalledWith({
      name: 'Secure Content W8 Fixture',
      description: 'Acceptance-owned cross-Station Social fixture',
      policy_type: 'single_admin',
    });
    expect(api.federationListMemberStations).toHaveBeenNthCalledWith(
      2,
      'created-federation',
    );
  });

  it('follows an actor through the production Social API', async () => {
    vi.mocked(socialFollow).mockResolvedValue({
      success: true,
      relationship: {
        targetActorPtid: 'ptid:test:alice',
        following: true,
      },
    } as never);

    const result = await harness().followActor({
      actorPtid: 'ptid:test:alice',
    });

    expect(socialFollow).toHaveBeenCalledWith('ptid:test:alice');
    expect(result).toMatchObject({
      followed: true,
    });
    expect(
      (result as { actorPtidSha256: string }).actorPtidSha256,
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result)).not.toContain('ptid:test:alice');
  });

  it('reads the authoritative mutual-friendship projection', async () => {
    vi.mocked(socialGetRelationship).mockResolvedValue({
      relationship: {
        targetActorPtid: 'ptid:test:bob',
        following: true,
        followedBy: true,
      },
    } as never);

    const result = await harness().friendshipProjection({
      actorPtid: 'ptid:test:bob',
    });

    expect(socialGetRelationship).toHaveBeenCalledWith('ptid:test:bob');
    expect(result).toMatchObject({
      followedBy: true,
      following: true,
    });
    expect(
      (result as { actorPtidSha256: string }).actorPtidSha256,
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result)).not.toContain('ptid:test:bob');
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
      circleId: '77',
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
          target: {
            case: 'circleId',
            value: 77n,
          },
        }),
      }),
    );
  });

  it('stages a Group audience with its canonical Conversation identity', async () => {
    const groupConversationId = '01J9Z7Y6M5N4P3Q2R1S0TUVWXY';

    await harness().stagePrivateDraft({
      draftId: 'draft-group',
      revision: 3,
      text: 'group only',
      audienceKind: 'GROUP',
      groupConversationId,
    });

    expect(momentsState.setComposerDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: expect.objectContaining({
          kind: Audience_Kind.GROUP,
          target: {
            case: 'groupConversationId',
            value: groupConversationId,
          },
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

  it('returns Native pre-prepare rejection and local cleanup counters', async () => {
    await harness().stagePrivateDraft({
      draftId: 'draft-remote',
      revision: 1,
      text: 'remote private publish',
      audienceKind: 'CUSTOM_ALLOW',
      actorPtids: ['ptid:test:remote'],
    });
    privateState.platform = 'native';
    momentsState.createPost.mockImplementation(async () => {
      privateState.publish = {
        state: 'PRIVATE_UNSUPPORTED',
        errorCode: 'PRIVATE_UNSUPPORTED',
        rejectionEvidence: {
          publishPhase: 'PREPARE_REJECTED',
          prepareSucceeded: false,
          receivedPreparePlanCount: 0,
          desktopLocalDurableRowCount: 0,
          localDraftRowCount: 0,
          localCommandRowCount: 0,
          localProjectionRowCount: 0,
          localUploadRowCount: 0,
          claimCountScope: 'NATIVE_RECEIVED_PREPARE_PLAN',
          partialRowScope: 'DESKTOP_LOCAL_DURABLE_STATE',
          serverWriteProof: 'STATION_SOURCE_TEST_REQUIRED',
        },
      };
      throw new Error('PRIVATE_UNSUPPORTED');
    });

    const result = await harness().publishPrivateDraft();

    expect(result).toMatchObject({
      platform: 'native',
      state: 'PRIVATE_UNSUPPORTED',
      errorCode: 'PRIVATE_UNSUPPORTED',
      rejectionEvidence: {
        publishPhase: 'PREPARE_REJECTED',
        prepareSucceeded: false,
        receivedPreparePlanCount: 0,
        desktopLocalDurableRowCount: 0,
        claimCountScope: 'NATIVE_RECEIVED_PREPARE_PLAN',
        partialRowScope: 'DESKTOP_LOCAL_DURABLE_STATE',
        serverWriteProof: 'STATION_SOURCE_TEST_REQUIRED',
      },
    });
    expect(result).not.toHaveProperty('transientPostId');
  });

  it('normalizes Native rejection evidence without synthesizing counters', async () => {
    vi.stubGlobal('window', {
      __TAURI_INTERNALS__: {},
      location: new URL('tauri://localhost/moments'),
    });
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        state: 'PRIVATE_UNSUPPORTED',
        draftId: 'draft-remote',
        errorCode: 'PRIVATE_UNSUPPORTED',
        stationErrorCode: 'ERROR_CODE_INVALID_REQUEST',
        evidence: {
          publishPhase: 'PREPARE_REJECTED',
          prepareSucceeded: false,
          receivedPreparePlanCount: 0,
          desktopLocalDurableRowCount: 0,
          localDraftRowCount: 0,
          localCommandRowCount: 0,
          localProjectionRowCount: 0,
          localUploadRowCount: 0,
          claimCountScope: 'NATIVE_RECEIVED_PREPARE_PLAN',
          partialRowScope: 'DESKTOP_LOCAL_DURABLE_STATE',
          serverWriteProof: 'STATION_SOURCE_TEST_REQUIRED',
        },
      },
    });

    const result = await privateMomentsNative.publish({
      actorPtid: 'ptid:test:alice',
      rendererGeneration: 9,
      draftId: 'draft-remote',
      draftRevision: 1,
      audience: {
        kind: 'CUSTOM_ALLOW',
        actorPtids: ['ptid:test:remote'],
      },
      momentKind: 'TEXT',
      text: 'remote private publish',
      files: [],
    });

    expect(result).toMatchObject({
      state: 'PRIVATE_UNSUPPORTED',
      evidence: {
        publishPhase: 'PREPARE_REJECTED',
        prepareSucceeded: false,
        receivedPreparePlanCount: 0,
        desktopLocalDurableRowCount: 0,
      },
    });
  });

  it('keeps CUSTOM_DENY(PUBLIC) on the build-gated Acceptance probe', async () => {
    vi.stubGlobal('window', {
      __TAURI_INTERNALS__: {},
      location: new URL('tauri://localhost/moments'),
    });
    privateState.platform = 'native';
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        state: 'PRIVATE_UNSUPPORTED',
        draftId: 'draft-public-deny',
        errorCode: 'PRIVATE_UNSUPPORTED',
        stationErrorCode: 'SOCIAL_PRIVATE_UNSUPPORTED',
        evidence: {
          publishPhase: 'PREPARE_REJECTED',
          prepareSucceeded: false,
          receivedPreparePlanCount: 0,
          desktopLocalDurableRowCount: 0,
          localDraftRowCount: 0,
          localCommandRowCount: 0,
          localProjectionRowCount: 0,
          localUploadRowCount: 0,
          claimCountScope: 'NATIVE_RECEIVED_PREPARE_PLAN',
          partialRowScope: 'DESKTOP_LOCAL_DURABLE_STATE',
          serverWriteProof: 'STATION_SOURCE_TEST_REQUIRED',
        },
      },
    });

    const result = await harness().publishUnsupportedCustomDenyPublic({
      draftId: 'draft-public-deny',
      revision: 1,
      text: 'unsupported public deny',
      audienceKind: 'CUSTOM_DENY',
      baseKind: 'PUBLIC',
      actorPtids: ['ptid:test:eve'],
    });

    expect(result).toMatchObject({
      state: 'PRIVATE_UNSUPPORTED',
      rejectionEvidence: {
        receivedPreparePlanCount: 0,
        desktopLocalDurableRowCount: 0,
      },
    });
    expect(invoke).toHaveBeenCalledWith(
      'social_private_moment_publish',
      {
        input: expect.objectContaining({
          audience: {
            kind: 'CUSTOM_DENY',
            actorPtids: ['ptid:test:eve'],
            baseKind: 'PUBLIC',
          },
        }),
      },
    );
  });

  it.each([
    {
      momentKind: 'VIDEO',
      extra: {
        files: [{ intentId: 'video-source', filePath: '/private/video.mp4' }],
      },
      expected: {
        kind: 'video',
        localFiles: [{
          intentId: 'video-source',
          filePath: '/private/video.mp4',
          previewSrc: '',
        }],
      },
    },
    {
      momentKind: 'LINK',
      extra: {
        link: {
          url: 'https://example.test/private',
          title: 'Private link',
        },
      },
      expected: {
        kind: 'link',
        link: {
          url: 'https://example.test/private',
          title: 'Private link',
        },
      },
    },
    {
      momentKind: 'POLL',
      extra: {
        poll: {
          question: 'Choose one',
          options: ['First', 'Second'],
          minChoices: 1,
          maxChoices: 1,
          expiresAtSeconds: 4_000_000_000,
        },
      },
      expected: {
        kind: 'poll',
        poll: {
          question: 'Choose one',
          options: ['First', 'Second'],
          minChoices: 1,
          maxChoices: 1,
          expiresAtSeconds: 4_000_000_000,
          durationHours: 1,
          multipleChoice: false,
        },
      },
    },
    {
      momentKind: 'LOCATION',
      extra: {
        location: {
          name: 'Central Park',
          latitude: 40.7829,
          longitude: -73.9654,
          address: 'New York',
        },
      },
      expected: {
        kind: 'location',
        location: {
          name: 'Central Park',
          latitude: 40.7829,
          longitude: -73.9654,
          address: 'New York',
        },
      },
    },
  ])('publishes $momentKind through the production Moments store', async ({
    momentKind,
    extra,
    expected,
  }) => {
    privateState.platform = 'native';
    momentsState.createPost.mockImplementation(async () => {
      privateState.publish = { state: 'PUBLISHED' };
      return `post-${momentKind.toLowerCase()}`;
    });

    const result = await harness().publishTypedPrivateMoment({
      draftId: `draft-${momentKind.toLowerCase()}`,
      revision: 1,
      text: `private ${momentKind.toLowerCase()}`,
      audienceKind: 'FRIENDS',
      momentKind,
      ...extra,
    });

    expect(momentsState.createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: expect.objectContaining({ kind: Audience_Kind.FRIENDS }),
        draftId: `draft-${momentKind.toLowerCase()}`,
        draftRevision: 1,
        ...expected,
      }),
    );
    expect(result).toMatchObject({
      state: 'PUBLISHED',
      transientPostId: `post-${momentKind.toLowerCase()}`,
    });
    expect(invoke).not.toHaveBeenCalledWith(
      'social_private_moment_publish',
      expect.anything(),
    );
  });

  it('reports typed private Moment rejection without fabricating a post', async () => {
    privateState.platform = 'native';
    momentsState.createPost.mockImplementation(async () => {
      privateState.publish = {
        state: 'PUBLISH_FAILED',
        errorCode: 'PRIVATE_NATIVE_COMMAND_FAILED',
      };
      throw new Error('private Moment publish intent is invalid');
    });

    const result = await harness().probeTypedPrivateMomentRejection({
      draftId: 'draft-over-limit',
      revision: 1,
      text: 'over limit',
      audienceKind: 'FRIENDS',
      momentKind: 'IMAGE',
      files: Array.from({ length: 11 }, (_, index) => ({
        intentId: `file-${index}`,
        filePath: `/tmp/file-${index}`,
      })),
    });

    expect(result).toEqual({
      rejected: true,
      state: 'PUBLISH_FAILED',
      errorCode: 'PRIVATE_NATIVE_COMMAND_FAILED',
      transientPostId: undefined,
    });
  });

  it('uses the production reaction store for private Moment add and remove', async () => {
    momentsState.reactToPost.mockImplementation(async (postId: string) => {
      momentsState.reactions[postId] = [{
        kind: ReactionKind.REACTION_LOVE,
        count: 1n,
        reactedByViewer: true,
      }];
    });
    momentsState.unreactToPost.mockImplementation(async (postId: string) => {
      momentsState.reactions[postId] = [];
    });

    const reacted = await harness().reactToPrivateMoment({
      postId: 'private-post',
      kind: 'LOVE',
    });
    const unreacted = await harness().unreactToPrivateMoment({
      postId: 'private-post',
      kind: 'LOVE',
    });

    expect(momentsState.reactToPost).toHaveBeenCalledWith(
      'private-post',
      ReactionKind.REACTION_LOVE,
    );
    expect(reacted).toEqual({
      reactions: [{
        kind: ReactionKind.REACTION_LOVE,
        count: 1,
        reactedByViewer: true,
      }],
    });
    expect(momentsState.unreactToPost).toHaveBeenCalledWith(
      'private-post',
      ReactionKind.REACTION_LOVE,
    );
    expect(unreacted).toEqual({ reactions: [] });
  });

  it('deletes through the production Moments store', async () => {
    privateState.postsById['private-post'] = {
      postId: 'private-post',
      state: 'CONTENT_READY',
    };
    momentsState.deletePost.mockImplementation(async (postId: string) => {
      delete privateState.postsById[postId];
    });

    const result = await harness().deletePrivateMoment({
      postId: 'private-post',
    });

    expect(momentsState.deletePost).toHaveBeenCalledWith('private-post');
    expect(result).toEqual({
      deleted: true,
      localProjectionPresent: false,
    });
  });

  it('blocks and unblocks through signed production relationship commands', async () => {
    vi.mocked(socialBlockActor).mockResolvedValue({
      result: {
        kind: SocialRelationshipCommandResultKind.COMMITTED,
        projection: {
          blockedByViewer: true,
          interactionAllowed: false,
          revision: 1n,
        },
      },
    } as never);
    vi.mocked(socialUnblockActor).mockResolvedValue({
      result: {
        kind: SocialRelationshipCommandResultKind.COMMITTED,
        projection: {
          blockedByViewer: false,
          interactionAllowed: true,
          revision: 2n,
        },
      },
    } as never);

    const blocked = await harness().blockActor({
      actorPtid: 'ptid:test:bob',
      homeStationPeerId: 'peer-station-four',
      observedRevision: 0,
    });
    const unblocked = await harness().unblockActor({
      actorPtid: 'ptid:test:bob',
      homeStationPeerId: 'peer-station-four',
      observedRevision: 1,
    });

    expect(socialBlockActor).toHaveBeenCalledWith({
      targetActorPtid: 'ptid:test:bob',
      targetHomeStationPeerId: 'peer-station-four',
      observedRevision: 0,
    });
    expect(blocked).toMatchObject({
      state: 'BLOCKED',
      revision: 1,
      interactionAllowed: false,
    });
    expect(unblocked).toMatchObject({
      state: 'UNBLOCKED',
      revision: 2,
      interactionAllowed: true,
    });
  });

  it.each(['IMAGE', 'VIDEO'] as const)(
    'uses Native-verified private %s media evidence without refetching local URLs',
    async (kind) => {
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
          kind,
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
      contentKind: kind,
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
    expect(privateState.openMedia).toHaveBeenCalledWith('post-1', 'object-1');
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
    const mentions = [{
      actorPtid: 'ptid:test:alice',
      offset: 8,
      length: 5,
      display: 'Alice',
    }];
    const comment = {
      authorPtid: 'ptid:test:bob',
      commentId: 'comment-1',
      contentId: 'comment-content-1',
      generation: '1',
      postId: 'post-1',
      replyToCommentId: '',
      state: 'COMMENT_POSTED',
      text: 'private Alice comment',
      mentions,
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
      mentions,
    });
    const read = await harness().readPrivateComments({
      postId: 'post-1',
      refresh: true,
    });

    expect(submitted).toMatchObject({
      state: 'COMMENT_POSTED',
      textByteLength: comment.text.length,
      mentionCount: 1,
    });
    expect(read).toMatchObject({
      comments: [{
        state: 'COMMENT_POSTED',
        textByteLength: comment.text.length,
        mentionCount: 1,
      }],
      loaded: true,
    });
    expect(JSON.stringify({ submitted, read })).not.toContain(comment.text);
    expect(privateCommentsState.submitComment).toHaveBeenCalledWith(
      'post-1',
      comment.text,
      undefined,
      mentions,
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
    const nativeFetch = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode('renderer bundle').buffer,
    }));
    vi.stubGlobal('fetch', nativeFetch);
    installAcceptanceHarness();
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

    const markerCall = nativeFetch.mock.calls[nativeFetch.mock.calls.length - 1];
    const markerUrl = new URL(String(markerCall?.[0]));
    expect(markerUrl.origin).toBe(window.location.origin);
    expect(markerUrl.pathname).toMatch(
      /^\/__pt_acceptance\/network-terminal\/[A-Za-z0-9_-]+$/,
    );
    expect(markerCall?.[1]).toEqual({
      cache: 'no-store',
      credentials: 'same-origin',
      method: 'GET',
    });
    const encoded = markerUrl.pathname.slice(
      '/__pt_acceptance/network-terminal/'.length,
    );
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
      marker.finalObserverSequence + 3,
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

  it('publishes public media without the private encryption wrapper', async () => {
    vi.mocked(api.ossUploadAttachmentSocial).mockResolvedValue({
      cid: 'oss://station/public-image',
    } as never);
    momentsState.createPost.mockResolvedValue('public-post');

    const result = await harness().publishPublicMoment({
      text: 'public image control',
      filePath: '/tmp/public-image.png',
    });

    expect(api.ossUploadAttachmentSocial).toHaveBeenCalledWith(
      '/tmp/public-image.png',
    );
    expect(api.ossUploadEncryptedAttachmentSocial).not.toHaveBeenCalled();
    expect(momentsState.createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        imageIds: ['oss://station/public-image'],
        audience: expect.objectContaining({ kind: Audience_Kind.PUBLIC }),
      }),
    );
    expect(result).toMatchObject({
      published: true,
      mediaCount: 1,
      transientPostId: 'public-post',
    });
  });
});
