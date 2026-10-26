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
import type { MessagingProjectionScope } from './messagingRuntime';

function account(scope: MessagingProjectionScope) {
  return { stationPeerId: scope.stationPeerId, actorPtid: scope.actorPtid };
}

export const mobileAttachmentAccess = new ChatAttachmentAccessController<
  MessagingProjectionScope, AttachmentAccessProjection, AttachmentFileAction, AttachmentFileActionResult
>({
  async read(scope, attachmentId, startDownload, retry) {
    const bytes = await invoke<number[]>('messaging_attachment_access', {
      input: { ...account(scope), attachmentId, startDownload, retry },
    });
    return fromBinary(AttachmentAccessProjectionSchema, new Uint8Array(bytes));
  },
  release: (scope, accessHandle) => invoke('messaging_release_attachment', {
    input: { ...account(scope), accessHandle },
  }),
  cancel: (scope, attachmentId) => invoke('messaging_cancel_attachment', {
    input: { ...account(scope), attachmentId },
  }),
  async action(scope, attachmentId, accessHandle, action) {
    const request = create(AttachmentFileActionRequestSchema, { attachmentId, accessHandle, action });
    const bytes = await invoke<number[]>('messaging_attachment_file_action', {
      input: { ...account(scope), requestBytes: Array.from(toBinary(AttachmentFileActionRequestSchema, request)) },
    });
    return fromBinary(AttachmentFileActionResultSchema, new Uint8Array(bytes));
  },
  handle: (projection) => projection.accessHandle,
  pending: (projection) => projection.state === AttachmentAccessState.DOWNLOADING
    || projection.state === AttachmentAccessState.VERIFYING,
});
