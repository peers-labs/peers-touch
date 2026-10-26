import type { MobileSocialFacadeController } from '../features/social/mobileSocialFacade';
import type { MomentsFeedState } from '../features/social/momentsFeedStore';

function feedDiagnostics(state: MomentsFeedState) {
  const detail = state.selectedDetail;
  return {
    loadState: state.loadState,
    pageOutcome: state.pageOutcome,
    errorMessage: state.errorMessage,
    postCount: state.posts.length,
    selectedDetail: detail ? {
      postId: detail.postId,
      sourceId: detail.sourceId ?? 'station.social.public',
      anchorCommentId: detail.anchorCommentId ?? '',
      state: detail.readback.kind,
      reason: detail.readback.kind === 'unavailable' ? detail.readback.reason : '',
    } : null,
    commentThreads: [...state.commentsByPost.values()].map(thread => ({
      postId: thread.postId,
      sourceId: thread.sourceId ?? 'station.social.public',
      anchorCommentId: thread.anchorCommentId ?? '',
      initialized: thread.initialized ?? false,
      loading: thread.loading,
      errorMessage: thread.errorMessage,
      commentCount: thread.comments.length,
    })),
  };
}

/** Passive original-owner facts; never refreshes or publishes private content. */
export function projectMomentsRuntimeDiagnostics(
  runtime: Pick<MobileSocialFacadeController, 'feeds'> | null,
) {
  if (!runtime) return null;
  return {
    home: feedDiagnostics(runtime.feeds.home.state()),
    explore: feedDiagnostics(runtime.feeds.explore.state()),
  };
}
