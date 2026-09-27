import { invoke } from '@tauri-apps/api/core';
import { resolvePrivateMomentsPlatform } from './privateMomentsNative';

export const PRIVATE_COMMENTS_COMMANDS = {
  bootstrap: 'social_private_comments_bootstrap',
  stage: 'social_private_comment_stage',
  prepare: 'social_private_comment_prepare',
  submit: 'social_private_comment_submit',
  list: 'social_private_comments_list',
} as const;

export type PrivateCommentState =
  | 'COMMENT_EDITING'
  | 'COMMENT_ENCRYPTING'
  | 'COMMENT_SUBMITTING'
  | 'COMMENT_POSTED'
  | 'COMMENT_FAILED'
  | 'COMMENT_RATE_LIMITED'
  | 'COMMENT_PARENT_UNAVAILABLE';

export type PrivateCommentPublicationState =
  | 'PENDING_PUBLICATION'
  | 'IN_FLIGHT'
  | 'UNKNOWN_COMMIT'
  | 'PUBLISHED'
  | 'TERMINAL'
  | 'COMMITTED_PENDING_READBACK';

export interface PrivateCommentProjection {
  commentId: string;
  contentId: string;
  generation: string;
  postId: string;
  replyToCommentId: string;
  authorPtid: string;
  authorAcct?: string;
  state: 'COMMENT_POSTED';
  text: string;
  reactionsCount: number;
  repliesCount: number;
  createdAtMillis?: number;
  updatedAtMillis?: number;
}

export interface PrivateCommentDraftProjection {
  draftId: string;
  draftRevision: number;
  postId: string;
  replyToCommentId: string;
  text: string;
  state: PrivateCommentState;
  commentId?: string;
  errorCode?: string;
  retryAfterSeconds?: number;
  retryNotBeforeUnixMs?: number;
  publicationState?: PrivateCommentPublicationState;
}

export interface PrivateCommentsNativeSnapshot {
  actorPtid: string;
  deviceId: string;
  sessionGeneration: string;
  drafts: PrivateCommentDraftProjection[];
  comments: PrivateCommentProjection[];
}

export interface PrivateCommentPage {
  postId: string;
  comments: PrivateCommentProjection[];
  nextCursor: string;
  hasMore: boolean;
}

export interface PrivateCommentSubmitResult {
  draft: PrivateCommentDraftProjection;
  comment?: PrivateCommentProjection;
}

export interface PrivateCommentIntent {
  actorPtid: string;
  rendererGeneration: number;
  draftId: string;
  draftRevision: number;
  postId: string;
  replyToCommentId?: string;
  text: string;
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

const COMMENT_STATES = new Set<PrivateCommentState>([
  'COMMENT_EDITING',
  'COMMENT_ENCRYPTING',
  'COMMENT_SUBMITTING',
  'COMMENT_POSTED',
  'COMMENT_FAILED',
  'COMMENT_RATE_LIMITED',
  'COMMENT_PARENT_UNAVAILABLE',
]);

const PUBLICATION_STATES = new Set<PrivateCommentPublicationState>([
  'PENDING_PUBLICATION',
  'IN_FLIGHT',
  'UNKNOWN_COMMIT',
  'PUBLISHED',
  'TERMINAL',
  'COMMITTED_PENDING_READBACK',
]);

export class PrivateCommentsNativeError extends Error {
  readonly code: string;
  readonly state: PrivateCommentState;
  readonly retryAfterSeconds?: number;
  readonly retryNotBeforeUnixMs?: number;

