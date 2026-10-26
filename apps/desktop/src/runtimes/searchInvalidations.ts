// Trusted host composition of original-owner invalidation subscriptions.
import { fromJson, type JsonValue } from '@bufbuild/protobuf';
import { listen } from '@tauri-apps/api/event';
import { MessagingProjectionInvalidationSchema } from '../gen/proto/domain/chat/event_pb';
import { messagingDomainRuntime } from '../messaging/runtime';
import { EVENT, eventBus } from '../kernel/events';
import { usePrivateMomentsStore } from '../store/privateMoments';
import { usePrivateCommentsStore } from '../store/privateComments';
import { matchesCurrentMomentEvent } from './momentsRuntime';

export async function subscribeSearchInvalidations(
  changed: (sourceIds: readonly string[]) => void,
): Promise<() => void> {
  const social = () => changed(['device.social', 'station.social.public']);
  const releases = [
    eventBus.subscribeMany([
      EVENT.MOMENT_CREATED, EVENT.MOMENT_DELETED, EVENT.MOMENT_REVOKED,
      EVENT.MOMENT_COMMENTED, EVENT.MOMENT_REACTED,
    ], ({ payload }) => { if (matchesCurrentMomentEvent(payload)) social(); }),
    eventBus.subscribe(EVENT.RELATIONSHIP_CHANGED, social),
    eventBus.subscribe(EVENT.MOMENT_RESYNC_REQUESTED, social),
    usePrivateMomentsStore.subscribe((state, previous) => {
      if (state.postsById !== previous.postsById || state.scope !== previous.scope) {
        changed(['device.social']);
      }
    }),
    usePrivateCommentsStore.subscribe((state, previous) => {
      if (state.threadsByPost !== previous.threadsByPost || state.scope !== previous.scope) {
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
