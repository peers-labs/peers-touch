import { createDesktopStore } from './createDesktopStore';
import { useMomentsStore } from './moments';
import { usePrivateCommentsStore } from './privateComments';
import { momentResourceKey } from './momentsTimeline';

export type MomentsTab = 'feed' | 'circles';
export type MomentsView =
  | { kind: 'tab'; tab: MomentsTab }
  | { kind: 'detail'; postId: string; commentId?: string; from: MomentsTab }
  | { kind: 'user'; actorPtid: string; from: MomentsTab };

interface MomentsNavigation {
  view: MomentsView;
  commentsOpen: Record<string, boolean>;
  commentFocusIntent: number;
  setCommentsOpen: (resourceKey: string, open: boolean) => void;
  setView: (next: MomentsView | ((previous: MomentsView) => MomentsView)) => void;
  reset: () => void;
}

// Navigation communicates target lifetime, never performs original reads.
export const useMomentsNavigationStore = createDesktopStore<MomentsNavigation>('moments-navigation', (set, get) => {
  const setView = (next: MomentsView | ((previous: MomentsView) => MomentsView)) => {
    const view = typeof next === 'function' ? next(get().view) : next;
    const postId = view.kind === 'detail' ? view.postId : undefined;
    const commentId = view.kind === 'detail' ? view.commentId : undefined;
    useMomentsStore.getState().setCommentTarget(postId, commentId);
    usePrivateCommentsStore.getState().setCommentTarget(postId, commentId);
    const post = postId ? useMomentsStore.getState().postsById[postId] : undefined;
    const resourceKey = post ? momentResourceKey(post) : postId;
    set(state => ({
      view,
      // Only an explicit addressed navigation may reopen a collapsed thread.
      commentsOpen: commentId && resourceKey
        ? { ...state.commentsOpen, [resourceKey]: true } : state.commentsOpen,
      commentFocusIntent: commentId ? state.commentFocusIntent + 1 : state.commentFocusIntent,
    }));
  };
  return {
    view: { kind: 'tab', tab: 'feed' },
    commentsOpen: {},
    commentFocusIntent: 0,
    setCommentsOpen: (resourceKey, open) => set(state => ({
      commentsOpen: { ...state.commentsOpen, [resourceKey]: open },
    })),
    setView,
    reset: () => {
      setView({ kind: 'tab', tab: 'feed' });
      set({ commentsOpen: {}, commentFocusIntent: 0 });
    },
  };
});
