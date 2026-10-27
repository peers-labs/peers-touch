import { getDocument, GlobalWorkerOptions, PDFDataRangeTransport, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import {
  setChatFilePreviewUnavailable,
  setChatFilePreviewState,
  type ChatFilePreviewLabels,
} from './previewSurface.js';
import { AttachmentByteReader } from './attachmentByteReader.js';
import { previewToolbar } from './previewToolbar.js';

const MAX_CANVAS_PIXELS = 4 * 1024 * 1024;
const MAX_DEMAND_BYTES = 32 * 1024 * 1024;

/** PDF.js runs in a bundled worker; no embedded document, scripts or XFA. */
export async function mountChatPdfPreview(
  container: HTMLElement,
  url: string,
  size: number,
  labels: ChatFilePreviewLabels,
  signal: AbortSignal,
): Promise<void> {
  const reads = new AbortController();
  const abortReads = () => reads.abort();
  signal.addEventListener('abort', abortReads, { once: true });
  const reader = new AttachmentByteReader(url, size, reads.signal);
  const initial = await reader.read(0, Math.min(size, 64 * 1024));
  signal.throwIfAborted();
  GlobalWorkerOptions.workerSrc = workerUrl;
  let failRead: ((resource?: boolean) => void) | undefined;
  class GrantRangeTransport extends PDFDataRangeTransport {
    requestDataRange(begin: number, end: number) {
      // PDF.js requires one callback per coalesced demand range. Native reads
      // stay bounded; the decoder's contiguous demand has its own resource cap.
      if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end)
        || begin < 0 || end <= begin || end > size || end - begin > MAX_DEMAND_BYTES) {
        failRead?.(true);
        return;
      }
      void (async () => {
        const result = new Uint8Array(end - begin);
        for (let offset = begin; offset < end; offset += 1024 * 1024) {
          const bytes = await reader.read(offset, Math.min(1024 * 1024, end - offset));
          if (reads.signal.aborted) return;
          result.set(bytes, offset - begin);
        }
        this.onDataRange(begin, result);
      })().catch(() => { if (!reads.signal.aborted) failRead?.(); });
    }
    abort() { reads.abort(); }
  }
  const loading = getDocument({
    range: new GrantRangeTransport(size, initial, true),
    rangeChunkSize: 256 * 1024,
    disableStream: true,
    enableXfa: false,
    useSystemFonts: false,
    disableAutoFetch: true,
    maxImageSize: 32 * 1024 * 1024,
    canvasMaxAreaInBytes: MAX_CANVAS_PIXELS * 4,
  });
  let task: RenderTask | null = null;
  let resize: ResizeObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    reads.abort();
    signal.removeEventListener('abort', abortReads);
    task?.cancel();
    clearTimeout(timer);
    resize?.disconnect();
    container.querySelectorAll('canvas').forEach((canvas) => {
      canvas.width = canvas.height = 0;
    });
    container.replaceChildren();
    void loading.destroy().catch(() => {});
  };
  failRead = (resource = false) => {
    dispose();
    if (!signal.aborted) setChatFilePreviewUnavailable(container, resource ? labels.resourceUnavailable : labels.unavailable);
  };
  const armDeadline = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      dispose();
      if (!signal.aborted) setChatFilePreviewUnavailable(container, labels.resourceUnavailable);
    }, 30_000);
  };
  armDeadline();
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
  const viewportHost = document.createElement('div');
  viewportHost.className = 'chat-pdf-canvas-scroll';
  viewportHost.append(canvas);
  let zoomValue: 'width' | 'page' | 'actual' = 'width';
  const toolbar = previewToolbar({
    labels,
    signal,
    initialZoom: 'width',
    onPrevious: () => { pageNumber -= 1; void render(); },
    onNext: () => { pageNumber += 1; void render(); },
    onZoom: (zoom) => { zoomValue = zoom; void render(); },
  });
  surface.append(toolbar.element, viewportHost);
  container.replaceChildren(surface);
  let pageNumber = 1;
  let revision = 0;
  let previousWidth = 0;
  let previousHeight = 0;
  const render = async () => {
    if (disposed) return;
    const current = ++revision;
    const prior = task;
    prior?.cancel();
    toolbar.setPagination(pageNumber, pdf.numPages, true);
    setChatFilePreviewState(container, 'loading');
    armDeadline();
    try {
      await prior?.promise.catch(() => {});
      const page = await pdf.getPage(pageNumber);
      if (disposed || signal.aborted || current !== revision) return;
      const base = page.getViewport({ scale: 1 });
      const width = Math.max(1, viewportHost.clientWidth - 32 || 720);
      const height = Math.max(1, viewportHost.clientHeight - 32 || 640);
      const density = Math.min(window.devicePixelRatio || 1, 2);
      const fit = zoomValue === 'width' ? width / base.width
        : zoomValue === 'actual' ? 1 : Math.min(width / base.width, height / base.height);
      const scale = Math.min(fit * density, Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height)));
      const viewport = page.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${base.width * fit}px`;
      canvas.style.height = `${base.height * fit}px`;
      task = page.render({ canvas, viewport });
      await task.promise;
      if (disposed || signal.aborted || current !== revision) return;
      // Publish page identity only after its pixels belong to the completed render.
      canvas.setAttribute('aria-label', labels.page(pageNumber, pdf.numPages));
      canvas.dataset.chatRenderedPage = String(pageNumber);
      toolbar.setPagination(pageNumber, pdf.numPages);
      setChatFilePreviewState(container, 'ready');
      clearTimeout(timer);
      page.cleanup();
    } catch {
      if (!signal.aborted && current === revision) {
        dispose();
        setChatFilePreviewUnavailable(container, labels.unavailable);
      }
    }
  };
  resize = new ResizeObserver(() => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if ((width !== previousWidth || height !== previousHeight) && !signal.aborted) {
      previousWidth = width;
      previousHeight = height;
      void render();
    }
  });
  resize.observe(container);
  await render();
}
