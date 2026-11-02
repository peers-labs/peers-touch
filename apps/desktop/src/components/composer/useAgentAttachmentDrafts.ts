import { useCallback, useEffect, useRef, useState } from 'react';

import {
  deleteAgentAttachment,
  uploadAgentAttachmentFile,
} from '../../services/agentAttachments';
import type { AgentAttachmentRefInput } from '../../services/desktop_api';
import { conversationIdFromAgentDraftKey } from '../../store/agentDraft';
import { log } from '../../utils/logger';

export type AgentDraftStatus = 'uploading' | 'ready' | 'failed' | 'rejected';

export interface AgentAttachmentDraft {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  previewUrl: string | null;
  status: AgentDraftStatus;
  progress: number;
  error?: string;
  attachment?: AgentAttachmentRefInput;
  // Present for locally picked files. TW-D2 rehydrated drafts carry only
  // the Station-owned ref, so the binary is intentionally absent.
  file?: File;
}

// #region debug-point A-D:foundation-attachment-upload
function reportFoundationAttachmentUploadDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7787/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'foundation-attachment-timeout',
      runId: 'post-fix',
      hypothesisId,
      location: 'useAgentAttachmentDrafts.ts',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

interface UseAgentAttachmentDraftsOptions {
  conversationId: string;
  disabled: boolean;
  fallbackName: string;
  /**
   * TW-D2: durable ready refs to rehydrate when the conversation becomes
   * active (task switch back, renderer reload). Read lazily inside the
   * switch effect so it always sees the current persisted snapshot.
   */
  hydrateReadyAttachments?: () => AgentAttachmentRefInput[];
  /**
   * TW-D2: notifies whenever the ready-ref list changes (staging completed,
   * removed, sent, or rehydrated) so the owner can persist the draft.
   */
  onReadyAttachmentsChange?: (refs: AgentAttachmentRefInput[]) => void;
}

/** Reconstruct a composer chip from a durable Station-owned attachment ref. */
function createRehydratedDraftAttachment(
  ref: AgentAttachmentRefInput,
): AgentAttachmentDraft {
  return {
    id: nextDraftId(),
    name: ref.filename,
    mimeType: ref.mime_type,
    size: ref.size_bytes,
    previewUrl: null,
    status: 'ready',
    progress: 100,
    attachment: ref,
  };
}

function nextDraftId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function revokePreviewUrl(draft: AgentAttachmentDraft): void {
  if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
}

function deleteUploadedAttachment(draft: AgentAttachmentDraft): void {
  if (!draft.attachment) return;
  deleteAgentAttachment(draft.attachment).catch((error) => {
    log.warn('agentChat', 'attachment cleanup failed', {
      attachmentId: draft.attachment?.attachment_id,
      error: String(error),
    });
  });
}

export function agentAttachmentDraftsBlockSend(
  drafts: readonly Pick<AgentAttachmentDraft, 'status'>[],
): boolean {
  return drafts.some(
    (draft) =>
      draft.status === 'uploading'
      || draft.status === 'failed'
      || draft.status === 'rejected',
  );
}

/** File types accepted by the agent attachment flow. */
export const AGENT_ATTACHMENT_ACCEPT = 'image/png,application/pdf';

