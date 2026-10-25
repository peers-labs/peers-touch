import { chatFilePreviewKind } from './attachmentAccess.js';
import type { ChatAttachmentLike } from './index.js';

/** Short type names are presentation metadata; raw MIME stays inspectable. */
export function chatAttachmentFileType(attachment: ChatAttachmentLike): string {
  const extension = attachment.filename?.includes('.') ? attachment.filename.split('.').pop()?.toLowerCase() : '';
  if (extension && /^[a-z0-9]{1,8}$/.test(extension)) return extension.toUpperCase();
  const mime = (attachment.mimeType || attachment.mime_type || '').split(';')[0].toLowerCase();
  const subtype = mime.split('/')[1];
  if (subtype && /^[a-z0-9]{1,8}$/.test(subtype) && subtype !== 'plain') return subtype.toUpperCase();
  return chatFilePreviewKind(attachment) === 'file' ? '' : mime.split('/')[0]?.toUpperCase() || '';
}
