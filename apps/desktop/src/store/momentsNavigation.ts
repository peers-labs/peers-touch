import { createDesktopStore } from './createDesktopStore';
import { useMomentsStore } from './moments';
import { usePrivateCommentsStore } from './privateComments';

export type MomentsTab = 'feed' | 'explore' | 'search' | 'circles';
export type MomentsView =
  | { kind: 'tab'; tab: MomentsTab }
  | { kind: 'detail'; postId: string; commentId?: string; from: MomentsTab }
  | { kind: 'user'; actorPtid: string; from: MomentsTab };

interface MomentsNavigation {
  view: MomentsView;
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
    set({ view });
  };
  return {
    view: { kind: 'tab', tab: 'feed' },
    setView,
    reset: () => setView({ kind: 'tab', tab: 'feed' }),
  };
});
