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
export type PrivateAudienceKind =
  | 'FRIENDS'
  | 'FOLLOWERS'
  | 'CIRCLE'
  | 'GROUP'
  | 'SELF'
  | 'CUSTOM_ALLOW'
  | 'CUSTOM_DENY';

export type PrivateMomentAudience =
  | { kind: 'FRIENDS' | 'FOLLOWERS' | 'SELF' }
  | { kind: 'CIRCLE'; circleId: string }
  | { kind: 'GROUP'; groupConversationId: string }
  | { kind: 'CUSTOM_ALLOW'; actorPtids: string[] }
  | {
      kind: 'CUSTOM_DENY';
      actorPtids: string[];
      baseKind: 'FOLLOWERS';
    };

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

export interface PrivateMomentMention {
  actorPtid: string;
  offset: number;
  length: number;
  display: string;
}

export interface PrivateMomentLocalFileIntent {
  intentId: string;
  filePath: string;
  previewSrc: string;
}

export interface PrivateMomentMediaProjection {
  objectId: string;
  state: PrivateMediaState;
  renderUrl?: string;
  plaintextSha256?: string;
  plaintextSize?: number;
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
    }
  | {
      kind: 'VIDEO';
      text: string;
      media: PrivateMomentMediaProjection[];
    }
  | {
      kind: 'LINK';
      text: string;
      url: string;
      title: string;
    }
  | {
      kind: 'POLL';
      text: string;
      question: string;
      options: string[];
      minChoices: number;
      maxChoices: number;
      expiresAtSeconds: number;
    }
  | {
      kind: 'REPOST';
      comment: string;
      sourcePostId: string;
      sourceAuthorPtid: string;
      sourceKind: Exclude<
        PrivateMomentPublishIntent['momentKind'],
        'REPOST'
      >;
      sourceText: string;
    }
  | {
      kind: 'LOCATION';
      text: string;
      name: string;
      latitude: string;
      longitude: string;
      address: string;
    };

export interface PrivateMomentProjection {
  postId: string;
  contentId: string;
  generation: string;
  authorPtid: string;
  audienceKind: PrivateAudienceKind | 'UNKNOWN';
  state: PrivateReadState;
  mentions: PrivateMomentMention[];
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
  audience: PrivateMomentAudience;
  momentKind: 'TEXT' | 'IMAGE' | 'VIDEO' | 'LINK' | 'POLL' | 'REPOST' | 'LOCATION';
  text: string;
  mentions?: PrivateMomentMention[];
  files: PrivateMomentLocalFileIntent[];
  link?: {
    url: string;
    title: string;
    description?: string;
    imageUrl?: string;
    siteName?: string;
    faviconUrl?: string;
  };
  location?: {
    name: string;
    latitude: number;
    longitude: number;
    address?: string;
    placeId?: string;
  };
  poll?: {
    question: string;
    options: string[];
    minChoices: number;
    maxChoices: number;
    expiresAtSeconds: number;
  };
  repost?: {
    sourcePostId: string;
  };
}

interface PrivateMomentPublishSuccess {
  state: Extract<PrivatePublishState, 'UNKNOWN_COMMIT' | 'PUBLISHED'>;
  draftId: string;
  postId?: string;
  projection?: PrivateMomentProjection;
}

export interface PrivateMomentPublishRejectionEvidence {
  publishPhase: 'PREPARE_REJECTED';
  prepareSucceeded: false;
  receivedPreparePlanCount: number;
  desktopLocalDurableRowCount: number;
  localDraftRowCount: number;
  localCommandRowCount: number;
  localProjectionRowCount: number;
  localUploadRowCount: number;
  claimCountScope: 'NATIVE_RECEIVED_PREPARE_PLAN';
  partialRowScope: 'DESKTOP_LOCAL_DURABLE_STATE';
  serverWriteProof: 'STATION_SOURCE_TEST_REQUIRED';
}

interface PrivateMomentPublishRejection {
  state: 'PRIVATE_UNSUPPORTED';
  draftId: string;
  errorCode: 'PRIVATE_UNSUPPORTED';
  stationErrorCode: string;
  evidence: PrivateMomentPublishRejectionEvidence;
  postId?: undefined;
  projection?: undefined;
}

