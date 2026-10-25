import { admitOfficeArchive, OFFICE_RESOURCE_ERROR } from './officeArchive.js';

const postMessage = (message: unknown, transfer?: Transferable[]) =>
  (globalThis as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void })
    .postMessage(message, transfer);

// Workers never resolve document relationships through network access.
globalThis.fetch = async () => { throw new Error('FILE_DOCUMENT_NETWORK_DISABLED'); };
const pending = new Map<number, (bytes: Uint8Array<ArrayBuffer>) => void>();
let sequence = 0;
const read = (offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> =>
  new Promise((resolve) => {
    const id = ++sequence;
    pending.set(id, resolve);
    postMessage({ type: 'read', id, offset, length });
  });

let workbook: import('xlsx').WorkBook | undefined;
let presentation: import('@web-ppt/core').Presentation | undefined;
let wordPages: { html: string; width: number; height: number }[] = [];
let wordStyles = '';

async function dataUrl(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32 * 1024) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32 * 1024));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

async function renderWord(bytes: Uint8Array<ArrayBuffer>) {
  // A worker-owned inert DOM lets the existing SDK decode without occupying
  // the WebView thread. Terminating this worker also terminates Word parsing.
  const { parseHTML } = await import('linkedom');
  const { DOMParser: XmlParser, XMLSerializer } = await import('@xmldom/xmldom');
  const { document, Node } = parseHTML('<html><head></head><body></body></html>');
  Object.assign(globalThis, {
    document, Node, XMLSerializer,
    DOMParser: class {
      parseFromString(source: string, mime: string) {
        const xml = new XmlParser().parseFromString(source, mime as 'application/xml');
        Object.defineProperty(xml, 'firstElementChild', { value: xml.documentElement });
        return xml;
      }
    },
  });
  const { parseAsync, renderDocument } = await import('docx-preview');
  const body = document.createElement('div');
  const styles = document.createElement('div');
  const options = {
    ignoreFonts: true, ignoreWidth: false, ignoreHeight: false, useBase64URL: false,
    renderAltChunks: false, renderComments: false, renderChanges: false,
    className: 'chat-word', inWrapper: false, breakPages: true, experimental: false,
  };
  const word = await parseAsync(bytes, options);
  for (const numbering of word.numberingPart?.domNumberings ?? []) {
    // Word's Symbol bullet is a private-use glyph. The preview deliberately
    // excludes embedded fonts, so render its Unicode equivalent instead.
    if (numbering.format === 'bullet' && numbering.levelText === '\uf0b7') {
      numbering.levelText = '•';
      delete numbering.rStyle?.['font-family'];
    }
  }
  for (const node of await renderDocument(word, options)) {
    (node.nodeName === 'STYLE' ? styles : body).appendChild(node);
  }
  for (const image of body.querySelectorAll('img')) {
    const url = image.getAttribute('src') || '';
    const blob = ownedBlobs.get(url);
    if (blob) image.setAttribute('src', await dataUrl(blob));
    else image.removeAttribute('src');
  }
  wordPages = Array.from(body.querySelectorAll('section'), (page) => {
    const width = Number.parseFloat(page.style.width);
    const height = Number.parseFloat(page.style.minHeight);
    if (!(width > 0 && height > 0)) throw new Error('FILE_DOCUMENT_INVALID');
    return { html: page.outerHTML, width: width * 4 / 3, height: height * 4 / 3 };
  });
  wordStyles = styles.innerHTML;
  // Numbering images may appear in SDK-owned CSS as well as img elements.
  for (const [url, blob] of ownedBlobs) {
    const inline = await dataUrl(blob);
    wordStyles = wordStyles.replaceAll(url, inline);
    wordPages = wordPages.map((page) => ({ ...page, html: page.html.replaceAll(url, inline) }));
  }
  if (wordPages.length > 512) throw new Error(OFFICE_RESOURCE_ERROR);
  body.replaceChildren();
  styles.replaceChildren();
  for (const url of ownedBlobs.keys()) URL.revokeObjectURL(url);
  postMessage({ type: 'document', total: wordPages.length });
}

async function boundedBinary(size: number) {
  // Legacy CFB parsers require a contiguous input; this is their working memory budget.
  if (size > 64 * 1024 * 1024) throw new Error(OFFICE_RESOURCE_ERROR);
  const bytes = new Uint8Array(size);
  for (let offset = 0; offset < size; offset += 1024 * 1024) {
    bytes.set(await read(offset, Math.min(1024 * 1024, size - offset)), offset);
  }
  return bytes;
}

