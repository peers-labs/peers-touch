import DOMPurify from 'dompurify';
import { AttachmentByteReader } from './attachmentByteReader.js';
import { previewNavigation } from './previewNavigation.js';
import { setChatFilePreviewState, setChatFilePreviewUnavailable, type ChatFilePreviewLabels } from './previewSurface.js';
import { workbookTable } from './workbookTable.js';

const FRAME_POLICY = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; base-uri 'none'; form-action 'none'";

function documentFrame(content: string, filename: string, scale: number, dimensions: {
  width: number; height: number; slide: boolean;
}): HTMLIFrameElement {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', '');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.title = filename;
  frame.className = 'chat-office-frame';
  const fragment = DOMPurify.sanitize(content, {
    FORCE_BODY: true,
    RETURN_DOM_FRAGMENT: true,
    ADD_TAGS: ['style'], FORBID_TAGS: ['a', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'video', 'audio'],
    FORBID_ATTR: ['action', 'formaction'],
  });
  // SVG image references belong to the local slide. Keep only inert image data
  // and fragment references; removing every href also removes actual pictures.
  for (const node of fragment.querySelectorAll('*')) {
    for (const attribute of ['href', 'xlink:href', 'src']) {
      const value = node.getAttribute(attribute);
      if (value !== null && !(value.startsWith('#') || (
        ['img', 'image'].includes(node.localName)
        && /^data:image\/(?:png|jpeg|gif|webp|bmp|avif);base64,/i.test(value)
      ))) node.removeAttribute(attribute);
    }
  }
  const safe = document.createElement('div');
  safe.append(fragment);
  const rendered = dimensions.slide ? safe.innerHTML : `<div class="chat-word-page">${safe.innerHTML}</div>`;
  // Transform the fixed layout; CSS zoom can reflow small text in WKWebView
  // and make a supposedly fitted page extend below its viewport.
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}"><style>html,body{margin:0;background:#f5f5f5;color:#171717}body{padding:16px;overflow:auto;box-sizing:border-box}img,svg{max-width:100%;height:auto}section{box-sizing:border-box;background:white;border:1px solid #dedede}body>svg{display:block;margin:auto;background:white;border:1px solid #dedede}.chat-word-page{position:relative;margin:auto;width:${dimensions.width * scale}px;height:${dimensions.height * scale}px}.chat-word-page>section{position:absolute;top:0;left:0;transform:scale(${scale});transform-origin:top left}body>svg{width:${dimensions.width * scale}px}</style>${rendered}`;
  return frame;
}