export type PrivateMomentPublishResult =
  | PrivateMomentPublishSuccess
  | PrivateMomentPublishRejection;

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
  mentions?: unknown;
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
const PRIVATE_AUDIENCE_KINDS = new Set<PrivateAudienceKind>([
  'FRIENDS',
  'FOLLOWERS',
  'CIRCLE',
  'GROUP',
  'SELF',
  'CUSTOM_ALLOW',
  'CUSTOM_DENY',
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
  const plaintextSha256 = stringField(
    value.plaintext_sha256 ?? value.plaintextSha256,
  );
  const plaintextSize = optionalNumber(
    value.plaintext_size ?? value.plaintextSize,
  );
  if (renderUrl && !isSafeNativeRenderUrl(renderUrl)) {
    throw privateProjectionContractError('private media projection exposed a non-local render URL');
  }
  if (
    plaintextSha256
    && !/^[0-9a-f]{64}$/.test(plaintextSha256)
  ) {
    throw privateProjectionContractError('private media projection exposed an invalid plaintext digest');
  }
  if (
    plaintextSize !== undefined
    && (!Number.isSafeInteger(plaintextSize) || plaintextSize <= 0)
  ) {
    throw privateProjectionContractError('private media projection exposed an invalid byte length');
  }
  if (
    state === 'MEDIA_READY'
    && (!renderUrl || !plaintextSha256 || plaintextSize === undefined)
  ) {
    throw privateProjectionContractError('ready private media projection is incomplete');
  }
  if (
    state !== 'MEDIA_READY'
    && (plaintextSha256 || plaintextSize !== undefined)
  ) {
    throw privateProjectionContractError('non-ready private media projection exposed plaintext evidence');
  }

  return {
    objectId,
    state,
    renderUrl,
    plaintextSha256: plaintextSha256 || undefined,
    plaintextSize,
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
  if (kind === 'VIDEO') {
    const media = Array.isArray(value.media) ? value.media.map(normalizeMedia) : [];
    return { kind, text, media };
  }
  if (kind === 'LINK') {
    const url = stringField(value.url);
    const title = stringField(value.title);
    if (!url || !title) {
      throw privateProjectionContractError('private link projection is incomplete');
    }
    return { kind, text, url, title };
  }
  if (kind === 'POLL') {
    const question = stringField(value.question);
    const options = Array.isArray(value.options)
      ? value.options.map(stringField)
      : [];
    const minChoices = optionalNumber(value.min_choices ?? value.minChoices);
    const maxChoices = optionalNumber(value.max_choices ?? value.maxChoices);
    const expiresAtSeconds = optionalNumber(
      value.expires_at_seconds ?? value.expiresAtSeconds,
    );
    if (
      !question
      || options.length < 2
      || options.some((option) => !option)
      || minChoices === undefined
      || maxChoices === undefined
      || expiresAtSeconds === undefined
    ) {
      throw privateProjectionContractError('private poll projection is incomplete');
    }
    return {
      kind,
      text,
      question,
      options,
      minChoices,
      maxChoices,
      expiresAtSeconds,
    };
  }
  if (kind === 'REPOST') {
    const comment = stringField(value.comment);
    const sourcePostId = stringField(value.source_post_id ?? value.sourcePostId);
    const sourceAuthorPtid = stringField(
      value.source_author_ptid ?? value.sourceAuthorPtid,
    );
    const sourceKind = stringField(
      value.source_kind ?? value.sourceKind,
    ) as Exclude<PrivateMomentPublishIntent['momentKind'], 'REPOST'>;
    const sourceText = stringField(value.source_text ?? value.sourceText);
    if (
      !sourcePostId
      || !sourceAuthorPtid
      || !['TEXT', 'IMAGE', 'VIDEO', 'LINK', 'POLL', 'LOCATION'].includes(
        sourceKind,
      )
    ) {
      throw privateProjectionContractError('private repost projection is incomplete');
    }
    return {
      kind,
      comment,
      sourcePostId,
      sourceAuthorPtid,
      sourceKind,
      sourceText,
    };
  }
  if (kind === 'LOCATION') {
    const name = stringField(value.name);
    const latitude = stringField(value.latitude);
    const longitude = stringField(value.longitude);
    if (!name || !latitude || !longitude) {
      throw privateProjectionContractError('private location projection is incomplete');
    }
    return {
      kind,
      text,
      name,
      latitude,
      longitude,
      address: stringField(value.address),
    };
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
  const mentions = Array.isArray(wire.mentions)
    ? wire.mentions.map((value) => {
        if (!isRecord(value)) {
          throw privateProjectionContractError('private Moment mention projection is malformed');
        }
        const actorPtid = stringField(value.actor_ptid ?? value.actorPtid);
        const offset = optionalNumber(value.offset);
        const length = optionalNumber(value.length);
        const display = stringField(value.display);
        if (
          !actorPtid
          || offset === undefined
          || !Number.isInteger(offset)
          || offset < 0
          || length === undefined
          || !Number.isInteger(length)
          || length < 1
          || !display
        ) {
          throw privateProjectionContractError('private Moment mention projection is invalid');
        }
        return { actorPtid, offset, length, display };
      })
    : [];
  if (
    !postId
    || !contentId
    || !generation
    || (
      !PRIVATE_AUDIENCE_KINDS.has(audienceKind as PrivateAudienceKind)
      && !(audienceKind === 'UNKNOWN' && state !== 'CONTENT_READY')
    )
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
  if (state !== 'CONTENT_READY' && mentions.length > 0) {
    throw privateProjectionContractError('non-ready private Moment projection exposed mentions');
  }

  return {
    postId,
    contentId,
    generation,
    authorPtid,
    audienceKind: audienceKind as PrivateAudienceKind | 'UNKNOWN',
    state,
    mentions,
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
  if (!PUBLISH_STATES.has(state)) {
    throw privateProjectionContractError('private publish result state is invalid');
  }
  const draftId = stringField(value.draft_id ?? value.draftId);
  if (!draftId) {
    throw privateProjectionContractError('private publish result draft identity is missing');
  }
  if (state === 'PRIVATE_UNSUPPORTED') {
    const evidenceValue = value.evidence;
    if (!isRecord(evidenceValue)) {
      throw privateProjectionContractError('private publish rejection evidence is missing');
    }
    const receivedPreparePlanCount = optionalCounter(
      evidenceValue.received_prepare_plan_count
        ?? evidenceValue.receivedPreparePlanCount,
    );
    const desktopLocalDurableRowCount = optionalCounter(
      evidenceValue.desktop_local_durable_row_count
        ?? evidenceValue.desktopLocalDurableRowCount,
    );
    const localDraftRowCount = optionalCounter(
      evidenceValue.local_draft_row_count ?? evidenceValue.localDraftRowCount,
    );
    const localCommandRowCount = optionalCounter(
      evidenceValue.local_command_row_count ?? evidenceValue.localCommandRowCount,
    );
    const localProjectionRowCount = optionalCounter(
      evidenceValue.local_projection_row_count ?? evidenceValue.localProjectionRowCount,
    );
    const localUploadRowCount = optionalCounter(
      evidenceValue.local_upload_row_count ?? evidenceValue.localUploadRowCount,
    );
    if (
      stringField(value.error_code ?? value.errorCode) !== 'PRIVATE_UNSUPPORTED'
      || !stringField(value.station_error_code ?? value.stationErrorCode)
      || stringField(evidenceValue.publish_phase ?? evidenceValue.publishPhase)
        !== 'PREPARE_REJECTED'
      || (evidenceValue.prepare_succeeded ?? evidenceValue.prepareSucceeded) !== false
      || receivedPreparePlanCount === undefined
      || desktopLocalDurableRowCount === undefined
      || localDraftRowCount === undefined
      || localCommandRowCount === undefined
      || localProjectionRowCount === undefined
      || localUploadRowCount === undefined
      || stringField(evidenceValue.claim_count_scope ?? evidenceValue.claimCountScope)
        !== 'NATIVE_RECEIVED_PREPARE_PLAN'
      || stringField(evidenceValue.partial_row_scope ?? evidenceValue.partialRowScope)
        !== 'DESKTOP_LOCAL_DURABLE_STATE'
      || stringField(evidenceValue.server_write_proof ?? evidenceValue.serverWriteProof)
        !== 'STATION_SOURCE_TEST_REQUIRED'
    ) {
      throw privateProjectionContractError('private publish rejection evidence is invalid');
    }
    return {
      state,
      draftId,
      errorCode: 'PRIVATE_UNSUPPORTED',
      stationErrorCode: stringField(
        value.station_error_code ?? value.stationErrorCode,
      ),
      evidence: {
        publishPhase: 'PREPARE_REJECTED',
        prepareSucceeded: false,
        receivedPreparePlanCount,
        desktopLocalDurableRowCount,
        localDraftRowCount,
        localCommandRowCount,
        localProjectionRowCount,
        localUploadRowCount,
        claimCountScope: 'NATIVE_RECEIVED_PREPARE_PLAN',
        partialRowScope: 'DESKTOP_LOCAL_DURABLE_STATE',
        serverWriteProof: 'STATION_SOURCE_TEST_REQUIRED',
      },
    };
  }
  if (state !== 'PUBLISHED' && state !== 'UNKNOWN_COMMIT') {
    throw privateProjectionContractError('private publish result state is invalid');
  }
  const projectionValue = value.projection;
  return {
    state,
    draftId,
    postId: stringField(value.post_id ?? value.postId) || undefined,
    projection: projectionValue ? normalizePrivateMomentProjection(projectionValue) : undefined,
  };
}

function optionalCounter(value: unknown): number | undefined {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return undefined;
  return value as number;
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
    audience: intent.audience,
    moment_kind: intent.momentKind,
    text: intent.text,
    mentions: (intent.mentions ?? []).map((mention) => ({
      actor_ptid: mention.actorPtid,
      offset: mention.offset,
      length: mention.length,
      display: mention.display,
    })),
    files: intent.files.map((file) => ({
      intent_id: file.intentId,
      file_path: file.filePath,
    })),
    link: intent.link
      ? {
          url: intent.link.url,
          title: intent.link.title,
          description: intent.link.description ?? '',
          image_url: intent.link.imageUrl ?? '',
          site_name: intent.link.siteName ?? '',
          favicon_url: intent.link.faviconUrl ?? '',
        }
      : undefined,
    location: intent.location
      ? {
          name: intent.location.name,
          latitude: intent.location.latitude,
          longitude: intent.location.longitude,
          address: intent.location.address ?? '',
          place_id: intent.location.placeId ?? '',
        }
      : undefined,
    poll: intent.poll
      ? {
          question: intent.poll.question,
          options: [...intent.poll.options],
          min_choices: intent.poll.minChoices,
          max_choices: intent.poll.maxChoices,
          expires_at_seconds: intent.poll.expiresAtSeconds,
        }
      : undefined,
    repost: intent.repost
      ? {
          source_post_id: intent.repost.sourcePostId,
        }
      : undefined,
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
