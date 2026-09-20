import { convertFileSrc, invoke } from '@tauri-apps/api/core';

export const PRIVATE_MOMENTS_COMMANDS = {
  bootstrap: 'social_private_moments_bootstrap',
  reconcile: 'social_private_moments_reconcile',
  publish: 'social_private_moment_publish',
  read: 'social_private_moment_read',
  openMedia: 'social_private_moment_media_open',
  recover: 'social_private_moment_recover',
  purge: 'social_private_moment_purge',
  teardown: 'social_private_moments_teardown',
} as const;

export type PrivateMomentsPlatform = 'native' | 'browser' | 'unknown';

export type PrivatePublishState =
  | 'IDLE'
  | 'AUDIENCE_REQUIRED'
  | 'CHECKING_PRIVATE_READINESS'
  | 'READY_PRIVATE'
  | 'PRIVATE_UNSUPPORTED'
  | 'RECIPIENT_KEY_UNAVAILABLE'
  | 'AUDIENCE_TOO_LARGE'
  | 'PUBLISHING'
  | 'UNKNOWN_COMMIT'
  | 'PUBLISHED'
  | 'PUBLISH_FAILED';

export type PrivateReadState =
  | 'LOADING_AUTHORIZED_RESOURCE'
  | 'WAITING_FOR_PRIVATE_KEY'
  | 'RECOVERY_REQUIRED'
  | 'RECOVERY_KEY_UNAVAILABLE'
  | 'DECRYPTING'
  | 'CONTENT_READY'
  | 'AUTHENTICATION_REQUIRED'
  | 'NOT_FOUND_OR_NOT_AUTHORIZED'
  | 'INTEGRITY_FAILURE'
  | 'PRIVATE_UNSUPPORTED_ON_DEVICE'
  | 'DELETED_OR_REVOKED';

export type PrivateMediaState =
  | 'MEDIA_PLACEHOLDER'
  | 'MEDIA_GRANT_PENDING'
  | 'MEDIA_DOWNLOADING'
  | 'MEDIA_DECRYPTING'
  | 'MEDIA_READY'
  | 'MEDIA_ACCESS_DENIED'
  | 'MEDIA_INTEGRITY_FAILURE'
  | 'MEDIA_OFFLINE_RETRYABLE';

export interface PrivateMomentLocalFileIntent {
  intentId: string;
  filePath: string;
  previewSrc: string;
}

export interface PrivateMomentMediaProjection {
  objectId: string;
  state: PrivateMediaState;
  renderUrl?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  altText?: string;
  errorCode?: string;
}

export type PrivateMomentContentProjection =
  | {
      kind: 'TEXT';
      text: string;
    }
  | {
      kind: 'IMAGE';
      text: string;
      media: PrivateMomentMediaProjection[];
    };

export interface PrivateMomentProjection {
  postId: string;
  contentId: string;
  generation: string;
  authorPtid: string;
  audienceKind: 'FRIENDS';
  state: PrivateReadState;
  content?: PrivateMomentContentProjection;
  errorCode?: string;
  retryAfterSeconds?: number;
  createdAtMillis?: number;
  updatedAtMillis?: number;
}

export interface PrivateMomentsNativeSnapshot {
  actorPtid: string;
  deviceId: string;
  sessionGeneration: string;
  projections: PrivateMomentProjection[];
}

export interface PrivateMomentPublishIntent {
  actorPtid: string;
  rendererGeneration: number;
  draftId: string;
  draftRevision: number;
  audienceKind: 'FRIENDS';
  text: string;
  files: PrivateMomentLocalFileIntent[];
}

export interface PrivateMomentPublishResult {
  state: Extract<PrivatePublishState, 'UNKNOWN_COMMIT' | 'PUBLISHED'>;
  draftId: string;
  postId?: string;
  projection?: PrivateMomentProjection;
}

interface NativeCommandResult<T> {
  ok: boolean;
  data?: T | { status?: string };
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}

