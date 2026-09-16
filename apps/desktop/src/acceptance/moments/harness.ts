import { create } from '@bufbuild/protobuf';
import { invoke } from '@tauri-apps/api/core';
import {
  AudienceSchema,
  Audience_Kind,
  type Post,
} from '../../gen/proto/domain/social/post_pb';
import type {
  PrivateMomentMediaProjection,
  PrivateMomentProjection,
} from '../../services/privateMomentsNative';
import { api } from '../../services/desktop_api';
import { useMomentsStore, type MomentComposerDraft } from '../../store/moments';
import { usePrivateMomentsStore } from '../../store/privateMoments';
import { useSessionStore } from '../../store/session';
import { registerAcceptanceHarness } from '../registry';

declare const __PT_SOURCE_COMMIT__: string;

let rendererArtifactSha256Promise: Promise<string> | null = null;

interface StageFriendsDraftInput {
  draftId: string;
  revision: number;
  text: string;
  files?: Array<{
    intentId: string;
    filePath: string;
  }>;
}

interface PrivateMomentInput {
  postId: string;
  openMedia?: boolean;
}

interface PublicMomentInput {
  text: string;
  filePath?: string;
}

interface RuntimeIdentityResult {
  ok: boolean;
  data?: {
    processId?: unknown;
    bootId?: unknown;
    sourceCommit?: unknown;
    executableSha256?: unknown;
    stationRuntimeIdentitySha256?: unknown;
    stationEndpointSha256?: unknown;
  };
}

