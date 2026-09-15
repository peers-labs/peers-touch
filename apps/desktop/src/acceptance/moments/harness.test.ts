import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { api } from '../../services/desktop_api';

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
  publish: {
    state: 'IDLE',
  } as Record<string, unknown>,
  postsById: {} as Record<string, unknown>,
  readMoment: vi.fn(),
  openMedia: vi.fn(),
  clearPublishState: vi.fn(() => {
    privateState.publish = { state: 'IDLE' };
  }),
};

const sessionState = {
  sessionEpoch: 7,
  currentUser: {
    actorPtid: 'ptid:test:alice',
  } as { actorPtid: string } | null,
};

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../../services/desktop_api', () => ({
  api: {
    ossResolveUrl: vi.fn(),
    ossUploadEncryptedAttachmentSocial: vi.fn(),
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
    privateState.publish = { state: 'IDLE' };
    privateState.postsById = {};
    privateState.readMoment.mockReset();
    privateState.openMedia.mockReset();
    privateState.clearPublishState.mockClear();
    sessionState.sessionEpoch = 7;
    sessionState.currentUser = { actorPtid: 'ptid:test:alice' };
    vi.mocked(invoke).mockReset();
    vi.mocked(api.ossResolveUrl).mockReset();
    vi.mocked(api.ossUploadEncryptedAttachmentSocial).mockReset();
    vi.stubGlobal('window', {
      location: new URL('http://localhost:3210/'),
    });
    vi.stubGlobal('document', {
      scripts: [{ src: 'http://localhost:3210/assets/app.js' }],
    });
    vi.stubGlobal('performance', {
      getEntriesByType: vi.fn(() => []),
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('renderer bundle').buffer,
    })));
    installAcceptanceHarness();
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

  it('hashes ready private text and media bytes without exposing local URLs', async () => {
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
            mimeType: 'image/png',
          }],
        },
      };
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    })));

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
        byteLength: 4,
      }],
    });
    expect(serialized).not.toContain('private image text');
    expect(serialized).not.toContain('asset://localhost/private-image');
  });

  it('returns a hashed Native process identity for restart fencing', async () => {
    privateState.platform = 'native';
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        processId: 321,
        bootId: 'boot-secret',
        sourceCommit: __PT_SOURCE_COMMIT__,
        executableSha256: 'a'.repeat(64),
      },
    });

    const result = await harness().snapshot();
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      platform: 'native',
      authenticationState: 'AUTHENTICATED',
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
    expect((result as { sourceCommit?: string }).sourceCommit).toBe(
      __PT_SOURCE_COMMIT__,
    );
    expect(serialized).not.toContain('boot-secret');
    expect(result).not.toHaveProperty('processId');
    expect(result).not.toHaveProperty('bootId');
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
      sessionIdentitySha256: string;
    };
    const unchanged = await harness().snapshot() as {
      sessionIdentitySha256: string;
    };

    sessionState.sessionEpoch += 1;
    const replaced = await harness().snapshot() as {
      sessionIdentitySha256: string;
    };

    expect(first.sessionIdentitySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(unchanged.sessionIdentitySha256).toBe(first.sessionIdentitySha256);
    expect(replaced.sessionIdentitySha256).not.toBe(first.sessionIdentitySha256);
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
    expect(result).not.toHaveProperty('actorPtidSha256');
    expect(invoke).not.toHaveBeenCalled();
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