async function run(message: { type: string; size: number; extension: string; sheet?: string; page?: number; columnPage?: number; revision?: number }) {
  if (message.type === 'load') {
    const signature = await read(0, Math.min(message.size, 8));
    const zip = signature[0] === 0x50 && signature[1] === 0x4b;
    const cfb = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
      .every((byte, index) => signature[index] === byte);
    if (!zip && !cfb) throw new Error('FILE_DOCUMENT_INVALID');
    // Legacy SDKs also autodetect OOXML; renamed ZIPs need archive admission.
    const bytes = zip ? await admitOfficeArchive(message.size, read)
      : await boundedBinary(message.size);
    if (message.extension === 'docx') {
      await renderWord(bytes);
    } else if (/^xlsx?$/.test(message.extension)) {
      const XLSX = await import('xlsx');
      workbook = XLSX.read(bytes, {
        cellHTML: false, cellStyles: true, bookVBA: false,
        bookDeps: false, bookFiles: false, cellFormula: false,
      });
      let cells = 0;
      for (const sheet of Object.values(workbook.Sheets)) {
        cells += Object.keys(sheet).filter((key) => !key.startsWith('!')).length;
        if (cells > 100_000) throw new Error(OFFICE_RESOURCE_ERROR);
      }
      postMessage({ type: 'workbook', sheets: workbook.SheetNames });
    } else {
      const { parse } = await import('@web-ppt/core');
      presentation = await parse(bytes, { lazy: false });
      if (presentation.slides.length > 512) throw new Error(OFFICE_RESOURCE_ERROR);
      // Inline only parser-owned blobs; rendered frames cannot request outside resources.
      let nodes = 0;
      async function inert(value: unknown): Promise<void> {
        if (!value || typeof value !== 'object') return;
        if (++nodes > 100_000) throw new Error(OFFICE_RESOURCE_ERROR);
        for (const [key, child] of Object.entries(value)) {
          if ((key === 'src' || key === 'bulletImage') && typeof child === 'string') {
            if (child.startsWith('blob:')) {
              // The parser's URL is converted by its owned Blob registry below.
              const blob = ownedBlobs.get(child);
              if (!blob) throw new Error('FILE_DOCUMENT_INVALID');
              (value as Record<string, unknown>)[key] = await dataUrl(blob);
            } else if (!child.startsWith('data:image/')) {
              (value as Record<string, unknown>)[key] = '';
            }
          } else if (key === 'link') {
            delete (value as Record<string, unknown>)[key];
          } else await inert(child);
        }
      }
      await inert(presentation);
      presentation.dispose?.();
      postMessage({ type: 'presentation', total: presentation.slides.length });
    }
  } else if (message.type === 'page' && message.page && wordPages[message.page - 1]) {
    const { html, width, height } = wordPages[message.page - 1];
    postMessage({ type: 'page', page: message.page, revision: message.revision, html: wordStyles + html, width, height });
  } else if (message.type === 'slide' && presentation && message.page
    && message.page >= 1 && message.page <= presentation.slides.length) {
    const { renderSlideToSvg } = await import('@web-ppt/core');
    postMessage({ type: 'slide', page: message.page, revision: message.revision, width: presentation.width, height: presentation.height, svg: renderSlideToSvg(
      presentation, presentation.slides[message.page - 1], { textMode: 'svg', media: 'badge' },
    ) });
  } else if (message.type === 'sheet' && workbook && message.sheet && workbook.Sheets[message.sheet]) {
    const XLSX = await import('xlsx');
    const sheet = workbook.Sheets[message.sheet];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    const total = Math.max(1, Math.ceil((range.e.r - range.s.r + 1) / 100));
    const columnTotal = Math.max(1, Math.ceil((range.e.c - range.s.c + 1) / 20));
    const page = Math.min(Math.max(message.page || 1, 1), total);
    const columnPage = Math.min(Math.max(message.columnPage || 1, 1), columnTotal);
    const row = range.s.r + (page - 1) * 100;
    const column = range.s.c + (columnPage - 1) * 20;
    const lastRow = Math.min(row + 99, range.e.r);
    const lastColumn = Math.min(column + 19, range.e.c);
    const merges = (sheet['!merges'] || []).filter((merge) =>
      merge.e.r >= row && merge.s.r <= lastRow && merge.e.c >= column && merge.s.c <= lastColumn);
    const rows = [];
    for (let r = row; r <= Math.min(row + 99, range.e.r); r++) {
      const cells = [];
      for (let c = column; c <= Math.min(column + 19, range.e.c); c++) {
        const merge = merges.find((value) => value.s.r <= r && value.e.r >= r && value.s.c <= c && value.e.c >= c);
        if (merge && (r !== Math.max(row, merge.s.r) || c !== Math.max(column, merge.s.c))) continue;
        const position = merge ? merge.s : { r, c };
        const cell = sheet[XLSX.utils.encode_cell(position)];
        cells.push({
          text: cell ? XLSX.utils.format_cell(cell) : '',
          address: XLSX.utils.encode_cell(position),
          rowSpan: merge ? Math.min(lastRow, merge.e.r) - r + 1 : 1,
          colSpan: merge ? Math.min(lastColumn, merge.e.c) - c + 1 : 1,
          numeric: cell?.t === 'n',
        });
      }
      rows.push({ number: r + 1, cells });
    }
    postMessage({ type: 'rows', rows, total, sheet: message.sheet, page, columnPage, columnTotal,
      range: XLSX.utils.encode_range({ s: { r: row, c: column }, e: { r: lastRow, c: lastColumn } }),
      columns: Array.from({ length: lastColumn - column + 1 }, (_, index) => XLSX.utils.encode_col(column + index)),
      columnWidths: Array.from({ length: lastColumn - column + 1 }, (_, index) => {
        const width = sheet['!cols']?.[column + index];
        return Math.min(320, Math.max(96, width?.wpx ?? (width?.wch ? width.wch * 7 + 12 : 96)));
      }),
    });
  }
}

const ownedBlobs = new Map<string, Blob>();
const createBlobUrl = URL.createObjectURL.bind(URL);
const revokeBlobUrl = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (blob: Blob | MediaSource) => {
  const url = createBlobUrl(blob);
  if (blob instanceof Blob) ownedBlobs.set(url, blob);
  return url;
};
URL.revokeObjectURL = (url: string) => { ownedBlobs.delete(url); revokeBlobUrl(url); };

globalThis.onmessage = (event: MessageEvent) => {
  if (event.data.type === 'bytes') {
    pending.get(event.data.id)?.(event.data.bytes);
    pending.delete(event.data.id);
    return;
  }
  void run(event.data).catch((error: unknown) => {
    postMessage({ type: 'error', code: error instanceof Error ? error.message : 'FILE_PREVIEW_UNAVAILABLE' });
  });
};
