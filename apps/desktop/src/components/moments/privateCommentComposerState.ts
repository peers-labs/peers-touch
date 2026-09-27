import type {
  PrivateCommentPublicationState,
  PrivateCommentState,
} from '../../services/privateCommentsNative';

export type PrivateCommentComposerAction = 'submit' | 'retry' | 'reconcile';

interface PrivateCommentComposerActionInput {
  state?: PrivateCommentState;
  publicationState?: PrivateCommentPublicationState;
  retryDeadlinePending: boolean;
  text: string;
  draftText?: string;
}

export function resolvePrivateCommentComposerAction({
  state,
  publicationState,
  retryDeadlinePending,
  text,
  draftText,
}: PrivateCommentComposerActionInput): PrivateCommentComposerAction {
  if (publicationState === 'COMMITTED_PENDING_READBACK') {
    return 'reconcile';
  }
  if (
    (state === 'COMMENT_FAILED' || state === 'COMMENT_RATE_LIMITED')
    && !retryDeadlinePending
    && text.trim() === draftText?.trim()
  ) {
    return 'retry';
  }
  return 'submit';
}
