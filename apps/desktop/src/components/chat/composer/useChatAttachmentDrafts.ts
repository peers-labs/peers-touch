import { useCallback, useEffect, useRef, useState } from 'react';
import {
  chatMediaKindFromMimeFilename,
  type ChatMediaTransferStatus,
} from '@peers-touch/client-chat-core';

import { imServiceV1 } from '../../../services/im-service';
import type { MessagingLocalAttachmentIntent } from '../../../services/im-service-contract';
import { log } from '../../../utils/logger';

export type ChatDraftStatus = Exclude<ChatMediaTransferStatus, 'queued'>;

export interface ChatDraftAttachment {
  id: string;
  file?: File;
  filePath?: string;
  name: string;
  mimeType: string;
  size: number;
  durationSeconds?: number;
  previewUrl: string | null;
  status: ChatDraftStatus;
  managedSource: boolean;
  attachment?: MessagingLocalAttachmentIntent;
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

interface AddDraftFilesOptions {
  durationSeconds?: number;
}

function createDraftAttachment(
  file: File,
  fallbackName: string,
  options?: AddDraftFilesOptions,
): ChatDraftAttachment {
  const mimeType = file.type || 'application/octet-stream';
  const mediaKind = chatMediaKindFromMimeFilename(mimeType, file.name);
  return {
    id: nextDraftId(),
    file,
    name: file.name || fallbackName,
    mimeType,
    size: file.size,
    durationSeconds: options?.durationSeconds,
    previewUrl: mediaKind === 'image' || mediaKind === 'video'
      ? URL.createObjectURL(file)
      : null,
    status: 'uploading',
    managedSource: false,
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

  const discardManagedSource = useCallback((item: ChatDraftAttachment) => {
    if (!item.managedSource || !item.attachment?.filePath) return;
    imServiceV1.messaging.discardAttachmentSource(item.attachment.filePath).catch((error) => {
      log.warn('chat', 'discard staged attachment source failed', error);
    });
  }, []);

  const clearDrafts = useCallback((discardSources = true) => {
    setDrafts((prev) => {
      prev.forEach((item) => {
        revokePreviewUrl(item);
        if (discardSources) discardManagedSource(item);
      });
      return [];
    });
  }, [discardManagedSource]);

  const stageDraft = useCallback(async (item: ChatDraftAttachment) => {
    if (!item.file && !item.filePath) return;
    patchDraft(item.id, { status: 'uploading' });
    try {
      const filePath = item.filePath ?? await imServiceV1.messaging.stageAttachmentSource(
        item.name,
        new Uint8Array(await item.file!.arrayBuffer()),
      );
      patchDraft(item.id, {
        status: 'ready',
        attachment: {
          filePath,
          filename: item.name,
          mimeType: item.mimeType,
        },
        managedSource: !item.filePath,
      });
    } catch (error) {
      log.error('chat', 'composer attachment staging failed', error);
      patchDraft(item.id, { status: 'failed' });
      onUploadFailed();
    }
  }, [onUploadFailed, patchDraft]);

  const addFiles = useCallback((files: File[], options?: AddDraftFilesOptions) => {
    if (editing || disabled || files.length === 0) return;
    const nextItems = files.map((file) => createDraftAttachment(file, fallbackName, options));
    setDrafts((prev) => [...prev, ...nextItems]);
    nextItems.forEach((item) => {
      stageDraft(item).catch((error) => {
        log.error('chat', 'composer attachment staging task failed', error);
      });
    });
  }, [disabled, editing, fallbackName, stageDraft]);

  const appendReadyAttachment = useCallback((attachment: MessagingLocalAttachmentIntent) => {
    const mediaKind = chatMediaKindFromMimeFilename(attachment.mimeType, attachment.filename);
    setDrafts((prev) => [
      ...prev,
      {
        id: nextDraftId(),
        name: attachment.filename || fallbackName,
        mimeType: attachment.mimeType || 'application/octet-stream',
        size: attachment.size ?? 0,
        previewUrl: mediaKind === 'image' || mediaKind === 'video'
          ? `asset://localhost/${encodeURI(attachment.filePath)}`
          : null,
        status: 'ready',
        managedSource: false,
        attachment,
      },
    ]);
  }, [fallbackName]);

  const removeDraft = useCallback((id: string) => {
    setDrafts((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) {
        revokePreviewUrl(target);
        discardManagedSource(target);
      }
      return prev.filter((item) => item.id !== id);
    });
  }, [discardManagedSource]);

  const retryDraft = useCallback((id: string) => {
    const item = draftsRef.current.find((draft) => draft.id === id);
    if (item) {
      stageDraft(item).catch((error) => {
        log.error('chat', 'composer attachment staging retry failed', error);
      });
    }
  }, [stageDraft]);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  useEffect(() => () => {
    draftsRef.current.forEach((item) => {
      revokePreviewUrl(item);
      discardManagedSource(item);
    });
  }, [discardManagedSource]);

  useEffect(() => {
    clearDrafts();
  }, [clearDrafts, conversationId]);

  const readyAttachments = drafts
    .map((item) => item.attachment)
    .filter((item): item is MessagingLocalAttachmentIntent => Boolean(item));
  const uploading = drafts.some((item) => item.status === 'uploading');
  const failed = drafts.some((item) => item.status === 'failed');

  return {
    drafts,
    readyAttachments,
    uploading,
    failed,
    addFiles,
    appendReadyAttachment,
    clearDrafts,
    removeDraft,
    retryDraft,
  };
}
