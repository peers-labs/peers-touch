import { CHAT_TEXT_PREVIEW_LIMIT, type ChatFilePreviewKind } from './attachmentAccess.js';

export const CHAT_IMAGE_PREVIEW_LIMIT = 32 * 1024 * 1024;
export const CHAT_PDF_PREVIEW_LIMIT = 64 * 1024 * 1024;
export const CHAT_INLINE_IMAGE_LIMIT = 8 * 1024 * 1024;
const RANGE_SIZE = 4 * 1024 * 1024;

export interface ChatFilePreviewLabels {
  preparing: string;
  unavailable: string;
  previousPage: string;
  nextPage: string;
  page: (page: number, total: number) => string;
}

export function setChatFilePreviewUnavailable(container: HTMLElement, label: string): void {
  container.textContent = label;
  container.setAttribute('data-chat-file-preview-unavailable', 'true');
}

/** Platform renderers mount one selected resource; abort owns all disposal. */
export async function mountChatAttachmentPreview(
  container: HTMLElement,
  url: string,
  kind: ChatFilePreviewKind,
  size: number,
  filename: string,
  labels: ChatFilePreviewLabels,
  signal: AbortSignal,
): Promise<void> {
  container.removeAttribute('data-chat-file-preview-unavailable');
  container.textContent = labels.preparing;
  signal.throwIfAborted();
  if (kind === 'pdf') {
    const { mountChatPdfPreview } = await import('./pdfPreview.js');
    signal.throwIfAborted();
    return mountChatPdfPreview(container, url, size, labels, signal);
  }
  if (kind === 'file' || kind === 'office') {
    setChatFilePreviewUnavailable(container, labels.unavailable);
    return;
  }
  const node = document.createElement(kind === 'image' ? 'img' : kind === 'text' ? 'pre' : kind);
  node.addEventListener('error', () => setChatFilePreviewUnavailable(container, labels.unavailable), { signal });
  if (node instanceof HTMLMediaElement) {
    node.controls = true;
    node.preload = 'metadata';
    node.src = url;
    signal.addEventListener('abort', () => { node.pause(); node.removeAttribute('src'); node.load(); }, { once: true });
  } else {
    const blob = await readChatAttachmentPreview(
      url, size, kind === 'image' ? CHAT_IMAGE_PREVIEW_LIMIT : CHAT_TEXT_PREVIEW_LIMIT, signal,
    );
    signal.throwIfAborted();
    if (node instanceof HTMLImageElement) {
      node.alt = filename;
      node.src = URL.createObjectURL(blob);
      signal.addEventListener('abort', () => URL.revokeObjectURL(node.src), { once: true });
    } else {
      const text = await blob.text();
      signal.throwIfAborted();
      node.textContent = text;
    }
  }
  container.replaceChildren(node);
  signal.addEventListener('abort', () => container.replaceChildren(), { once: true });
}

/** Assemble only a bounded preview; streaming media retains HTTP Range reads. */
export async function readChatAttachmentPreview(
  url: string,
  size: number,
  limit: number,
  signal: AbortSignal,
): Promise<Blob> {
  signal.throwIfAborted();
  if (!Number.isSafeInteger(size) || size < 0 || size > limit) throw new Error('FILE_PREVIEW_TOO_LARGE');
  const parts: ArrayBuffer[] = [];
  for (let offset = 0; offset < size; offset += RANGE_SIZE) {
    const end = Math.min(size, offset + RANGE_SIZE) - 1;
    const response = await fetch(url, {
      headers: { Range: `bytes=${offset}-${end}` },
      cache: 'no-store',
      signal,
    });
    if (!response.ok) throw new Error('FILE_PREVIEW_UNAVAILABLE');
    signal.throwIfAborted();
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== end - offset + 1) throw new Error('FILE_PREVIEW_INCOMPLETE');
    parts.push(bytes);
  }
  signal.throwIfAborted();
  return new Blob(parts);
}
