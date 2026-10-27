import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { invoke } from '@tauri-apps/api/core';
import { ChatAttachmentAccessController } from '@peers-touch/client-chat-core';
import {
  AttachmentAccessProjectionSchema,
  AttachmentAccessState,
  AttachmentFileActionRequestSchema,
  AttachmentFileActionResultSchema,
  type AttachmentAccessProjection,
  type AttachmentFileAction,
  type AttachmentFileActionResult,
} from '../gen/proto/domain/chat/attachment_pb';
import { RustCommandException, type RustCommandResult } from '../services/desktop_api';
import type { MessagingRuntimeScope } from './runtime';

async function command<T>(name: string, input: unknown): Promise<T> {
  const result = await invoke<RustCommandResult<T>>(name, { input });
  if (!result.ok) throw new RustCommandException(name, result.error);
  return result.data as T;
}

export async function readMessagingAttachmentAccess(id: string, startDownload = true, retry = false) {
  const bytes = await command<number[]>('messaging_attachment_access', {
    attachment_id: id, start_download: startDownload, retry,
  });
  return fromBinary(AttachmentAccessProjectionSchema, new Uint8Array(bytes));
}

export const messagingAttachmentAccess = new ChatAttachmentAccessController<
  MessagingRuntimeScope, AttachmentAccessProjection, AttachmentFileAction, AttachmentFileActionResult
>({
  read: (_scope, id, startDownload, retry) => readMessagingAttachmentAccess(id, startDownload, retry),
  release: (_scope, handle) => invoke('messaging_release_attachment', {
    input: { access_handle: handle },
  }),
  cancel: (_scope, id) => command<void>('messaging_cancel_attachment', { attachment_id: id }),
  async action(_scope, id, handle, action) {
    const request = create(AttachmentFileActionRequestSchema, {
      attachmentId: id, accessHandle: handle, action,
    });
    const bytes = await command<number[]>('messaging_attachment_file_action', {
      request_bytes: Array.from(toBinary(AttachmentFileActionRequestSchema, request)),
    });
    return fromBinary(AttachmentFileActionResultSchema, new Uint8Array(bytes));
  },
  handle: (projection) => projection.accessHandle,
  pending: (projection) => projection.state === AttachmentAccessState.DOWNLOADING
    || projection.state === AttachmentAccessState.VERIFYING,
  pendingError: (error) => error instanceof RustCommandException
    && error.message === 'FILE_PROJECTION_UNAVAILABLE',
});