export function useAgentAttachmentDrafts({
  conversationId,
  disabled,
  fallbackName,
  hydrateReadyAttachments,
  onReadyAttachmentsChange,
}: UseAgentAttachmentDraftsOptions) {
  const draftsRef = useRef<AgentAttachmentDraft[]>([]);
  const [drafts, setDrafts] = useState<AgentAttachmentDraft[]>([]);
  const hydrateReadyAttachmentsRef = useRef(hydrateReadyAttachments);
  const onReadyAttachmentsChangeRef = useRef(onReadyAttachmentsChange);
  useEffect(() => {
    hydrateReadyAttachmentsRef.current = hydrateReadyAttachments;
  });
  useEffect(() => {
    onReadyAttachmentsChangeRef.current = onReadyAttachmentsChange;
  });

  const patchDraft = useCallback((id: string, patch: Partial<AgentAttachmentDraft>) => {
    const next = draftsRef.current.map((item) => (item.id === id ? { ...item, ...patch } : item));
    draftsRef.current = next;
    setDrafts(next);
  }, []);

  const clearDrafts = useCallback((deleteUploaded = true) => {
    const current = draftsRef.current;
    draftsRef.current = [];
    setDrafts([]);
    current.forEach((draft) => {
      if (deleteUploaded) {
        revokePreviewUrl(draft);
        deleteUploadedAttachment(draft);
      }
    });
  }, []);

  const removeDraft = useCallback((id: string) => {
    const target = draftsRef.current.find((draft) => draft.id === id);
    draftsRef.current = draftsRef.current.filter((draft) => draft.id !== id);
    setDrafts(draftsRef.current);
    if (!target) return;
    revokePreviewUrl(target);
    deleteUploadedAttachment(target);
  }, []);

  const rejectDraft = useCallback((attachmentId: string, error: string) => {
    const target = draftsRef.current.find(
      (draft) => draft.attachment?.attachment_id === attachmentId,
    );
    if (!target) return;
    patchDraft(target.id, {
      status: 'rejected',
      progress: 100,
      error,
    });
  }, [patchDraft]);

  const uploadDraft = useCallback((draft: AgentAttachmentDraft) => {
    // Rehydrated (TW-D2) drafts carry only the Station ref; they are
    // already staged and never re-upload from a missing local binary.
    if (!draft.file) return;
    patchDraft(draft.id, { status: 'uploading', progress: 10, error: undefined });
    const attachmentConversationId =
      conversationIdFromAgentDraftKey(conversationId) ?? conversationId;
    void reportFoundationAttachmentUploadDebug('A-D', 'upload-started', {
      draftId: draft.id,
      conversationIdPresent: attachmentConversationId.length > 0,
      conversationUsesDraftKey: attachmentConversationId !== conversationId,
      mimeType: draft.file.type,
      sizeBytes: draft.file.size,
    });
    uploadAgentAttachmentFile({ conversationId: attachmentConversationId }, draft.file)
      .then((attachment) => {
        const draftRetained = draftsRef.current.some((item) => item.id === draft.id);
        void reportFoundationAttachmentUploadDebug('A-B', 'upload-resolved', {
          draftId: draft.id,
          draftRetained,
          attachmentIdPresent: Boolean(attachment.attachment_id),
          objectRefPresent: Boolean(attachment.object_ref),
        });
        if (!draftRetained) {
          void deleteAgentAttachment(attachment);
          return;
        }
        patchDraft(draft.id, { status: 'ready', progress: 100, attachment });
      })
      .catch((error) => {
        log.error('agentChat', 'attachment upload failed', error);
        const errorMessage = error instanceof Error ? error.message : 'upload_failed';
        void reportFoundationAttachmentUploadDebug('A-D', 'upload-rejected', {
          draftId: draft.id,
          draftRetained: draftsRef.current.some((item) => item.id === draft.id),
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage,
        });
        patchDraft(draft.id, { status: 'failed', progress: 0, error: errorMessage });
      });
  }, [conversationId, patchDraft]);

  const addFiles = useCallback((files: File[]) => {
    void reportFoundationAttachmentUploadDebug('A-C', 'files-selected', {
      disabled,
      fileCount: files.length,
      mimeTypes: files.map((file) => file.type),
      sizes: files.map((file) => file.size),
      conversationIdPresent: conversationId.length > 0,
    });
    if (disabled || files.length === 0) return;
    const added = files.map<AgentAttachmentDraft>((file) => ({
      id: nextDraftId(),
      name: file.name || fallbackName,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      status: 'uploading',
      progress: 0,
      file,
    }));
    draftsRef.current = [...draftsRef.current, ...added];
    setDrafts(draftsRef.current);
    added.forEach((draft) => {
      uploadDraft(draft);
    });
  }, [disabled, fallbackName, uploadDraft]);

  const retryDraft = useCallback((id: string) => {
    const draft = draftsRef.current.find((item) => item.id === id);
    if (draft?.status === 'failed') uploadDraft(draft);
  }, [uploadDraft]);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  // TW-D2: detach revokes local previews and reclaims only uploads that
  // never became a durable-ready ref. Ready refs remain staged in Station
  // OSS under the persisted draft; if a draft is truly abandoned (never
  // rehydrated), the Station OSS TTL sweeper is the final reclaimer.
  const detachDrafts = useCallback(() => {
    const current = draftsRef.current;
    draftsRef.current = [];
    setDrafts([]);
    current.forEach((draft) => {
      revokePreviewUrl(draft);
      if (draft.status !== 'ready') deleteUploadedAttachment(draft);
    });
  }, []);

  // Switching tasks detaches the outgoing draft WITHOUT deleting its ready
  // refs, then rehydrates the incoming draft from its durable refs.
  useEffect(() => {
    detachDrafts();
    const restored = (hydrateReadyAttachmentsRef.current?.() ?? [])
      .map(createRehydratedDraftAttachment);
    if (restored.length > 0) {
      draftsRef.current = restored;
      setDrafts(restored);
    }
  }, [conversationId, detachDrafts]);

  // Closing the page keeps ready refs staged for the next launch.
  useEffect(() => () => {
    detachDrafts();
  }, [detachDrafts]);

  // Mirror the ready-ref list to the durable-draft owner. Identity is
  // guarded in the store action, so rehydration cannot start a write loop.
  useEffect(() => {
    const readyRefs = drafts
      .map((draft) => draft.attachment)
      .filter((attachment): attachment is AgentAttachmentRefInput => Boolean(attachment));
    onReadyAttachmentsChangeRef.current?.(readyRefs);
  }, [drafts]);

  return {
    drafts,
    readyAttachments: drafts
      .filter((draft) => draft.status === 'ready')
      .map((draft) => draft.attachment)
      .filter((attachment): attachment is AgentAttachmentRefInput => Boolean(attachment)),
    uploading: drafts.some((draft) => draft.status === 'uploading'),
    failed: drafts.some(
      (draft) => draft.status === 'failed' || draft.status === 'rejected',
    ),
    addFiles,
    clearDrafts,
    rejectDraft,
    removeDraft,
    retryDraft,
  };
}