interface NativeSnapshotWire {
  actor_ptid?: unknown;
  actorPtid?: unknown;
  device_id?: unknown;
  deviceId?: unknown;
  session_generation?: unknown;
  sessionGeneration?: unknown;
  projections?: unknown;
}

interface NativeProjectionWire {
  post_id?: unknown;
  postId?: unknown;
  content_id?: unknown;
  contentId?: unknown;
  generation?: unknown;
  author_ptid?: unknown;
  authorPtid?: unknown;
  audience_kind?: unknown;
  audienceKind?: unknown;
  state?: unknown;
  content?: unknown;
  error_code?: unknown;
  errorCode?: unknown;
  retry_after_seconds?: unknown;
  retryAfterSeconds?: unknown;
  created_at_millis?: unknown;
  createdAtMillis?: unknown;
  updated_at_millis?: unknown;
  updatedAtMillis?: unknown;
}

const PUBLISH_STATES = new Set<PrivatePublishState>([
  'IDLE',
  'AUDIENCE_REQUIRED',
  'CHECKING_PRIVATE_READINESS',
  'READY_PRIVATE',
  'PRIVATE_UNSUPPORTED',
  'RECIPIENT_KEY_UNAVAILABLE',
  'AUDIENCE_TOO_LARGE',
  'PUBLISHING',
  'UNKNOWN_COMMIT',
  'PUBLISHED',
  'PUBLISH_FAILED',
]);

const READ_STATES = new Set<PrivateReadState>([
  'LOADING_AUTHORIZED_RESOURCE',
  'WAITING_FOR_PRIVATE_KEY',
  'RECOVERY_REQUIRED',
  'RECOVERY_KEY_UNAVAILABLE',
  'DECRYPTING',
  'CONTENT_READY',
  'AUTHENTICATION_REQUIRED',
  'NOT_FOUND_OR_NOT_AUTHORIZED',
  'INTEGRITY_FAILURE',
  'PRIVATE_UNSUPPORTED_ON_DEVICE',
  'DELETED_OR_REVOKED',
]);

const MEDIA_STATES = new Set<PrivateMediaState>([
  'MEDIA_PLACEHOLDER',
  'MEDIA_GRANT_PENDING',
  'MEDIA_DOWNLOADING',
  'MEDIA_DECRYPTING',
  'MEDIA_READY',
  'MEDIA_ACCESS_DENIED',
  'MEDIA_INTEGRITY_FAILURE',
  'MEDIA_OFFLINE_RETRYABLE',
]);

export class PrivateMomentsNativeError extends Error {
  readonly code: string;
  readonly state: PrivatePublishState | PrivateReadState;
  readonly retryAfterSeconds?: number;

