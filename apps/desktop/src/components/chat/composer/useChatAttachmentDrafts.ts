import { useCallback, useEffect, useRef, useState } from 'react';
import {
  chatMediaKindFromMimeFilename,
  type ChatMediaTransferStatus,
} from '@peers-touch/client-chat-core';

import { uploadChatAttachmentFile, uploadChatAttachmentPath } from '../../../services/chatAttachments';
import type { ChatAttachmentInput } from '../../../services/desktop_api';
import { log } from '../../../utils/logger';

export type ChatDraftStatus = Exclude<ChatMediaTransferStatus, 'queued'>;

export interface ChatDraftAttachment {
  id: string;
  file?: File;
  filePath?: string;
  name: string;
  mimeType: string;
  size: number;
  previewUrl: string | null;
  status: ChatDraftStatus;
  attachment?: ChatAttachmentInput;
}

interface UseChatAttachmentDraftsOptions {
  conversationId: string;
  disabled: boolean;
  editing: boolean;
  fallbackName: string;
  onUploadFailed: () => void;
}

function nextDraftId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function revokePreviewUrl(item: ChatDraftAttachment): void {
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
}

function createDraftAttachment(file: File, fallbackName: string): ChatDraftAttachment {
  const mimeType = file.type || 'application/octet-stream';
  const mediaKind = chatMediaKindFromMimeFilename(mimeType, file.name);
  return {
    id: nextDraftId(),
    file,
    name: file.name || fallbackName,
    mimeType,
    size: file.size,
    previewUrl: mediaKind === 'image' || mediaKind === 'video'
      ? URL.createObjectURL(file)
      : null,
    status: 'uploading',
  };
}

function createPathDraftAttachment(filePath: string, fallbackName: string): ChatDraftAttachment {
  const name = filePath.split(/[\\/]/).filter(Boolean).pop() || fallbackName;
  return {
    id: nextDraftId(),
    filePath,
    name,
    mimeType: 'application/octet-stream',
    size: 0,
    previewUrl: null,
    status: 'uploading',
  };
}

export function useChatAttachmentDrafts({
  conversationId,
  disabled,
  editing,
  fallbackName,
  onUploadFailed,
}: UseChatAttachmentDraftsOptions) {
  const draftsRef = useRef<ChatDraftAttachment[]>([]);
  const [drafts, setDrafts] = useState<ChatDraftAttachment[]>([]);

  const patchDraft = useCallback((id: string, patch: Partial<ChatDraftAttachment>) => {
    setDrafts((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const clearDrafts = useCallback(() => {
    setDrafts((prev) => {
      prev.forEach(revokePreviewUrl);
      return [];
    });
  }, []);

  const uploadDraft = useCallback(async (item: ChatDraftAttachment) => {
    if (!item.file && !item.filePath) return;
    patchDraft(item.id, { status: 'uploading' });
    try {
      const attachment = item.filePath
        ? await uploadChatAttachmentPath({ conversationId }, item.filePath)
        : await uploadChatAttachmentFile({ conversationId }, item.file!);
      patchDraft(item.id, {
        status: 'ready',
        attachment: {
          ...attachment,
          filename: attachment.filename || item.name,
          mime_type: attachment.mime_type || item.mimeType,
          size: attachment.size || item.size,
        },
      });
    } catch (error) {
      log.error('chat', 'composer attachment upload failed', error);
      patchDraft(item.id, { status: 'failed' });
      onUploadFailed();
    }
  }, [conversationId, onUploadFailed, patchDraft]);

  const addFiles = useCallback((files: File[]) => {
    if (editing || disabled || files.length === 0) return;
    const nextItems = files.map((file) => createDraftAttachment(file, fallbackName));
    setDrafts((prev) => [...prev, ...nextItems]);
    nextItems.forEach((item) => {
      uploadDraft(item).catch((error) => {
        log.error('chat', 'composer attachment upload task failed', error);
      });
    });
  }, [disabled, editing, fallbackName, uploadDraft]);

  const addPath = useCallback((filePath: string) => {
    if (editing || disabled || !filePath) return;
    const item = createPathDraftAttachment(filePath, fallbackName);
    setDrafts((prev) => [...prev, item]);
    uploadDraft(item).catch((error) => {
      log.error('chat', 'composer attachment path upload task failed', error);
    });
  }, [disabled, editing, fallbackName, uploadDraft]);

  const appendReadyAttachment = useCallback((attachment: ChatAttachmentInput) => {
    setDrafts((prev) => [
      ...prev,
      {
        id: nextDraftId(),
        name: attachment.filename || fallbackName,
        mimeType: attachment.mime_type || 'application/octet-stream',
        size: attachment.size || 0,
        previewUrl: null,
        status: 'ready',
        attachment,
      },
    ]);
  }, [fallbackName]);

  const removeDraft = useCallback((id: string) => {
    setDrafts((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) revokePreviewUrl(target);
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const retryDraft = useCallback((id: string) => {
    const item = draftsRef.current.find((draft) => draft.id === id);
    if (item) {
      uploadDraft(item).catch((error) => {
        log.error('chat', 'composer attachment retry failed', error);
      });
    }
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

  const readyAttachments = drafts
    .map((item) => item.attachment)
    .filter((item): item is ChatAttachmentInput => Boolean(item));
  const uploading = drafts.some((item) => item.status === 'uploading');
  const failed = drafts.some((item) => item.status === 'failed');

  return {
    drafts,
    readyAttachments,
    uploading,
    failed,
    addFiles,
    addPath,
    appendReadyAttachment,
    clearDrafts,
    removeDraft,
    retryDraft,
  };
}
