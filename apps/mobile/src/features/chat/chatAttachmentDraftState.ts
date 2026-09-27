import type {
  MessagingAttachmentStageProjection,
  MessagingVoiceNoteMetadata,
} from '../../services/mobileCommands';

export type ChatAttachmentDraftStatus =
  | 'uploading'
  | 'ready'
  | 'failed'
  | 'submitted';

export interface MobileChatAttachmentDraft {
  readonly id: string;
  readonly file: File;
  readonly filename: string;
  readonly mimeType: string;
  readonly previewUrl: string;
  readonly attempt: number;
  readonly status: ChatAttachmentDraftStatus;
  readonly voiceNote?: MessagingVoiceNoteMetadata;
  readonly attachment?: MessagingAttachmentStageProjection;
}

export function patchChatAttachmentDraft(
  drafts: readonly MobileChatAttachmentDraft[],
  id: string,
  patch: Partial<MobileChatAttachmentDraft>,
): MobileChatAttachmentDraft[] {
  return drafts.map((draft) => (
    draft.id === id ? { ...draft, ...patch } : draft
  ));
}

export function readyChatAttachmentStages(
  drafts: readonly MobileChatAttachmentDraft[],
): MessagingAttachmentStageProjection[] {
  return drafts.flatMap((draft) => (
    draft.status === 'ready' && draft.attachment
      ? [draft.attachment]
      : []
  ));
}

export function markChatAttachmentDraftsSubmitted(
  drafts: readonly MobileChatAttachmentDraft[],
): MobileChatAttachmentDraft[] {
  return drafts.map((draft) => (
    draft.status === 'ready'
      ? { ...draft, status: 'submitted', attachment: undefined }
      : draft
  ));
}

export function markSubmittedChatAttachmentDraftsFailed(
  drafts: readonly MobileChatAttachmentDraft[],
): MobileChatAttachmentDraft[] {
  return drafts.map((draft) => (
    draft.status === 'submitted'
      ? { ...draft, status: 'failed' }
      : draft
  ));
}