async function sha256(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function activeSessionIdentity() {
  const session = useSessionStore.getState();
  const actorPtid = session.currentUser?.actorPtid?.trim() || undefined;
  if (
    !Number.isSafeInteger(session.sessionEpoch)
    || session.sessionEpoch < 0
  ) {
    throw new Error('moments.acceptance.sessionIdentityMissing');
  }
  const authenticationState = actorPtid ? 'AUTHENTICATED' : 'ANONYMOUS';
  return {
    actorPtid,
    authenticationState,
    sessionIdentitySha256: await sha256(JSON.stringify({
      schemaVersion: 1,
      authenticationState,
      actorPtid: actorPtid ?? null,
      sessionEpoch: session.sessionEpoch,
    })),
  };
}

function rendererArtifactSha256(): Promise<string> {
  if (rendererArtifactSha256Promise) return rendererArtifactSha256Promise;
  rendererArtifactSha256Promise = (async () => {
    const candidates = new Set<string>();
    for (const script of Array.from(document.scripts)) {
      if (script.src) {
        const url = new URL(script.src, window.location.href);
        if (url.origin === window.location.origin) candidates.add(url.href);
      }
    }
    for (const entry of performance.getEntriesByType('resource')) {
      const resource = entry as PerformanceResourceTiming;
      if (resource.initiatorType === 'script' && resource.name) {
        const url = new URL(resource.name, window.location.href);
        if (url.origin === window.location.origin) candidates.add(url.href);
      }
    }
    if (candidates.size === 0) {
      throw new Error('moments.acceptance.rendererArtifactMissing');
    }
    const artifacts = await Promise.all(
      [...candidates].sort().map(async (url) => {
        const parsed = new URL(url);
        const response = await fetch(url, {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!response.ok) {
          throw new Error('moments.acceptance.rendererArtifactFetchFailed');
        }
        return {
          path: parsed.pathname,
          sha256: await sha256(await response.arrayBuffer()),
        };
      }),
    );
    return sha256(JSON.stringify({
      schemaVersion: 1,
      sourceCommit: __PT_SOURCE_COMMIT__,
      artifacts,
    }));
  })();
  return rendererArtifactSha256Promise;
}

async function browserStationIdentitySha256(): Promise<{
  stationRuntimeIdentitySha256: string;
  stationEndpointSha256: string;
}> {
  const first = resolveBoundBrowserStation(await api.stationList());
  const confirmed = resolveBoundBrowserStation(await api.stationList());
  if (
    first.generation !== confirmed.generation
    || first.stationPeerId !== confirmed.stationPeerId
    || first.stationUrl !== confirmed.stationUrl
  ) {
    throw new Error('moments.acceptance.stationIdentityMissing');
  }
  return {
    stationRuntimeIdentitySha256: await sha256(confirmed.stationPeerId),
    stationEndpointSha256: await sha256(confirmed.stationUrl),
  };
}

function resolveBoundBrowserStation(
  registry: Awaited<ReturnType<typeof api.stationList>>,
): {
  generation: number;
  stationPeerId: string;
  stationUrl: string;
} {
  const boundUrl = typeof registry.binding?.bound_url === 'string'
    ? registry.binding.bound_url.trim().replace(/\/+$/, '')
    : '';
  const activeUrl = typeof registry.active_url === 'string'
    ? registry.active_url.trim().replace(/\/+$/, '')
    : '';
  if (
    registry.binding?.phase !== 'bound'
    || !Number.isSafeInteger(registry.binding.generation)
    || registry.binding.generation < 0
    || !boundUrl
    || !activeUrl
    || boundUrl !== activeUrl
  ) {
    throw new Error('moments.acceptance.stationIdentityMissing');
  }
  const activeEntry = registry.entries.find(
    (entry) => entry.url.trim().replace(/\/+$/, '') === boundUrl,
  );
  const stationPeerId = activeEntry?.peer_id;
  if (
    typeof stationPeerId !== 'string'
    || !stationPeerId.trim()
    || stationPeerId !== stationPeerId.trim()
  ) {
    throw new Error('moments.acceptance.stationIdentityMissing');
  }
  return {
    generation: registry.binding.generation,
    stationPeerId,
    stationUrl: boundUrl,
  };
}

async function nativeRuntimeIdentitySha256(
  platform: string,
): Promise<{
  nativeRuntimeIdentitySha256?: string;
  stationRuntimeIdentitySha256: string;
  stationEndpointSha256: string;
  clientArtifactSha256: string;
}> {
  if (platform !== 'native') {
    return {
      ...await browserStationIdentitySha256(),
      clientArtifactSha256: await rendererArtifactSha256(),
    };
  }
  const result = await invoke<RuntimeIdentityResult>(
    'social_private_moments_acceptance_runtime_identity',
  );
  const processId = result.data?.processId;
  const bootId = result.data?.bootId;
  const sourceCommit = result.data?.sourceCommit;
  const executableSha256 = result.data?.executableSha256;
  const stationRuntimeIdentitySha256 =
    result.data?.stationRuntimeIdentitySha256;
  const stationEndpointSha256 = result.data?.stationEndpointSha256;
  if (
    result.ok !== true
    || typeof processId !== 'number'
    || !Number.isSafeInteger(processId)
    || typeof bootId !== 'string'
    || !bootId
    || sourceCommit !== __PT_SOURCE_COMMIT__
    || typeof executableSha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(executableSha256)
    || typeof stationRuntimeIdentitySha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(stationRuntimeIdentitySha256)
    || typeof stationEndpointSha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(stationEndpointSha256)
  ) {
    throw new Error('moments.acceptance.nativeRuntimeIdentityMissing');
  }
  return {
    nativeRuntimeIdentitySha256: await sha256(`${processId}:${bootId}`),
    stationRuntimeIdentitySha256,
    stationEndpointSha256,
    clientArtifactSha256: await sha256(JSON.stringify({
      schemaVersion: 1,
      executableSha256,
      rendererArtifactSha256: await rendererArtifactSha256(),
      sourceCommit: __PT_SOURCE_COMMIT__,
    })),
  };
}

async function draftEvidence(draft: MomentComposerDraft | null) {
  if (!draft) {
    return {
      present: false,
      fileCount: 0,
      files: [],
    };
  }
  return {
    present: true,
    draftIdSha256: await sha256(draft.draftId),
    revision: draft.revision,
    textSha256: await sha256(draft.text),
    textByteLength: new TextEncoder().encode(draft.text).byteLength,
    audienceKind: draft.audience.kind === Audience_Kind.FRIENDS
      ? 'FRIENDS'
      : 'OTHER',
    fileCount: draft.files.length,
    files: await Promise.all(draft.files.map(async (file) => ({
      intentIdSha256: await sha256(file.intentId),
      filePathSha256: await sha256(file.filePath),
    }))),
  };
}

async function mediaEvidence(media: PrivateMomentMediaProjection) {
  let plaintextSha256: string | undefined;
  let byteLength: number | undefined;
  if (media.state === 'MEDIA_READY') {
    if (!media.renderUrl) {
      throw new Error('moments.acceptance.readyMediaUrlMissing');
    }
    const response = await fetch(media.renderUrl, {
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!response.ok) {
      throw new Error('moments.acceptance.readyMediaFetchFailed');
    }
    const bytes = await response.arrayBuffer();
    plaintextSha256 = await sha256(bytes);
    byteLength = bytes.byteLength;
  }
  return {
    objectIdSha256: await sha256(media.objectId),
    state: media.state,
    mimeType: media.mimeType,
    plaintextSha256,
    byteLength,
  };
}

async function privateProjectionEvidence(
  projection: PrivateMomentProjection,
) {
  const content = projection.content;
  const text = content?.text ?? '';
  return {
    platform: usePrivateMomentsStore.getState().platform,
    state: projection.state,
    errorCode: projection.errorCode,
    postIdSha256: await sha256(projection.postId),
    contentIdSha256: await sha256(projection.contentId),
    authorPtidSha256: projection.authorPtid
      ? await sha256(projection.authorPtid)
      : undefined,
    generationSha256: await sha256(projection.generation),
    contentKind: content?.kind,
    textSha256: content ? await sha256(text) : undefined,
    textByteLength: content
      ? new TextEncoder().encode(text).byteLength
      : undefined,
    media: content?.kind === 'IMAGE'
      ? await Promise.all(content.media.map(mediaEvidence))
      : [],
  };
}

function publicPostText(post: Post): string {
  switch (post.content.case) {
    case 'textPost':
    case 'imagePost':
    case 'videoPost':
    case 'linkPost':
    case 'pollPost':
    case 'locationPost':
      return post.content.value.text;
    case 'repostPost':
      return post.content.value.comment;
    default:
      return '';
  }
}

async function publicPostEvidence(post: Post) {
  const text = publicPostText(post);
  const images = post.content.case === 'imagePost'
    ? post.content.value.images
    : [];
  const media = await Promise.all(images.map(async (image) => {
    const resolved = await api.ossResolveUrl(image.url);
    const source = resolved?.data_url || resolved?.url;
    if (!source) {
      throw new Error('moments.acceptance.publicMediaResolveFailed');
    }
    const response = await fetch(source, {
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!response.ok) {
      throw new Error('moments.acceptance.publicMediaFetchFailed');
    }
    const bytes = await response.arrayBuffer();
    return {
      plaintextSha256: await sha256(bytes),
      byteLength: bytes.byteLength,
    };
  }));
  return {
    found: true,
    postIdSha256: await sha256(post.id),
    textSha256: await sha256(text),
    textByteLength: new TextEncoder().encode(text).byteLength,
    media,
  };
}

export function installAcceptanceHarness(): void {
  rendererArtifactSha256Promise = null;
  registerAcceptanceHarness('moments', {
    async snapshot() {
      const privateState = usePrivateMomentsStore.getState();
      const sessionIdentity = await activeSessionIdentity();
      const runtimeIdentity = await nativeRuntimeIdentitySha256(
        privateState.platform,
      );
      return {
        platform: privateState.platform,
        sourceCommit: __PT_SOURCE_COMMIT__,
        authenticationState: sessionIdentity.authenticationState,
        sessionIdentitySha256: sessionIdentity.sessionIdentitySha256,
        ...(sessionIdentity.actorPtid
          ? { actorPtidSha256: await sha256(sessionIdentity.actorPtid) }
          : {}),
        ...runtimeIdentity,
        draft: await draftEvidence(useMomentsStore.getState().composerDraft),
        publishState: privateState.publish.state,
        privateProjectionCount: Object.keys(privateState.postsById).length,
      };
    },

    async stageFriendsDraft(input: StageFriendsDraftInput) {
      if (
        !input
        || !input.draftId?.trim()
        || !Number.isSafeInteger(input.revision)
        || input.revision < 1
        || !input.text?.trim()
      ) {
        throw new Error('moments.acceptance.invalidDraft');
      }
      useMomentsStore.getState().setComposerDraft({
        draftId: input.draftId,
        revision: input.revision,
        text: input.text,
        audience: create(AudienceSchema, { kind: Audience_Kind.FRIENDS }),
        mentions: [],
        files: (input.files ?? []).map((file) => ({
          intentId: file.intentId,
          filePath: file.filePath,
          previewSrc: '',
        })),
      });
      return draftEvidence(useMomentsStore.getState().composerDraft);
    },

    async publishFriendsDraft() {
      const moments = useMomentsStore.getState();
      const draft = moments.composerDraft;
      if (!draft) {
        throw new Error('moments.acceptance.draftMissing');
      }
      let transientPostId: string | undefined;
      try {
        transientPostId = await moments.createPost({
          kind: draft.files.length > 0 ? 'image' : 'text',
          text: draft.text,
          imageIds: [],
          localFiles: draft.files,
          audience: draft.audience,
          draftId: draft.draftId,
          draftRevision: draft.revision,
          mentions: draft.mentions,
        });
      } catch {
        // The production store owns the typed failure projection.
      }
      const publish = usePrivateMomentsStore.getState().publish;
      return {
        platform: usePrivateMomentsStore.getState().platform,
        state: publish.state,
        errorCode: publish.errorCode,
        ...(transientPostId
          ? {
              postIdSha256: await sha256(transientPostId),
              transientPostId,
            }
          : {}),
        draft: await draftEvidence(useMomentsStore.getState().composerDraft),
      };
    },

    async readPrivateMoment(input: PrivateMomentInput) {
      if (!input?.postId?.trim()) {
        throw new Error('moments.acceptance.postIdMissing');
      }
      const store = usePrivateMomentsStore.getState();
      await store.readMoment(input.postId);
      let projection = usePrivateMomentsStore.getState().postsById[input.postId];
      if (!projection) {
        throw new Error('moments.acceptance.privateProjectionMissing');
      }
      if (input.openMedia && projection.content?.kind === 'IMAGE') {
        for (const media of projection.content.media) {
          await usePrivateMomentsStore.getState().openMedia(
            input.postId,
            media.objectId,
          );
        }
        projection = usePrivateMomentsStore.getState().postsById[input.postId];
      }
      if (!projection) {
        throw new Error('moments.acceptance.privateProjectionMissing');
      }
      return privateProjectionEvidence(projection);
    },

    async findPublicMoment(input: PublicMomentInput) {
      if (!input?.text?.trim()) {
        throw new Error('moments.acceptance.publicTextMissing');
      }
      const store = useMomentsStore.getState();
      await store.loadFeed('explore', { refresh: true, sort: 'recent' });
      const current = useMomentsStore.getState();
      const post = current.feeds.explore.postIds
        .map((postId) => current.postsById[postId])
        .find((candidate) => candidate && publicPostText(candidate) === input.text);
      if (!post) {
        return {
          found: false,
          textSha256: await sha256(input.text),
          media: [],
        };
      }
      return publicPostEvidence(post);
    },

    async publishPublicMoment(input: PublicMomentInput) {
      if (!input?.text?.trim()) {
        throw new Error('moments.acceptance.publicTextMissing');
      }
      const audience = create(AudienceSchema, { kind: Audience_Kind.PUBLIC });
      let postId: string;
      if (input.filePath) {
        const uploaded = await api.ossUploadEncryptedAttachmentSocial(
          input.filePath,
        );
        if (!uploaded?.cid) {
          throw new Error('moments.acceptance.publicMediaUploadFailed');
        }
        postId = await useMomentsStore.getState().createPost({
          kind: 'image',
          text: input.text,
          imageIds: [uploaded.cid],
          audience,
        });
      } else {
        postId = await useMomentsStore.getState().createPost({
          kind: 'text',
          text: input.text,
          audience,
        });
      }
      return {
        published: true,
        mediaCount: input.filePath ? 1 : 0,
        transientPostId: postId,
        postIdSha256: await sha256(postId),
        textSha256: await sha256(input.text),
      };
    },

    async clearLocalState() {
      const moments = useMomentsStore.getState();
      moments.clearComposerDraft();
      const privateMoments = usePrivateMomentsStore.getState();
      privateMoments.clearPublishState();
      return {
        draftPresent: useMomentsStore.getState().composerDraft !== null,
        publishState: usePrivateMomentsStore.getState().publish.state,
      };
    },
  });
}
