import { useCallback, useEffect, useRef, useState } from 'react';

import { uploadAgentAttachmentFile } from '../../services/agentAttachments';
import type { ChatAttachmentInput } from '../../services/desktop_api';
import { log } from '../../utils/logger';

export type AgentDraftStatus = 'uploading' | 'ready' | 'failed';

export interface AgentAttachmentDraft {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  previewUrl: string | null;
  status: AgentDraftStatus;
  progress: number;
  error?: string;
  attachment?: ChatAttachmentInput;
}

interface UseAgentAttachmentDraftsOptions {
  conversationId: string;
  disabled: boolean;
  fallbackName: string;
}

function nextDraftId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function revokePreviewUrl(draft: AgentAttachmentDraft): void {
  if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
}

/** File types accepted by the agent attachment flow. */
export const AGENT_ATTACHMENT_ACCEPT =
  'image/*,application/pdf,.txt,.md,.json,.csv,.zip,.tar.gz,.docx,.xlsx,.pptx,audio/*,video/*';

export function useAgentAttachmentDrafts({
  conversationId,
  disabled,
  fallbackName,
}: UseAgentAttachmentDraftsOptions) {
  const draftsRef = useRef<AgentAttachmentDraft[]>([]);
  const [drafts, setDrafts] = useState<AgentAttachmentDraft[]>([]);

  const patchDraft = useCallback((id: string, patch: Partial<AgentAttachmentDraft>) => {
    setDrafts((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const clearDrafts = useCallback(() => {
    setDrafts((current) => {
      current.forEach(revokePreviewUrl);
      return [];
    });
  }, []);

  const removeDraft = useCallback((id: string) => {
    setDrafts((current) => {
      const target = current.find((draft) => draft.id === id);
      if (target) revokePreviewUrl(target);
      return current.filter((draft) => draft.id !== id);
    });
  }, []);

  const uploadDraft = useCallback((draft: AgentAttachmentDraft, file: File) => {
    patchDraft(draft.id, { status: 'uploading', progress: 10, error: undefined });
    uploadAgentAttachmentFile({ conversationId }, file)
      .then((attachment) => {
        patchDraft(draft.id, { status: 'ready', progress: 100, attachment });
      })
      .catch((error) => {
        log.error('agentChat', 'attachment upload failed', error);
        const errorMessage = error instanceof Error ? error.message : 'upload_failed';
        patchDraft(draft.id, { status: 'failed', progress: 0, error: errorMessage });
      });
  }, [conversationId, patchDraft]);

  const addFiles = useCallback((files: File[]) => {
    if (disabled || files.length === 0) return;
    const added = files.map<AgentAttachmentDraft>((file) => ({
      id: nextDraftId(),
      name: file.name || fallbackName,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      status: 'uploading',
      progress: 0,
    }));
    setDrafts((current) => [...current, ...added]);
    files.forEach((file, index) => {
      uploadDraft(added[index], file);
    });
  }, [disabled, fallbackName, uploadDraft]);

  const retryDraft = useCallback((id: string, file: File) => {
    const draft = draftsRef.current.find((item) => item.id === id);
    if (draft) uploadDraft(draft, file);
  }, [uploadDraft]);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  useEffect(() => () => {
    draftsRef.current.forEach(revokePreviewUrl);
  }, []);

  useEffect(() => {
    clearDrafts();
  }, [clearDrafts, conversationId]);

  return {
    drafts,
    readyAttachments: drafts
      .map((draft) => draft.attachment)
      .filter((attachment): attachment is ChatAttachmentInput => Boolean(attachment)),
    uploading: drafts.some((draft) => draft.status === 'uploading'),
    failed: drafts.some((draft) => draft.status === 'failed'),
    addFiles,
    clearDrafts,
    removeDraft,
    retryDraft,
  };
}
