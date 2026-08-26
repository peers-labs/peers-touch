import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
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
  ownsPreviewUrl: boolean;
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

export interface ChatAttachmentPreview {
  previewUrl: string | null;
  ownsPreviewUrl: boolean;
}

export function createChatAttachmentPreview(
  mimeType: string,
  filename: string,
  source: File | string,
): ChatAttachmentPreview {
  const mediaKind = chatMediaKindFromMimeFilename(mimeType, filename);
  if (mediaKind !== 'image' && mediaKind !== 'video') {
    return { previewUrl: null, ownsPreviewUrl: false };
  }
  if (typeof source === 'string') {
    return { previewUrl: convertFileSrc(source), ownsPreviewUrl: false };
  }
  return { previewUrl: URL.createObjectURL(source), ownsPreviewUrl: true };
}

export function revokeChatAttachmentPreview(preview: ChatAttachmentPreview): void {
  if (preview.ownsPreviewUrl && preview.previewUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(preview.previewUrl);
  }
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
  return {
    id: nextDraftId(),
    file,
    name: file.name || fallbackName,
    mimeType,
    size: file.size,
    durationSeconds: options?.durationSeconds,
    ...createChatAttachmentPreview(mimeType, file.name, file),
    status: 'uploading',
    managedSource: false,
  };
}

export function createPickedDraftAttachment(
  attachment: MessagingLocalAttachmentIntent,
  fallbackName: string,
): ChatDraftAttachment {
  const name = attachment.filename || fallbackName;
  const mimeType = attachment.mimeType || 'application/octet-stream';
  const valid = Boolean(attachment.filePath) && (attachment.size ?? 0) > 0;
  return {
    id: nextDraftId(),
    filePath: attachment.filePath,
    name,
    mimeType,
    size: attachment.size ?? 0,
    ...createChatAttachmentPreview(mimeType, name, attachment.filePath),
    status: valid ? 'ready' : 'failed',
    managedSource: valid,
    attachment: valid ? attachment : undefined,
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
        revokeChatAttachmentPreview(item);
        if (discardSources) discardManagedSource(item);
      });
      return [];
    });
  }, [discardManagedSource]);

  const stageDraft = useCallback(async (item: ChatDraftAttachment) => {
    if (!item.file && !item.filePath) return;
    patchDraft(item.id, { status: 'uploading' });
    if (item.filePath && item.size <= 0) {
      patchDraft(item.id, { status: 'failed', attachment: undefined });
      onUploadFailed();
      return;
    }
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
    setDrafts((prev) => [
      ...prev,
      {
        id: nextDraftId(),
        name: attachment.filename || fallbackName,
        mimeType: attachment.mimeType || 'application/octet-stream',
        size: attachment.size ?? 0,
        ...createChatAttachmentPreview(
          attachment.mimeType,
          attachment.filename,
          attachment.filePath,
        ),
        status: 'ready',
        managedSource: false,
        attachment,
      },
    ]);
  }, [fallbackName]);

  const appendPickedAttachment = useCallback((attachment: MessagingLocalAttachmentIntent) => {
    const item = createPickedDraftAttachment(attachment, fallbackName);
    setDrafts((prev) => [...prev, item]);
    if (item.status === 'failed') onUploadFailed();
  }, [fallbackName, onUploadFailed]);

  const removeDraft = useCallback((id: string) => {
    setDrafts((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) {
        revokeChatAttachmentPreview(target);
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
      revokeChatAttachmentPreview(item);
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
    appendPickedAttachment,
    appendReadyAttachment,
    clearDrafts,
    removeDraft,
    retryDraft,
  };
}
