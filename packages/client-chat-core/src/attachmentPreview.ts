import type { ChatFilePreviewKind } from './attachmentAccess.js';
import { AttachmentByteReader } from './attachmentByteReader.js';
import { setChatFilePreviewState, setChatFilePreviewUnavailable, type ChatFilePreviewLabels } from './previewSurface.js';
export { setChatFilePreviewUnavailable, type ChatFilePreviewLabels } from './previewSurface.js';

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
  setChatFilePreviewState(container, 'loading');
  container.dataset.chatPreviewKind = kind;
  signal.throwIfAborted();
  const reader = new AttachmentByteReader(url, size, signal);
  if (kind === 'pdf') {
    const { mountChatPdfPreview } = await import('./pdfPreview.js');
    signal.throwIfAborted();
    return mountChatPdfPreview(container, url, size, labels, signal);
  }
  if (kind === 'office') {
    const { mountChatOfficePreview } = await import('./officePreview.js');
    signal.throwIfAborted();
    return mountChatOfficePreview(container, reader, filename, labels);
  }
  if (kind === 'text') {
    const { mountChatTextPreview } = await import('./textPreview.js');
    signal.throwIfAborted();
    return mountChatTextPreview(container, reader, labels);
  }
  if (kind === 'file') {
    setChatFilePreviewUnavailable(container, labels.unavailable);
    return;
  }
  const node = document.createElement(kind === 'image' ? 'img' : kind);
  const ready = () => {
    if (!signal.aborted) setChatFilePreviewState(container, 'ready');
  };
  node.addEventListener('error', () => setChatFilePreviewUnavailable(container, labels.unavailable), { signal });
  if (node instanceof HTMLMediaElement) {
    node.addEventListener('loadeddata', ready, { signal, once: true });
    node.controls = true;
    // A metadata-only preload need not emit loadeddata in WKWebView. Request
    // the first decoded sample/frame while retaining native Range streaming.
    node.preload = 'auto';
    node.src = url;
    signal.addEventListener('abort', () => { node.pause(); node.removeAttribute('src'); node.load(); }, { once: true });
  } else if (node instanceof HTMLImageElement) {
    node.addEventListener('load', ready, { signal, once: true });
    node.alt = filename;
    node.src = `${url}?representation=preview`;
    signal.addEventListener('abort', () => node.removeAttribute('src'), { once: true });
  }
  container.replaceChildren(node);
  signal.addEventListener('abort', () => container.replaceChildren(), { once: true });
}
