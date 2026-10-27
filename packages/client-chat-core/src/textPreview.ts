import { AttachmentByteReader } from './attachmentByteReader.js';
import { setChatFilePreviewState, setChatFilePreviewUnavailable, type ChatFilePreviewLabels } from './previewSurface.js';
import { previewToolbar } from './previewToolbar.js';

const PAGE_BYTES = 32 * 1024;

export async function mountChatTextPreview(
  container: HTMLElement, reader: AttachmentByteReader, labels: ChatFilePreviewLabels,
): Promise<void> {
  const { signal, size } = reader;
  const surface = document.createElement('div');
  surface.className = 'chat-text-preview';
  const text = document.createElement('pre');
  let page = 1;
  const toolbar = previewToolbar({
    labels,
    signal,
    showZoom: false,
    onPrevious: () => { page = Math.max(1, page - 1); void render(); },
    onNext: () => { page += 1; void render(); },
  });
  surface.append(toolbar.element, text);
  container.replaceChildren(surface);
  signal.addEventListener('abort', () => surface.remove(), { once: true });
  const prefix = await reader.read(0, Math.min(3, size));
  signal.throwIfAborted();
  const encoding = prefix[0] === 255 && prefix[1] === 254 ? 'utf-16le'
    : prefix[0] === 254 && prefix[1] === 255 ? 'utf-16be' : 'utf-8';
  const bom = encoding !== 'utf-8' ? 2
    : prefix[0] === 239 && prefix[1] === 187 && prefix[2] === 191 ? 3 : 0;
  const total = Math.max(1, Math.ceil((size - bom) / PAGE_BYTES));
  let revision = 0;
  const render = async () => {
    const current = ++revision;
    toolbar.setPagination(page, total, true);
    setChatFilePreviewState(container, 'loading');
    try {
      const start = bom + (page - 1) * PAGE_BYTES;
      const bytes = await reader.read(start, Math.min(PAGE_BYTES + 4, size - start));
      signal.throwIfAborted();
      if (current !== revision) return;
      let first = 0;
      let end = Math.min(PAGE_BYTES, bytes.length);
      if (encoding === 'utf-8') {
        // The preceding page owns the whole codepoint which straddles a boundary.
        if (page > 1) while (first < bytes.length && (bytes[first] & 192) === 128) first++;
        while (end < bytes.length && (bytes[end] & 192) === 128) end++;
      } else {
        const unit = (offset: number) => encoding === 'utf-16le'
          ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1];
        if (page > 1 && unit(0) >= 0xdc00 && unit(0) <= 0xdfff) first = 2;
        end -= end % 2;
        if (end >= 2 && end + 2 <= bytes.length && unit(end - 2) >= 0xd800 && unit(end - 2) <= 0xdbff) end += 2;
      }
      text.textContent = new TextDecoder(encoding, { ignoreBOM: true }).decode(bytes.subarray(first, end));
      toolbar.setPagination(page, total);
      text.scrollTop = 0;
      setChatFilePreviewState(container, 'ready');
    } catch {
      if (!signal.aborted && current === revision) {
        setChatFilePreviewUnavailable(container, labels.unavailable);
      }
    }
  };
  await render();
}