/** Local SDK objects and workers are owned by this one selected mount. */
export async function mountChatOfficePreview(
  container: HTMLElement, reader: AttachmentByteReader, filename: string, labels: ChatFilePreviewLabels,
): Promise<void> {
  const extension = filename.split('.').pop()?.toLowerCase() || '';
  if (!/^(docx|xlsx?|pptx?)$/.test(extension)) {
    setChatFilePreviewUnavailable(container, labels.unavailable);
    return;
  }
  const { signal } = reader;
  signal.throwIfAborted();
  const reads = new AbortController();
  const localReader = new AttachmentByteReader(reader.url, reader.size, reads.signal);
  const worker = new Worker(new URL('./officeWorker.ts', import.meta.url), { type: 'module' });
  let disposed = false;
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resize: ResizeObserver | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    reads.abort();
    worker.terminate();
    worker.onmessage = worker.onerror = null;
    clearTimeout(timer);
    resize?.disconnect();
    signal.removeEventListener('abort', dispose);
    renderPage = undefined;
    container.querySelectorAll('iframe').forEach((frame) => { frame.srcdoc = ''; frame.remove(); });
    container.replaceChildren();
    body.replaceChildren();
  };
  const fail = (resource = false) => {
    if (disposed) return;
    dispose();
    if (!signal.aborted) setChatFilePreviewUnavailable(container, resource ? labels.resourceUnavailable : labels.unavailable);
  };
  const preparing = () => {
    revision++;
    setChatFilePreviewState(container, 'loading');
  };
  signal.addEventListener('abort', dispose, { once: true });
  const armDeadline = () => {
    clearTimeout(timer);
    timer = setTimeout(() => fail(true), 30_000);
  };
  const navigation = previewNavigation(labels, signal);
  const surface = document.createElement('div');
  surface.className = 'chat-office-preview';
  const body = document.createElement('div');
  body.className = 'chat-office-content';
  surface.append(navigation.element, body);
  let page = 1;
  let total = 1;
  let columnPage = 1;
  let columnTotal = 1;
  const columns = previewNavigation({
    ...labels, previousPage: labels.previousColumns, nextPage: labels.nextColumns, page: labels.columns,
  }, signal);
  let sheet = '';
  let renderPage: (() => void) | undefined;
  let wordZoom: HTMLSelectElement | undefined;
  navigation.previous.addEventListener('click', () => { page--; renderPage?.(); }, { signal });
  navigation.next.addEventListener('click', () => { page++; renderPage?.(); }, { signal });
  worker.onerror = () => fail();
  worker.onmessage = (event: MessageEvent) => {
    const message = event.data;
    if (disposed || signal.aborted) return;
    if (message.type === 'read') {
      void localReader.read(message.offset, message.length).then((bytes) => {
        if (!disposed) worker.postMessage({ type: 'bytes', id: message.id, bytes }, [bytes.buffer]);
      }).catch(() => fail());
      return;
    }
    if (message.type === 'error') { fail(message.code === 'FILE_PREVIEW_RESOURCE_UNAVAILABLE'); return; }
    container.replaceChildren(surface);
    if (message.type === 'document' || message.type === 'presentation') {
      total = message.total;
      if (!total) { fail(); return; }
      const request = message.type === 'document' ? 'page' : 'slide';
      if (message.type === 'document') {
        wordZoom = document.createElement('select');
        wordZoom.setAttribute('aria-label', labels.zoom);
        for (const [value, label] of [['width', labels.fitWidth], ['page', labels.fitPage], ['actual', labels.actualSize]]) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          wordZoom.append(option);
        }
        navigation.element.prepend(wordZoom);
        wordZoom.addEventListener('change', () => renderPage?.(), { signal });
      }
      renderPage = () => {
        preparing();
        navigation.update(page, total, true);
        armDeadline();
        worker.postMessage({ type: request, page, revision });
      };
      renderPage();
    } else if ((message.type === 'page' || message.type === 'slide') && message.page === page && message.revision === revision) {
      const current = revision;
      const width = Number(message.width) || 816;
      const height = Number(message.height) || 1056;
      const fit = Math.max(0.1, (body.clientWidth - 32) / width);
      const scale = wordZoom?.value === 'width' ? fit
        : wordZoom?.value === 'page' || message.type === 'slide'
          ? Math.min(fit, Math.max(0.1, (body.clientHeight - 32) / height)) : 1;
      const frame = documentFrame(message.html ?? message.svg, filename, scale, {
        width, height, slide: message.type === 'slide',
      });
      frame.addEventListener('load', () => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (disposed || signal.aborted || current !== revision) return;
          frame.dataset.chatRenderedPage = String(page);
          navigation.update(page, total);
          setChatFilePreviewState(container, 'ready');
          clearTimeout(timer);
        }));
      }, { once: true, signal });
      body.replaceChildren(frame);
    } else if (message.type === 'workbook') {
      const select = document.createElement('select');
      select.setAttribute('aria-label', labels.sheet);
      for (const name of message.sheets as string[]) {
        const option = document.createElement('option');
        option.textContent = option.value = name;
        select.append(option);
      }
      navigation.element.prepend(select);
      surface.insertBefore(columns.element, body);
      columns.previous.addEventListener('click', () => { columnPage--; renderPage?.(); }, { signal });
      columns.next.addEventListener('click', () => { columnPage++; renderPage?.(); }, { signal });
      sheet = message.sheets[0];
      if (!sheet) { fail(); return; }
      renderPage = () => {
        preparing();
        navigation.update(page, total, true);
        columns.update(columnPage, columnTotal, true);
        armDeadline();
        worker.postMessage({ type: 'sheet', sheet, page, columnPage });
      };
      select.addEventListener('change', () => { sheet = select.value; page = columnPage = 1; renderPage?.(); }, { signal });
      renderPage();
    } else if (message.type === 'rows' && message.sheet === sheet && message.page === page && message.columnPage === columnPage) {
      clearTimeout(timer);
      total = message.total;
      columnTotal = message.columnTotal;
      const table = workbookTable(message, labels);
      body.replaceChildren(table);
      body.scrollTop = body.scrollLeft = 0;
      navigation.update(page, total);
      columns.update(columnPage, columnTotal);
      setChatFilePreviewState(container, 'ready');
    }
  };
  let lastWidth = 0;
  let lastHeight = 0;
  resize = new ResizeObserver(() => {
    const { clientWidth: width, clientHeight: height } = body;
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    if (wordZoom || /^(pptx?)$/.test(extension)) renderPage?.();
  });
  resize.observe(body);
  armDeadline();
  worker.postMessage({ type: 'load', extension, size: reader.size });
}