  constructor(options: {
    code: string;
    state: PrivatePublishState | PrivateReadState;
    message?: string;
    retryAfterSeconds?: number;
  }) {
    super(options.message || options.code);
    this.name = 'PrivateMomentsNativeError';
    this.code = options.code;
    this.state = options.state;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function resolvePrivateMomentsPlatform(): PrivateMomentsPlatform {
  if (typeof window === 'undefined') return 'unknown';
  if ('__PT_GATEWAY_BASE__' in window) return 'browser';
  if ('__TAURI_INTERNALS__' in window) return 'native';
  return 'unknown';
}

function assertNative(state: 'PRIVATE_UNSUPPORTED' | 'PRIVATE_UNSUPPORTED_ON_DEVICE'): void {
  if (resolvePrivateMomentsPlatform() === 'native') return;
  throw new PrivateMomentsNativeError({
    code: state,
    state,
    message: state,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function generationField(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  const raw = stringField(value);
  return /^\d+$/.test(raw) ? raw : '';
}

function privateProjectionContractError(message: string): PrivateMomentsNativeError {
  return new PrivateMomentsNativeError({
    code: 'PRIVATE_PROJECTION_INVALID',
    state: 'INTEGRITY_FAILURE',
    message,
  });
}

function normalizeMedia(value: unknown): PrivateMomentMediaProjection {
  if (!isRecord(value)) {
    throw privateProjectionContractError('private media projection is malformed');
  }
  const objectId = stringField(value.object_id ?? value.objectId);
  const state = stringField(value.state) as PrivateMediaState;
  if (!objectId || !MEDIA_STATES.has(state)) {
    throw privateProjectionContractError('private media projection identity or state is invalid');
  }

  const localPath = stringField(value.local_path ?? value.localPath);
  if (localPath) {
    throw privateProjectionContractError('private media projection exposed a local path');
  }
  const grantId = stringField(value.render_url ?? value.renderUrl);
  if (grantId && !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(grantId)) {
    throw privateProjectionContractError('private media projection exposed an invalid grant');
  }
  const renderUrl = grantId
    ? convertFileSrc(grantId, 'private-media')
    : undefined;
  if (renderUrl && !isSafeNativeRenderUrl(renderUrl)) {
    throw privateProjectionContractError('private media projection exposed a non-local render URL');
  }
  if (state === 'MEDIA_READY' && !renderUrl) {
    throw privateProjectionContractError('ready private media projection is missing a local render URL');
  }

  return {
    objectId,
    state,
    renderUrl,
    mimeType: stringField(value.mime_type ?? value.mimeType) || undefined,
    width: optionalNumber(value.width),
    height: optionalNumber(value.height),
    altText: stringField(value.alt_text ?? value.altText) || undefined,
    errorCode: stringField(value.error_code ?? value.errorCode) || undefined,
  };
}

function isSafeNativeRenderUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'private-media:' && url.hostname === 'localhost')
      || ((url.protocol === 'http:' || url.protocol === 'https:')
        && url.hostname === 'private-media.localhost');
  } catch {
    return false;
  }
}

function normalizeContent(value: unknown): PrivateMomentContentProjection | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    throw privateProjectionContractError('private content projection is malformed');
  }
  const kind = stringField(value.kind).toUpperCase();
  const text = typeof value.text === 'string' ? value.text : '';
  if (kind === 'TEXT') return { kind, text };
  if (kind === 'IMAGE') {
    const media = Array.isArray(value.media) ? value.media.map(normalizeMedia) : [];
    return { kind, text, media };
  }
  throw privateProjectionContractError('private content projection kind is unsupported');
}

export function normalizePrivateMomentProjection(value: unknown): PrivateMomentProjection {
  if (!isRecord(value)) {
    throw privateProjectionContractError('private Moment projection is malformed');
  }
  const wire = value as NativeProjectionWire;
  const postId = stringField(wire.post_id ?? wire.postId);
  const contentId = stringField(wire.content_id ?? wire.contentId);
  const generation = generationField(wire.generation);
  const authorPtid = stringField(wire.author_ptid ?? wire.authorPtid);
  const audienceKind = stringField(wire.audience_kind ?? wire.audienceKind).toUpperCase();
  const state = stringField(wire.state).toUpperCase() as PrivateReadState;
  if (
    !postId
    || !contentId
    || !generation
    || audienceKind !== 'FRIENDS'
    || !READ_STATES.has(state)
    || (state === 'CONTENT_READY' && !authorPtid)
  ) {
    throw privateProjectionContractError('private Moment projection identity or state is invalid');
  }

  const content = normalizeContent(wire.content);
  if (state === 'CONTENT_READY' && !content) {
    throw privateProjectionContractError('ready private Moment projection is missing decrypted content');
  }
  if (state !== 'CONTENT_READY' && content) {
    throw privateProjectionContractError('non-ready private Moment projection exposed plaintext');
  }

  return {
    postId,
    contentId,
    generation,
    authorPtid,
    audienceKind: 'FRIENDS',
    state,
    content,
    errorCode: stringField(wire.error_code ?? wire.errorCode) || undefined,
    retryAfterSeconds: optionalNumber(wire.retry_after_seconds ?? wire.retryAfterSeconds),
    createdAtMillis: optionalNumber(wire.created_at_millis ?? wire.createdAtMillis),
    updatedAtMillis: optionalNumber(wire.updated_at_millis ?? wire.updatedAtMillis),
  };
}

