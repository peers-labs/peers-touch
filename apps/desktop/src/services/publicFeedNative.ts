import { invoke } from '@tauri-apps/api/core';
import { create, equals, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  FeedBundleSchema, FeedPayloadSchema, FeedPostMutationSchema, FeedThreadEntrySchema, FeedEventKind,
  FeedPollAdmissionSchema, FeedPollAdmissionResult, FeedPollBallotMutationSchema,
  type FeedPayload,
} from '../gen/proto/domain/social/feed_log_pb';
import { Audience_Kind, CreatePostRequestSchema, type Post } from '../gen/proto/domain/social/post_pb';
import { type Comment } from '../gen/proto/domain/social/comment_pb';
import { useSessionStore } from '../store/session';
import { PublicFeedProjection } from './publicFeedProjection';
import { publicPollDefinitionHash } from './publicFeedPollProjection';

export function feedBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function bytes(encoded: string): Uint8Array {
  return Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
}
export function publicObjectId(): string {
  const values = crypto.getRandomValues(new Uint32Array(2));
  return (((BigInt(values[0]) << 32n) | BigInt(values[1])) & ((1n << 63n) - 1n) || 1n).toString();
}
export async function publicOperationObjectId(operationId?: string): Promise<string> {
  if (!operationId) return publicObjectId();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(operationId)));
  const prefix = Array.from(digest.slice(0, 8), value => value.toString(16).padStart(2, '0')).join('');
  return ((BigInt(`0x${prefix}`) & ((1n << 63n) - 1n)) || 1n).toString();
}

export function publicFeedErrorKey(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  if (/FEED_(PROJECTION_TAMPERED|PROJECTION_UNVERIFIED|INVALID|FORK|ROLLBACK)/.test(code)) return 'moments.publicFeed.verificationFailed';
  if (/FEED_(WRITER_NOT_AUTHORIZED|DEVICE_REQUIRED)/.test(code)) return 'moments.publicFeed.writerRequired';
  if (/FEED_(IDENTITY_REQUIRED|AUTHENTICATION_REQUIRED|SESSION_CHANGED)|MOMENTS_SESSION_STALE/.test(code)) return 'moments.publicFeed.identityRequired';
  if (/FEED_PENDING_ACK/.test(code)) return 'moments.publicFeed.pending';
  if (/FEED_POLL_(ADMISSION_PENDING|ADMISSION_UNVERIFIED)/.test(code)) return 'moments.publicFeed.pending';
  return 'moments.publicFeed.retry';
}
type Pending = { commandId: string; kind: FeedEventKind; payloadB64: string };
type ConfirmedPollCommand = Pending & { actorPtid: string; pollResult: FeedPollAdmissionResult };
type Status = { pending?: Pending[]; pendingAdmissions?: Pending[]; confirmedPollCommands?: ConfirmedPollCommand[] };
export type PublicPollCommandSettlement = {
  commandId: string; targetPostRef: string; options: readonly number[];
  state: 'committed' | 'rejected'; error?: string;
};
const pollAdmissionErrors: Partial<Record<FeedPollAdmissionResult, string>> = {
  [FeedPollAdmissionResult.CLOSED]: 'FEED_POLL_CLOSED',
  [FeedPollAdmissionResult.INVALID_SELECTION]: 'FEED_POLL_INVALID_SELECTION',
  [FeedPollAdmissionResult.DEFINITION_CHANGED]: 'FEED_POLL_DEFINITION_CHANGED',
  [FeedPollAdmissionResult.TARGET_UNAVAILABLE]: 'FEED_POLL_TARGET_UNAVAILABLE',
};
type NativeSubmission = {
  state: string; sourceState?: string; bundleB64: string; homeStationPeerId: string;
  pollAdmissionB64?: string; errorCode?: string;
};
type NativePage = {
  state: string; actorPtid: string; homeStationPeerId: string;
  bundleB64: string; nextSequence: string; hasMore: boolean;
  threadEntriesB64: string[]; nextThreadCursor: string; threadHasMore: boolean;
  threadCursor: string; sequence: string;
};

