import {
  api,
  type AgentAttachmentRefInput,
} from './desktop_api';

export interface AgentAttachmentScope {
  conversationId: string;
}

const AGENT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

function requirePortableConversationId(conversationId: string): string {
  const normalized = conversationId.trim();
  if (!normalized || normalized.startsWith('draft:')) {
    throw new Error('agent.errors.attachmentRejected');
  }
  return normalized;
}

export async function uploadAgentAttachmentFile(
  scope: AgentAttachmentScope,
  file: File,
): Promise<AgentAttachmentRefInput> {
  const conversationId = requirePortableConversationId(scope.conversationId);
  if (
    file.size <= 0
    || file.size > AGENT_ATTACHMENT_MAX_BYTES
    || !['image/png', 'application/pdf'].includes(file.type)
  ) {
    throw new Error('agent.errors.attachmentRejected');
  }
  return api.ossUploadAgentAttachmentBytes({
    filename: file.name,
    mime_type: file.type || 'application/octet-stream',
    bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
    conversation_id: conversationId,
  });
}

export async function deleteAgentAttachment(
  attachment: AgentAttachmentRefInput,
): Promise<void> {
  await api.ossDeleteAgentAttachment(attachment.object_ref);
}
