import { createDesktopStore } from './createDesktopStore';
import type { SocialTextMention } from '../components/moments/mentions/socialMentionModel';

// Public comment composer drafts, scoped by authenticated actor,
// session epoch, and post. The thread CommentList binds to this store
// instead of being keyed/remounted on draft identity, so IME
// composition and in-progress mentions survive projection refreshes.
//
// Private comments keep their authoritative publication state in the
// Native private-comments store; this store only owns the editor
// contents (text + mentions) for both paths.

export interface SocialCommentDraftState {
  draftId?: string;
  revision?: number;
  text: string;
  mentions: SocialTextMention[];
  replyToCommentId?: string;
}

interface SocialCommentDraftsStore {
  drafts: Record<string, SocialCommentDraftState>;
  setDraft: (key: string, draft: SocialCommentDraftState) => void;
  clearDraft: (key: string) => void;
  reset: () => void;
}

function emptyState() {
  return { drafts: {} as Record<string, SocialCommentDraftState> };
}

export function commentDraftKey(
  actorPtid: string | null | undefined,
  sessionEpoch: number | undefined,
  postId: string,
): string {
  return `${actorPtid ?? 'anonymous'}\0${sessionEpoch ?? 0}\0${postId}`;
}

export const useSocialCommentDraftsStore = createDesktopStore<SocialCommentDraftsStore>(
  'social-comment-drafts',
  (set) => ({
    ...emptyState(),

    setDraft: (key, draft) => set((state) => {
      const previous = state.drafts[key];
      const same = previous?.text === draft.text
        && previous.replyToCommentId === draft.replyToCommentId
        && JSON.stringify(previous.mentions) === JSON.stringify(draft.mentions);
      return { drafts: { ...state.drafts, [key]: {
        ...draft, draftId: previous?.draftId ?? crypto.randomUUID(),
        revision: (previous?.revision ?? 0) + (same ? 0 : 1),
      } } };
    }),

    clearDraft: (key) => set((state) => {
      if (!(key in state.drafts)) return state;
      const drafts = { ...state.drafts };
      delete drafts[key];
      return { drafts };
    }),

    reset: () => set(emptyState()),
  }),
);