let generation = 0;
let projection = new PublicFeedProjection();
const cursors = new Map<string, { sequence: string; thread: string }>();
const flights = new Map<string, Promise<void>>();
const postRefs = new Map<string, { actor: string; ref: string; handle: string }>();
const commentRefs = new Map<string, { ref: string; target: string }>();
let writeTail: Promise<unknown> = Promise.resolve();
let localHome = '';

export function resetPublicFeed(): void {
  generation++;
  projection = new PublicFeedProjection();
  cursors.clear();
  flights.clear();
  postRefs.clear();
  commentRefs.clear();
  writeTail = Promise.resolve();
  localHome = '';
}

export async function resumePublicFeed(): Promise<void> {
  const expected = generation;
  const status = await invoke<Status>('social_public_feed_status');
  if (expected !== generation) throw new Error('MOMENTS_SESSION_STALE');
  for (const pending of status.pending ?? []) {
    await submitPublicFeed(pending.kind, fromBinary(FeedPayloadSchema, bytes(pending.payloadB64)), pending.commandId);
    if (expected !== generation) throw new Error('MOMENTS_SESSION_STALE');
  }
  for (const pending of status.pendingAdmissions ?? []) {
    try {
      await submitPublicFeed(pending.kind, fromBinary(FeedPayloadSchema, bytes(pending.payloadB64)), pending.commandId);
    } catch (error) {
      // Confirmed ballots await their own Home decision without monopolizing
      // recovery or blocking an unrelated Actor-chain command.
      if (!/FEED_POLL_(ADMISSION_PENDING|ADMISSION_UNVERIFIED|CLOSED|INVALID_SELECTION|DEFINITION_CHANGED|TARGET_UNAVAILABLE)/.test(String(error))) throw error;
    }
    if (expected !== generation) throw new Error('MOMENTS_SESSION_STALE');
  }
}

// Native re-verifies the exact journal event and Home receipt, including those
// already imported by a feed read and no longer present in pendingAdmissions.
export async function readPublicPollCommands(commandIds: readonly string[]): Promise<PublicPollCommandSettlement[]> {
  const expected = generation;
  const actor = useSessionStore.getState().currentUser?.actorPtid;
  const settlements: PublicPollCommandSettlement[] = [];
  for (let offset = 0; offset < commandIds.length; offset += 64) {
    const batch = commandIds.slice(offset, offset + 64);
    const status = await invoke<Status>('social_public_feed_status', { commandIds: batch });
    if (expected !== generation) throw new Error('MOMENTS_SESSION_STALE');
    for (const confirmed of status.confirmedPollCommands ?? []) {
      const payload = fromBinary(FeedPayloadSchema, bytes(confirmed.payloadB64));
      if (confirmed.actorPtid !== actor || !batch.includes(confirmed.commandId)
        || confirmed.kind !== FeedEventKind.POLL_BALLOT_SET || payload.mutation.case !== 'pollBallot') {
        throw new Error('FEED_INVALID_RESPONSE');
      }
      const error = pollAdmissionErrors[confirmed.pollResult];
      if (confirmed.pollResult !== FeedPollAdmissionResult.ACCEPTED && !error) throw new Error('FEED_INVALID_RESPONSE');
      settlements.push({ commandId: confirmed.commandId,
        targetPostRef: payload.mutation.value.targetPostRef, options: payload.mutation.value.optionIndices,
        state: error ? 'rejected' : 'committed', error });
    }
  }
  return settlements;
}

// Reuse a retained command only for the same intent. Native is the sole owner
// of sequence, key selection and exact retry bytes, including process restart.
export async function submitPublicFeed(kind: FeedEventKind, payload: FeedPayload, operationId?: string,
  onCommandId?: (commandId: string) => void): Promise<FeedPayload> {
  const expected = generation;
  const flight = writeTail.catch(() => undefined).then(() => {
    if (expected !== generation) throw new Error('MOMENTS_SESSION_STALE');
    return submit(kind, payload, operationId, onCommandId);
  });
  writeTail = flight;
  return flight;
}

