import { useCallback, useEffect, useRef, useState } from 'react';

import { uploadAgentAttachmentFile } from '../../services/agentAttachments';
import type { ChatAttachmentInput } from '../../services/desktop_api';
import { log } from '../../utils/logger';

export interface AgentAttachmentDraft {
  id: string;
  name: string;
  previewUrl: string | null;
  status: 'uploading' | 'ready' | 'failed';
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

export function useAgentAttachmentDrafts({
  conversationId,
  disabled,
  fallbackName,
}: UseAgentAttachmentDraftsOptions) {
  const draftsRef = useRef<AgentAttachmentDraft[]>([]);
  const [drafts, setDrafts] = useState<AgentAttachmentDraft[]>([]);

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

  const addFiles = useCallback((files: File[]) => {
    if (disabled || files.length === 0) return;
    const added = files.map<AgentAttachmentDraft>((file) => ({
      id: nextDraftId(),
      name: file.name || fallbackName,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      status: 'uploading',
    }));
    setDrafts((current) => [...current, ...added]);
    files.forEach((file, index) => {
      const draft = added[index];
      uploadAgentAttachmentFile({ conversationId }, file)
        .then((attachment) => {
          setDrafts((current) => current.map((item) => (
            item.id === draft.id ? { ...item, status: 'ready', attachment } : item
          )));
        })
        .catch((error) => {
          log.error('agentChat', 'attachment upload failed', error);
          setDrafts((current) => current.map((item) => (
            item.id === draft.id ? { ...item, status: 'failed' } : item
          )));
        });
    });
  }, [conversationId, disabled, fallbackName]);

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
    addFiles,
    clearDrafts,
    removeDraft,
  };
}