  constructor(options: {
    code: string;
    state: PrivateCommentState;
    message?: string;
    retryAfterSeconds?: number;
    retryNotBeforeUnixMs?: number;
  }) {
    super(options.message || options.code);
    this.name = 'PrivateCommentsNativeError';
    this.code = options.code;
    this.state = options.state;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.retryNotBeforeUnixMs = options.retryNotBeforeUnixMs;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveInteger(value: unknown): number {
  const number = numberField(value);
  return number && Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function generationField(value: unknown): string {
  if (typeof value === 'bigint') return value > 0n ? value.toString() : '';
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  const raw = stringField(value);
  return /^[1-9]\d*$/.test(raw) ? raw : '';
}

function stateField(value: unknown): PrivateCommentState {
  const state = stringField(value).toUpperCase() as PrivateCommentState;
  if (!COMMENT_STATES.has(state)) {
    throw contractError('private Comment state is invalid');
  }
  return state;
}

function publicationStateField(
  value: unknown,
): PrivateCommentPublicationState | undefined {
  const state = stringField(value).toUpperCase() as PrivateCommentPublicationState;
  if (!state) return undefined;
  if (!PUBLICATION_STATES.has(state)) {
    throw contractError('private Comment publication state is invalid');
  }
  return state;
}

function contractError(message: string): PrivateCommentsNativeError {
  return new PrivateCommentsNativeError({
    code: 'COMMENT_PROJECTION_INVALID',
    state: 'COMMENT_FAILED',
    message,
  });
}

export function normalizePrivateCommentDraft(
  value: unknown,
): PrivateCommentDraftProjection {
  if (!isRecord(value)) {
    throw contractError('private Comment draft is malformed');
  }
  const draftId = stringField(value.draft_id ?? value.draftId);
  const draftRevision = positiveInteger(value.draft_revision ?? value.draftRevision);
  const postId = stringField(value.post_id ?? value.postId);
  const state = stateField(value.state);
  const text = typeof value.text === 'string' ? value.text : '';
  const commentId = stringField(value.comment_id ?? value.commentId) || undefined;
  const publicationState = publicationStateField(
    value.publication_state ?? value.publicationState,
  );
  if (
    !draftId
    || !draftRevision
    || !postId
    || (state === 'COMMENT_POSTED'
      ? !commentId
      : publicationState !== 'COMMITTED_PENDING_READBACK' && !text.trim())
  ) {
    throw contractError('private Comment draft identity is incomplete');
  }
  return {
    draftId,
    draftRevision,
    postId,
    replyToCommentId: stringField(value.reply_to_comment_id ?? value.replyToCommentId),
    text,
    state,
    commentId,
    errorCode: stringField(value.error_code ?? value.errorCode) || undefined,
    retryAfterSeconds: numberField(value.retry_after_seconds ?? value.retryAfterSeconds),
    retryNotBeforeUnixMs: numberField(
      value.retry_not_before_unix_ms ?? value.retryNotBeforeUnixMs,
    ),
    publicationState,
  };
}

export function normalizePrivateCommentProjection(
  value: unknown,
): PrivateCommentProjection {
  if (!isRecord(value)) {
    throw contractError('private Comment projection is malformed');
  }
  const commentId = stringField(value.comment_id ?? value.commentId);
  const contentId = stringField(value.content_id ?? value.contentId);
  const generation = generationField(value.generation);
  const postId = stringField(value.post_id ?? value.postId);
  const authorPtid = stringField(value.author_ptid ?? value.authorPtid);
  const state = stateField(value.state);
  const text = typeof value.text === 'string' ? value.text : '';
  if (
    !commentId
    || !contentId
    || !generation
    || !postId
    || !authorPtid
    || state !== 'COMMENT_POSTED'
    || !text.trim()
  ) {
    throw contractError('private Comment projection identity is incomplete');
  }
  return {
    commentId,
    contentId,
    generation,
    postId,
    replyToCommentId: stringField(value.reply_to_comment_id ?? value.replyToCommentId),
    authorPtid,
    authorAcct: stringField(value.author_acct ?? value.authorAcct) || undefined,
    state,
    text,
    reactionsCount: numberField(value.reactions_count ?? value.reactionsCount) ?? 0,
    repliesCount: numberField(value.replies_count ?? value.repliesCount) ?? 0,
    createdAtMillis: numberField(value.created_at_millis ?? value.createdAtMillis),
    updatedAtMillis: numberField(value.updated_at_millis ?? value.updatedAtMillis),
  };
}

function normalizeSnapshot(value: unknown): PrivateCommentsNativeSnapshot {
  if (!isRecord(value)) {
    throw contractError('private Comments snapshot is malformed');
  }
  const actorPtid = stringField(value.actor_ptid ?? value.actorPtid);
  const deviceId = stringField(value.device_id ?? value.deviceId);
  const sessionGeneration = generationField(
    value.session_generation ?? value.sessionGeneration,
  );
  if (
    !actorPtid
    || !deviceId
    || !sessionGeneration
    || !Array.isArray(value.drafts)
    || !Array.isArray(value.comments)
  ) {
    throw contractError('private Comments snapshot identity is incomplete');
  }
  return {
    actorPtid,
    deviceId,
    sessionGeneration,
    drafts: value.drafts.map(normalizePrivateCommentDraft),
    comments: value.comments.map(normalizePrivateCommentProjection),
  };
}

function normalizePage(value: unknown): PrivateCommentPage {
  if (!isRecord(value) || !Array.isArray(value.comments)) {
    throw contractError('private Comment page is malformed');
  }
  const postId = stringField(value.post_id ?? value.postId);
  if (!postId) throw contractError('private Comment page has no parent identity');
  return {
    postId,
    comments: value.comments.map(normalizePrivateCommentProjection),
    nextCursor: stringField(value.next_cursor ?? value.nextCursor),
    hasMore: value.has_more === true || value.hasMore === true,
  };
}

function normalizeSubmitResult(value: unknown): PrivateCommentSubmitResult {
  if (!isRecord(value)) {
    throw contractError('private Comment submit result is malformed');
  }
  return {
    draft: normalizePrivateCommentDraft(value.draft),
    comment: value.comment ? normalizePrivateCommentProjection(value.comment) : undefined,
  };
}

function unpackNativeData(data: unknown): unknown {
  if (isRecord(data) && typeof data.status === 'string') {
    try {
      return JSON.parse(data.status);
    } catch {
      throw contractError('private Comment Native adapter returned malformed JSON');
    }
  }
  return data;
}

function errorState(
  error: NativeCommandResult<unknown>['error'],
): PrivateCommentState {
  const candidate = stringField(error?.details?.state).toUpperCase() as PrivateCommentState;
  return COMMENT_STATES.has(candidate) ? candidate : 'COMMENT_FAILED';
}

async function invokePrivateComment<T>(
  command: string,
  input: Record<string, unknown>,
): Promise<T> {
  if (resolvePrivateMomentsPlatform() !== 'native') {
    throw new PrivateCommentsNativeError({
      code: 'PRIVATE_UNSUPPORTED_ON_DEVICE',
      state: 'COMMENT_FAILED',
    });
  }
  const result = await invoke<NativeCommandResult<T>>(command, { input });
  if (!result.ok || result.data === undefined) {
    throw new PrivateCommentsNativeError({
      code: stringField(result.error?.details?.native_error_code)
        || stringField(result.error?.code)
        || 'COMMENT_FAILED',
      state: errorState(result.error),
      message: stringField(result.error?.message) || `${command} failed`,
      retryAfterSeconds: numberField(result.error?.details?.retry_after_seconds),
      retryNotBeforeUnixMs: numberField(
        result.error?.details?.retry_not_before_unix_ms,
      ),
    });
  }
  return unpackNativeData(result.data) as T;
}

function nativeIntent(intent: PrivateCommentIntent): Record<string, unknown> {
  return {
    actor_ptid: intent.actorPtid,
    renderer_generation: intent.rendererGeneration,
    draft_id: intent.draftId,
    draft_revision: intent.draftRevision,
    post_id: intent.postId,
    reply_to_comment_id: intent.replyToCommentId ?? '',
    text: intent.text,
  };
}

function normalizeIntentDraft(
  value: unknown,
  intent: PrivateCommentIntent,
): PrivateCommentDraftProjection {
  const draft = normalizePrivateCommentDraft(value);
  if (
    draft.draftId !== intent.draftId
    || draft.draftRevision !== intent.draftRevision
    || draft.postId !== intent.postId
    || draft.replyToCommentId !== (intent.replyToCommentId ?? '')
    || draft.text !== intent.text
  ) {
    throw contractError('private Comment Native draft changed its local identity');
  }
  return draft;
}

export const privateCommentsNative = {
  async bootstrap(input: {
    actorPtid: string;
    rendererGeneration: number;
  }): Promise<PrivateCommentsNativeSnapshot> {
    return normalizeSnapshot(await invokePrivateComment(
      PRIVATE_COMMENTS_COMMANDS.bootstrap,
      {
        actor_ptid: input.actorPtid,
        renderer_generation: input.rendererGeneration,
      },
    ));
  },

  async stage(intent: PrivateCommentIntent): Promise<PrivateCommentDraftProjection> {
    return normalizeIntentDraft(await invokePrivateComment(
      PRIVATE_COMMENTS_COMMANDS.stage,
      nativeIntent(intent),
    ), intent);
  },

  async prepare(intent: PrivateCommentIntent): Promise<PrivateCommentDraftProjection> {
    return normalizeIntentDraft(await invokePrivateComment(
      PRIVATE_COMMENTS_COMMANDS.prepare,
      nativeIntent(intent),
    ), intent);
  },

  async submit(input: {
    actorPtid: string;
    rendererGeneration: number;
    draftId: string;
    draftRevision: number;
  }): Promise<PrivateCommentSubmitResult> {
    return normalizeSubmitResult(await invokePrivateComment(
      PRIVATE_COMMENTS_COMMANDS.submit,
      {
        actor_ptid: input.actorPtid,
        renderer_generation: input.rendererGeneration,
        draft_id: input.draftId,
        draft_revision: input.draftRevision,
      },
    ));
  },

  async list(input: {
    actorPtid: string;
    rendererGeneration: number;
    postId: string;
    cursor?: string;
    limit?: number;
  }): Promise<PrivateCommentPage> {
    const limit = Number.isInteger(input.limit) && Number(input.limit) > 0
      ? Math.min(Number(input.limit), 100)
      : 20;
    const page = normalizePage(await invokePrivateComment(
      PRIVATE_COMMENTS_COMMANDS.list,
      {
        actor_ptid: input.actorPtid,
        renderer_generation: input.rendererGeneration,
        post_id: input.postId,
        cursor: input.cursor ?? '',
        limit,
      },
    ));
    if (page.postId !== input.postId) {
      throw contractError('private Comment page changed its parent identity');
    }
    return page;
  },
};