async function submit(kind: FeedEventKind, payload: FeedPayload, operationId?: string,
  onCommandId?: (commandId: string) => void): Promise<FeedPayload> {
  const expected = generation;
  const status = await invoke<Status>('social_public_feed_status');
  if (expected !== generation) throw new Error('MOMENTS_SESSION_STALE');
  const pending = status.pending?.[0];
  let commandId = operationId ?? crypto.randomUUID();
  if (pending) {
    const retained = fromBinary(FeedPayloadSchema, bytes(pending.payloadB64));
    const comparison = create(FeedPayloadSchema, payload);
    if (kind === FeedEventKind.POST_CREATED && comparison.mutation.case === 'post' && retained.mutation.case === 'post') {
      comparison.mutation.value.postId = retained.mutation.value.postId;
    }
    if (kind === FeedEventKind.COMMENT_CREATED && comparison.mutation.case === 'comment' && retained.mutation.case === 'comment') {
      comparison.mutation.value.commentId = retained.mutation.value.commentId;
    }
    if (pending.kind !== kind || !equals(FeedPayloadSchema, comparison, retained)) throw new Error('FEED_PENDING_ACK');
    commandId = pending.commandId;
    payload = retained;
  } else if (payload.mutation.case === 'pollBallot') {
    const target = payload.mutation.value.targetPostRef;
    for (const pending of status.pendingAdmissions ?? []) {
      const retained = fromBinary(FeedPayloadSchema, bytes(pending.payloadB64));
      if (retained.mutation.case !== 'pollBallot' || retained.mutation.value.targetPostRef !== target) continue;
      if (pending.kind !== kind || !equals(FeedPayloadSchema, payload, retained)) throw new Error('FEED_POLL_ADMISSION_PENDING');
      commandId = pending.commandId;
      payload = retained;
      break;
    }
  }
  onCommandId?.(commandId);
  if (expected !== generation) throw new Error('MOMENTS_SESSION_STALE');
  const input = { command_id: commandId, kind, payload_b64: feedBase64(toBinary(FeedPayloadSchema, payload)) };
  await invoke('social_public_feed_prepare', { input });
  if (expected !== generation) throw new Error('MOMENTS_SESSION_STALE');
  const result = await invoke<NativeSubmission>('social_public_feed_submit', { input });
  if (expected !== generation) throw new Error('MOMENTS_SESSION_STALE');
  if ((result.state !== 'COMMITTED' && result.sourceState !== 'COMMITTED') || !result.homeStationPeerId) {
    throw new Error('FEED_INVALID_RESPONSE');
  }
  const bundle = fromBinary(FeedBundleSchema, bytes(result.bundleB64));
  const admission = result.pollAdmissionB64 ? fromBinary(FeedPollAdmissionSchema, bytes(result.pollAdmissionB64)) : undefined;
  for (const event of bundle.events) projection.apply(event, result.homeStationPeerId, admission);
  localHome = result.homeStationPeerId;
  if (kind === FeedEventKind.POLL_BALLOT_SET) {
    if (result.state === 'PENDING_ADMISSION' || result.state === 'PENDING_READBACK') {
      throw new Error(result.errorCode ?? 'FEED_POLL_ADMISSION_PENDING');
    }
    if (!admission?.statement) throw new Error('FEED_INVALID_RESPONSE');
    if (admission.statement.result !== FeedPollAdmissionResult.ACCEPTED) {
      throw new Error(pollAdmissionErrors[admission.statement.result] ?? 'FEED_INVALID_RESPONSE');
    }
    if (result.state !== 'COMMITTED') throw new Error('FEED_INVALID_RESPONSE');
  }
  return payload;
}

export function committedPublicPost(id: string): Post {
  const ref = `oss://${localHome}/post/${id}`;
  const post = projection.posts.get(ref);
  if (!post) throw new Error('FEED_PROJECTION_UNVERIFIED');
  postRefs.set(id, { actor: post.authorPtid, ref, handle: '' });
  return projection.bindPost({ ...post, id }, useSessionStore.getState().currentUser?.actorPtid ?? '');
}