function normalizeSnapshot(value: unknown): PrivateMomentsNativeSnapshot {
  if (!isRecord(value)) {
    throw privateProjectionContractError('private Moments snapshot is malformed');
  }
  const wire = value as NativeSnapshotWire;
  const actorPtid = stringField(wire.actor_ptid ?? wire.actorPtid);
  const deviceId = stringField(wire.device_id ?? wire.deviceId);
  const sessionGeneration = generationField(
    wire.session_generation ?? wire.sessionGeneration,
  );
  if (!actorPtid || !deviceId || !sessionGeneration || !Array.isArray(wire.projections)) {
    throw privateProjectionContractError('private Moments snapshot identity is incomplete');
  }
  return {
    actorPtid,
    deviceId,
    sessionGeneration,
    projections: wire.projections.map(normalizePrivateMomentProjection),
  };
}

function normalizePublishResult(value: unknown): PrivateMomentPublishResult {
  if (!isRecord(value)) {
    throw privateProjectionContractError('private publish result is malformed');
  }
  const state = stringField(value.state).toUpperCase() as PrivatePublishState;
  if (!PUBLISH_STATES.has(state) || (state !== 'PUBLISHED' && state !== 'UNKNOWN_COMMIT')) {
    throw privateProjectionContractError('private publish result state is invalid');
  }
  const draftId = stringField(value.draft_id ?? value.draftId);
  if (!draftId) {
    throw privateProjectionContractError('private publish result draft identity is missing');
  }
  const projectionValue = value.projection;
  return {
    state,
    draftId,
    postId: stringField(value.post_id ?? value.postId) || undefined,
    projection: projectionValue ? normalizePrivateMomentProjection(projectionValue) : undefined,
  };
}

function unpackNativeData(data: unknown): unknown {
  if (!data) return undefined;
  if (isRecord(data) && typeof data.status === 'string') {
    try {
      return JSON.parse(data.status);
    } catch {
      throw privateProjectionContractError('private Native adapter returned malformed JSON');
    }
  }
  return data;
}

function stateFromNativeError(
  error: NativeCommandResult<unknown>['error'],
  fallback: PrivatePublishState | PrivateReadState,
): PrivatePublishState | PrivateReadState {
  const candidate = stringField(error?.details?.state).toUpperCase();
  if (PUBLISH_STATES.has(candidate as PrivatePublishState)) {
    return candidate as PrivatePublishState;
  }
  if (READ_STATES.has(candidate as PrivateReadState)) {
    return candidate as PrivateReadState;
  }
  if (error?.code === 'UNAUTHORIZED') return 'AUTHENTICATION_REQUIRED';
  return fallback;
}

async function invokePrivateNative<T>(
  command: string,
  input: Record<string, unknown>,
  fallbackState: PrivatePublishState | PrivateReadState,
): Promise<T> {
  const result = await invoke<NativeCommandResult<T>>(command, { input });
  if (!result.ok || result.data === undefined) {
    throw new PrivateMomentsNativeError({
      code: stringField(result.error?.code) || 'PRIVATE_NATIVE_COMMAND_FAILED',
      state: stateFromNativeError(result.error, fallbackState),
      message: stringField(result.error?.message) || `${command} failed`,
      retryAfterSeconds: optionalNumber(result.error?.details?.retry_after_seconds),
    });
  }
  return unpackNativeData(result.data) as T;
}

function nativeIntent(intent: PrivateMomentPublishIntent): Record<string, unknown> {
  return {
    actor_ptid: intent.actorPtid,
    renderer_generation: intent.rendererGeneration,
    draft_id: intent.draftId,
    draft_revision: intent.draftRevision,
    audience_kind: intent.audienceKind,
    text: intent.text,
    files: intent.files.map((file) => ({
      intent_id: file.intentId,
      file_path: file.filePath,
    })),
  };
}

