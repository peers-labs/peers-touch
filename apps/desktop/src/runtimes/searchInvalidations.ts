// Trusted host composition of original-owner invalidation subscriptions.
import { fromJson, type JsonValue } from '@bufbuild/protobuf';
import { listen } from '@tauri-apps/api/event';
import { MessagingProjectionInvalidationSchema } from '../gen/proto/domain/chat/event_pb';
import { messagingDomainRuntime } from '../messaging/runtime';
import { EVENT, eventBus } from '../kernel/events';
import { useMomentsStore } from '../store/moments';
import { usePrivateMomentsStore } from '../store/privateMoments';
import { usePrivateCommentsStore } from '../store/privateComments';
import { structuralEqual } from '../utils/structuralEqual';
import { matchesCurrentMomentEvent } from './momentsRuntime';

export async function subscribeSearchInvalidations(
  changed: (sourceIds: readonly string[]) => void,
): Promise<() => void> {
  const social = () => changed(['device.social', 'station.social.public']);
  const releases = [
    eventBus.subscribeMany([
      EVENT.MOMENT_CREATED, EVENT.MOMENT_DELETED, EVENT.MOMENT_REVOKED,
      EVENT.MOMENT_COMMENTED, EVENT.MOMENT_REACTED, EVENT.MOMENT_UPDATED,
    ], ({ payload }) => { if (matchesCurrentMomentEvent(payload)) social(); }),
    eventBus.subscribe(EVENT.RELATIONSHIP_CHANGED, social),
    eventBus.subscribe(EVENT.MOMENT_RESYNC_REQUESTED, social),
    useMomentsStore.subscribe((state, previous) => {
      // Passive signed-feed reads do not emit local mutation events. Observe
      // their retained content and membership, including a tombstone that
      // removes a feed ID while its old normalized Post is still retained.
      // Loading, cursors and read timestamps do not change the content.
      if (!structuralEqual(state.postsById, previous.postsById)
        || !structuralEqual(state.authorsById, previous.authorsById)
        || !structuralEqual(state.comments, previous.comments)
        || !structuralEqual(state.feeds.home.postIds, previous.feeds.home.postIds)
        || !structuralEqual(state.feeds.explore.postIds, previous.feeds.explore.postIds)
        || state.publicFeedReadError !== previous.publicFeedReadError) {
        social();
      }
    }),
    usePrivateMomentsStore.subscribe((state, previous) => {
      if (!structuralEqual(state.postsById, previous.postsById)
        || !structuralEqual(state.scope, previous.scope)) {
        changed(['device.social']);
      }
    }),
    usePrivateCommentsStore.subscribe((state, previous) => {
      // Bootstrap copies retained threads, and reads change loading/cursors.
      // Neither is a new original-content or authorization observation.
      // Keep this observer read-only and compare the retained content and
      // refusal state so actual removal/revocation still conceals immediately.
      const posts = new Set([
        ...Object.keys(state.threadsByPost), ...Object.keys(previous.threadsByPost),
      ]);
      if (!structuralEqual(state.scope, previous.scope)
        || [...posts].some(postId => {
          const current = state.threadsByPost[postId];
          const prior = previous.threadsByPost[postId];
          return current?.state !== prior?.state || current?.errorCode !== prior?.errorCode
            || !structuralEqual(current?.comments ?? [], prior?.comments ?? []);
        })) {
        changed(['device.social']);
      }
    }),
  ];
  const native = await listen<JsonValue>('messaging:projection-changed', ({ payload }) => {
    try {
      if (messagingDomainRuntime.matchesInvalidation(
        fromJson(MessagingProjectionInvalidationSchema, payload),
      )) changed(['device.messaging']);
    } catch { /* Invalid or stale original-owner events cannot invalidate a source. */ }
  }).catch(() => () => {});
  releases.push(native);
  return () => releases.forEach(release => release());
}