export function committedPublicComment(postId: string, id: string, replyToCommentId?: string): Comment {
  const ref = `oss://${localHome}/comment/${id}`;
  const comment = projection.comments.get(ref);
  if (!comment || comment.postId !== publicPostRef(postId)) throw new Error('FEED_PROJECTION_UNVERIFIED');
  commentRefs.set(id, { ref, target: comment.postId });
  return { ...comment, id, postId, replyToCommentId: replyToCommentId ?? '' };
}

export function verifiedPublicReactions(postId: string): Post['reactions'] {
  return projection.reactionSummaries(publicPostRef(postId), useSessionStore.getState().currentUser?.actorPtid ?? '');
}

export function verifiedPublicCommentLike(commentId: string): Pick<Comment, 'likesCount' | 'isLiked'> {
  const known = commentRefs.get(commentId);
  const comment = known && projection.comments.get(known.ref);
  if (!known || !comment || comment.isDeleted || projection.posts.get(known.target)?.isDeleted) {
    throw new Error('FEED_PROJECTION_UNVERIFIED');
  }
  const bound = projection.bindComment(comment, known.target, useSessionStore.getState().currentUser?.actorPtid ?? '');
  return { likesCount: bound.likesCount, isLiked: bound.isLiked };
}

async function syncActor(actor: string, handle: string): Promise<void> {
  const existing = flights.get(actor);
  if (existing) return existing;
  const expected = generation;
  const flight = (async () => {
    let lastSynchronized = '';
    // A bounded pass; large histories continue from Native-verified prefixes.
    for (let page = 0; page < 64; page++) {
      const cursor = cursors.get(actor) ?? { sequence: '0', thread: '0' };
      const result = await invoke<NativePage>('social_public_feed_read', { input: {
        actor_ptid: actor, federated_handle: handle, limit: 64,
        after_sequence: cursor.sequence, after_thread_cursor: cursor.thread,
      } });
      if (expected !== generation) throw new Error('MOMENTS_SESSION_STALE');
      if (result.state !== 'VERIFIED' || result.actorPtid !== actor || !result.homeStationPeerId) {
        throw new Error('FEED_INVALID_RESPONSE');
      }
      const bundle = fromBinary(FeedBundleSchema, bytes(result.bundleB64));
      for (const event of bundle.events) projection.apply(event, result.homeStationPeerId);
      for (const encoded of result.threadEntriesB64) {
        const entry = fromBinary(FeedThreadEntrySchema, bytes(encoded));
        if (!entry.receipt?.event) throw new Error('FEED_INVALID_RESPONSE');
        projection.apply(entry.receipt.event, entry.interactionHomeStation, entry.receipt.pollAdmission);
      }
      const next = { sequence: result.nextSequence, thread: result.nextThreadCursor };
      cursors.set(actor, next);
      if (!result.hasMore && !result.threadHasMore) return;
      const synchronized = `${result.sequence}/${result.threadCursor}`;
      if (next.sequence === cursor.sequence && next.thread === cursor.thread && synchronized === lastSynchronized) {
        throw new Error('FEED_GAP');
      }
      lastSynchronized = synchronized;
    }
    throw new Error('FEED_SYNC_REQUIRED');
  })().finally(() => { if (flights.get(actor) === flight) flights.delete(actor); });
  flights.set(actor, flight);
  return flight;
}

export async function verifyPublicPosts(posts: Post[]): Promise<Post[]> {
  const expected = generation;
  const publicPosts = posts.filter(post => post.audience?.kind === Audience_Kind.PUBLIC);
  const actors = new Map(publicPosts.map(post => [post.authorPtid, post.author?.federatedHandle ?? '']));
  // Serialize distinct identity fetches; Native pins roots and owns trust.
  for (const [actor, handle] of actors) await syncActor(actor, handle);
  if (expected !== generation) throw new Error('MOMENTS_SESSION_STALE');
  const viewer = useSessionStore.getState().currentUser?.actorPtid ?? '';
  return posts.map(post => {
    if (post.audience?.kind !== Audience_Kind.PUBLIC) return post;
    const verified = projection.bindPost(post, viewer);
    postRefs.set(post.id, { actor: post.authorPtid, ref: post.publicFeedRef, handle: post.author?.federatedHandle ?? '' });
    return verified;
  });
}

