// Trusted host composition; query presentation consumes source IDs only.
import { listen } from '@tauri-apps/api/event';
import { useAuthStore } from '../features/auth/authStore';
import {
  readActiveMobileSocialFacade, subscribeActiveMobileSocialFacade,
} from '../features/social/mobileSocialFacade';
import { readPrivateMomentsSnapshot, subscribePrivateMomentsRuntime } from './privateMomentsRuntime';
import {
  currentMessagingProjectionScope, MOBILE_MESSAGING_PROJECTION_CHANGED_EVENT,
  MOBILE_MESSAGING_RECONCILED_EVENT,
} from './messagingRuntime';

export async function subscribeSearchInvalidations(
  changed: (sourceIds: readonly string[]) => void,
): Promise<() => void> {
  let privateState = readPrivateMomentsSnapshot();
  let releaseFacade: (() => void) | null = null;
  let publicState: readonly unknown[] = [];
  const social = () => {
    const facade = readActiveMobileSocialFacade(useAuthStore.getState().session);
    if (!facade) return;
    const home = facade.feeds.home.state();
    const explore = facade.feeds.explore.state();
    const next = [home.posts, home.commentsByPost, explore.posts, explore.commentsByPost,
      facade.owner.momentsProjection.state().lastCursor];
    if (next.some((value, index) => value !== publicState[index])) {
      publicState = next;
      changed(['station.social.public']);
    }
  };
  const bindFacade = (notify = true) => {
    releaseFacade?.();
    releaseFacade = null;
    publicState = [];
    const facade = readActiveMobileSocialFacade(useAuthStore.getState().session);
    if (facade) {
      releaseFacade = facade.subscribe(social);
      const home = facade.feeds.home.state();
      const explore = facade.feeds.explore.state();
      publicState = [home.posts, home.commentsByPost, explore.posts, explore.commentsByPost,
        facade.owner.momentsProjection.state().lastCursor];
    }
    if (notify) changed(['station.social.public']);
  };
  const releaseOwner = subscribeActiveMobileSocialFacade(bindFacade);
  // Initial subscription does not claim an original-owner content change.
  bindFacade(false);
  const releasePrivate = subscribePrivateMomentsRuntime(() => {
    const next = readPrivateMomentsSnapshot();
    const contentChanged = next.postsById !== privateState.postsById
      || next.projections !== privateState.projections
      || next.comments !== privateState.comments
      || next.commentThreadsByPostId !== privateState.commentThreadsByPostId
      || next.active !== privateState.active;
    privateState = next;
    if (contentChanged) changed(['device.social']);
  });
  const message = () => changed(['device.messaging']);
  window.addEventListener(MOBILE_MESSAGING_RECONCILED_EVENT, message);
  const releaseNative = await listen<{
    stationPeerId: string; actorPtid: string; activationGeneration: number;
  }>(MOBILE_MESSAGING_PROJECTION_CHANGED_EVENT, ({ payload }) => {
    const scope = currentMessagingProjectionScope();
    if (scope && scope.stationPeerId === payload.stationPeerId
      && scope.actorPtid === payload.actorPtid
      && scope.activationGeneration === payload.activationGeneration) message();
  }).catch(() => () => {});
  return () => {
    releaseNative(); releaseOwner(); releaseFacade?.(); releasePrivate();
    window.removeEventListener(MOBILE_MESSAGING_RECONCILED_EVENT, message);
  };
}