export const privateMomentsNative = {
  platform: resolvePrivateMomentsPlatform,

  async bootstrap(input: {
    actorPtid: string;
    rendererGeneration: number;
  }): Promise<PrivateMomentsNativeSnapshot> {
    assertNative('PRIVATE_UNSUPPORTED_ON_DEVICE');
    return normalizeSnapshot(await invokePrivateNative(
      PRIVATE_MOMENTS_COMMANDS.bootstrap,
      {
        actor_ptid: input.actorPtid,
        renderer_generation: input.rendererGeneration,
      },
      'INTEGRITY_FAILURE',
    ));
  },

  async reconcile(input: {
    actorPtid: string;
    rendererGeneration: number;
    postIds: string[];
    reason: string;
  }): Promise<PrivateMomentsNativeSnapshot> {
    assertNative('PRIVATE_UNSUPPORTED_ON_DEVICE');
    return normalizeSnapshot(await invokePrivateNative(
      PRIVATE_MOMENTS_COMMANDS.reconcile,
      {
        actor_ptid: input.actorPtid,
        renderer_generation: input.rendererGeneration,
        post_ids: input.postIds,
        reason: input.reason,
      },
      'INTEGRITY_FAILURE',
    ));
  },

  async publish(intent: PrivateMomentPublishIntent): Promise<PrivateMomentPublishResult> {
    assertNative('PRIVATE_UNSUPPORTED');
    return normalizePublishResult(await invokePrivateNative(
      PRIVATE_MOMENTS_COMMANDS.publish,
      nativeIntent(intent),
      'PUBLISH_FAILED',
    ));
  },

  async read(input: {
    actorPtid: string;
    rendererGeneration: number;
    postId: string;
  }): Promise<PrivateMomentProjection> {
    assertNative('PRIVATE_UNSUPPORTED_ON_DEVICE');
    return normalizePrivateMomentProjection(await invokePrivateNative(
      PRIVATE_MOMENTS_COMMANDS.read,
      {
        actor_ptid: input.actorPtid,
        renderer_generation: input.rendererGeneration,
        post_id: input.postId,
      },
      'NOT_FOUND_OR_NOT_AUTHORIZED',
    ));
  },

  async openMedia(input: {
    actorPtid: string;
    rendererGeneration: number;
    postId: string;
    objectId: string;
  }): Promise<PrivateMomentProjection> {
    assertNative('PRIVATE_UNSUPPORTED_ON_DEVICE');
    return normalizePrivateMomentProjection(await invokePrivateNative(
      PRIVATE_MOMENTS_COMMANDS.openMedia,
      {
        actor_ptid: input.actorPtid,
        renderer_generation: input.rendererGeneration,
        post_id: input.postId,
        object_id: input.objectId,
      },
      'NOT_FOUND_OR_NOT_AUTHORIZED',
    ));
  },

  async recover(input: {
    actorPtid: string;
    rendererGeneration: number;
    postId: string;
  }): Promise<PrivateMomentProjection> {
    assertNative('PRIVATE_UNSUPPORTED_ON_DEVICE');
    return normalizePrivateMomentProjection(await invokePrivateNative(
      PRIVATE_MOMENTS_COMMANDS.recover,
      {
        actor_ptid: input.actorPtid,
        renderer_generation: input.rendererGeneration,
        post_id: input.postId,
      },
      'RECOVERY_KEY_UNAVAILABLE',
    ));
  },

  async purge(input: {
    actorPtid: string;
    rendererGeneration: number;
    postId: string;
  }): Promise<void> {
    if (resolvePrivateMomentsPlatform() !== 'native') return;
    await invokePrivateNative(
      PRIVATE_MOMENTS_COMMANDS.purge,
      {
        actor_ptid: input.actorPtid,
        renderer_generation: input.rendererGeneration,
        post_id: input.postId,
      },
      'INTEGRITY_FAILURE',
    );
  },

  async teardown(input: {
    actorPtid: string;
    rendererGeneration: number;
  }): Promise<void> {
    if (resolvePrivateMomentsPlatform() !== 'native') return;
    await invokePrivateNative(
      PRIVATE_MOMENTS_COMMANDS.teardown,
      {
        actor_ptid: input.actorPtid,
        renderer_generation: input.rendererGeneration,
      },
      'PRIVATE_UNSUPPORTED_ON_DEVICE',
    );
  },
};
