import { getDocument, GlobalWorkerOptions, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import {
  CHAT_PDF_PREVIEW_LIMIT,
  readChatAttachmentPreview,
  setChatFilePreviewUnavailable,
  type ChatFilePreviewLabels,
} from './attachmentPreview.js';

const MAX_CANVAS_PIXELS = 4 * 1024 * 1024;

/** PDF.js runs in a bundled worker; no embedded document, scripts or XFA. */
export async function mountChatPdfPreview(
  container: HTMLElement,
  url: string,
  size: number,
  labels: ChatFilePreviewLabels,
  signal: AbortSignal,
): Promise<void> {
  const blob = await readChatAttachmentPreview(url, size, CHAT_PDF_PREVIEW_LIMIT, signal);
  const data = new Uint8Array(await blob.arrayBuffer());
  signal.throwIfAborted();
  GlobalWorkerOptions.workerSrc = workerUrl;
  const loading = getDocument({
    data,
    enableXfa: false,
    useSystemFonts: false,
    disableAutoFetch: true,
  });
  let task: RenderTask | null = null;
  let resize: ResizeObserver | null = null;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    task?.cancel();
    resize?.disconnect();
    container.querySelectorAll('canvas').forEach((canvas) => {
      canvas.width = canvas.height = 0;
    });
    container.replaceChildren();
    void loading.destroy().catch(() => {});
  };
  signal.addEventListener('abort', dispose, { once: true });
  const pdf = await loading.promise.catch((error: unknown) => {
    dispose();
    throw error;
  });
  signal.throwIfAborted();
  const surface = document.createElement('div');
  surface.className = 'chat-pdf-preview';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  const navigation = document.createElement('div');
  navigation.className = 'chat-pdf-navigation';
  const previous = document.createElement('button');
  const next = document.createElement('button');
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  previous.type = next.type = 'button';
  previous.textContent = labels.previousPage;
  next.textContent = labels.nextPage;
  navigation.append(previous, status, next);
  surface.append(navigation, canvas);
  container.replaceChildren(surface);
  let pageNumber = 1;
  let revision = 0;
  let previousWidth = 0;
  const render = async () => {
    if (disposed) return;
    const current = ++revision;
    const prior = task;
    prior?.cancel();
    previous.disabled = next.disabled = true;
    try {
      await prior?.promise.catch(() => {});
      const page = await pdf.getPage(pageNumber);
      if (disposed || signal.aborted || current !== revision) return;
      const base = page.getViewport({ scale: 1 });
      const width = Math.max(1, Math.min(container.clientWidth || 720, 1200));
      const density = Math.min(window.devicePixelRatio || 1, 2);
      const scale = Math.min(width / base.width * density, Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height)));
      const viewport = page.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.min(width, viewport.width / density)}px`;
      canvas.setAttribute('aria-label', labels.page(pageNumber, pdf.numPages));
      status.textContent = labels.page(pageNumber, pdf.numPages);
      task = page.render({ canvas, viewport });
      await task.promise;
      if (disposed || signal.aborted || current !== revision) return;
      previous.disabled = pageNumber === 1;
      next.disabled = pageNumber === pdf.numPages;
      page.cleanup();
    } catch {
      if (!signal.aborted && current === revision) {
        dispose();
        setChatFilePreviewUnavailable(container, labels.unavailable);
      }
    }
  };
  previous.addEventListener('click', () => { pageNumber -= 1; void render(); }, { signal });
  next.addEventListener('click', () => { pageNumber += 1; void render(); }, { signal });
  resize = new ResizeObserver(() => {
    const width = container.clientWidth;
    if (width !== previousWidth && !signal.aborted) {
      previousWidth = width;
      void render();
    }
  });
  resize.observe(container);
  await render();
}
