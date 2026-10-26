import type { ChatFilePreviewLabels } from './previewSurface.js';

/** Navigation belongs to the selected preview rectangle on both clients. */
export function previewNavigation(labels: ChatFilePreviewLabels, signal: AbortSignal) {
  const element = document.createElement('div');
  element.className = 'chat-pdf-navigation chat-preview-navigation';
  const previous = document.createElement('button');
  const next = document.createElement('button');
  const status = document.createElement('span');
  previous.type = next.type = 'button';
  previous.textContent = labels.previousPage;
  next.textContent = labels.nextPage;
  status.setAttribute('role', 'status');
  previous.disabled = next.disabled = true;
  element.append(previous, status, next);
  signal.addEventListener('abort', () => element.remove(), { once: true });
  return {
    element, previous, next, status,
    update(page: number, total: number, busy = false) {
      element.setAttribute('aria-busy', String(busy));
      status.textContent = busy ? labels.preparing : labels.page(page, total);
      previous.disabled = busy || page <= 1;
      next.disabled = busy || page >= total;
    },
  };
}