export function publicPostRef(id: string): string {
  const known = postRefs.get(id);
  if (!known) throw new Error('FEED_PROJECTION_UNVERIFIED');
  return known.ref;
}
export async function publicPollBallotPayload(id: string, options: readonly number[]): Promise<FeedPayload> {
  const expected = generation;
  const ref = publicPostRef(id);
  const post = projection.posts.get(ref);
  if (!post || post.isDeleted) throw new Error('FEED_POLL_TARGET_UNAVAILABLE');
  if (post.content.case !== 'pollPost' || !post.content.value.poll) throw new Error('FEED_POLL_NOT_POLL');
  const definition = post.content.value.poll;
  if (options.length < definition.minChoices || options.length > definition.maxChoices
    || options.some((index, position) => !Number.isInteger(index) || index < 0
      || index >= definition.options.length || (position > 0 && options[position - 1] >= index))) {
    throw new Error('FEED_POLL_INVALID_SELECTION');
  }
  const definitionHash = await publicPollDefinitionHash(definition);
  if (expected !== generation) throw new Error('MOMENTS_SESSION_STALE');
  return create(FeedPayloadSchema, { mutation: { case: 'pollBallot',
    value: create(FeedPollBallotMutationSchema, {
      targetPostRef: ref, definitionHash, optionIndices: [...options],
    }) } });
}
export function verifiedPublicPoll(id: string) {
  const post = projection.posts.get(publicPostRef(id));
  if (!post || post.isDeleted) throw new Error('FEED_POLL_TARGET_UNAVAILABLE');
  const verified = projection.bindPost(post, useSessionStore.getState().currentUser?.actorPtid ?? '');
  if (verified.content.case !== 'pollPost' || !verified.content.value.result) throw new Error('FEED_POLL_NOT_POLL');
  return verified.content.value.result;
}
export function publicTextUpdatePayload(id: string, text: string): FeedPayload {
  const ref = publicPostRef(id);
  const request = projection.requestForEdit(ref, useSessionStore.getState().currentUser?.actorPtid ?? '');
  const content = request.content;
  if (!text.trim()) throw new Error('FEED_INVALID');
  if (content.case === 'repost') content.value.comment = text;
  else if (content.case) content.value.text = text;
  else throw new Error('FEED_UNSUPPORTED_POST_TYPE');
  return create(FeedPayloadSchema, { mutation: { case: 'post', value: create(FeedPostMutationSchema, {
    postId: ref.substring(ref.lastIndexOf('/') + 1),
    createRequest: toBinary(CreatePostRequestSchema, request),
  }) } });
}
export function publicCommentRef(id: string): string {
  const known = commentRefs.get(id);
  if (!known) throw new Error('FEED_PROJECTION_UNVERIFIED');
  return known.ref;
}
export function publicCommentTarget(id: string): string {
  const known = commentRefs.get(id);
  if (!known) throw new Error('FEED_PROJECTION_UNVERIFIED');
  return known.target;
}
export async function verifyPublicComments(postId: string, comments: Comment[]): Promise<Comment[]> {
  const known = postRefs.get(postId);
  if (!known) throw new Error('FEED_PROJECTION_UNVERIFIED');
  const expected = generation;
  await syncActor(known.actor, known.handle);
  if (expected !== generation) throw new Error('MOMENTS_SESSION_STALE');
  return comments.map(comment => {
    const verified = projection.bindComment(comment, known.ref, useSessionStore.getState().currentUser?.actorPtid ?? '');
    commentRefs.set(comment.id, { ref: verified.publicFeedRef, target: known.ref });
    return verified;
  });
}
