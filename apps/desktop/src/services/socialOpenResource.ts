import type { ResourceRef } from '../gen/proto/domain/search/search_pb';
import type { Navigation } from '../types/navigation';
import { ensureMomentDetailProjection, isPrivateMomentPost } from '../runtimes/momentsRuntime';
import { useMomentsStore, selectMomentComments } from '../store/moments';
import { useMomentsNavigationStore } from '../store/momentsNavigation';
import { selectPrivateCommentThread, usePrivateCommentsStore } from '../store/privateComments';

async function openSocialResource(
  resource: ResourceRef, origin: 'device' | 'station', navigation: Navigation, current: () => boolean,
): Promise<void> {
  const comment = resource.kind === 'social-comment';
  const parent = resource.parent;
  const postId = comment ? parent?.id : resource.id;
  if (!postId || !['social-post', 'social-comment'].includes(resource.kind)
    || comment && (parent?.kind !== 'social-post' || parent.authorityNamespace !== resource.authorityNamespace
      || resource.anchor?.kind !== 'comment' || resource.anchor.id !== resource.id)) {
    throw new Error('search.error.resourceUnavailable');
  }
  if (!current()) throw new Error('search.error.resourceUnavailable');
  const commentId = comment ? resource.id : undefined;
  useMomentsNavigationStore.getState().setView(previous => ({
    kind: 'detail', postId, commentId, from: previous.kind === 'tab' ? previous.tab : previous.from,
  }));
  navigation.navigateTo('moments');
  await ensureMomentDetailProjection(postId, { origin, commentId });
  if (!current()) throw new Error('search.error.resourceUnavailable');
  const state = useMomentsStore.getState();
  const post = state.postsById[postId];
  if (!post || origin === 'device' && !isPrivateMomentPost(post)) {
    throw new Error('search.error.resourceUnavailable');
  }
  if (commentId) {
    const found = origin === 'device'
      ? selectPrivateCommentThread(usePrivateCommentsStore.getState(), postId).comments.some(row => row.commentId === commentId)
      : selectMomentComments(state, postId).some(row => row.id === commentId);
    if (!found) throw new Error('search.error.resourceUnavailable');
  }
}

export const openDeviceSocialResource = (
  resource: ResourceRef, navigation: Navigation, current: () => boolean,
) => openSocialResource(resource, 'device', navigation, current);

export const openStationSocialResource = (
  resource: ResourceRef, navigation: Navigation, current: () => boolean,
) => openSocialResource(resource, 'station', navigation, current);
