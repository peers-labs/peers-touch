import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';
import { ZipReader, ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js/lib/zip-core-native.js';
import { AttachmentByteReader } from '../dist/attachmentByteReader.js';
import { mountChatTextPreview } from '../dist/textPreview.js';

const { document, window } = parseHTML('<html><head></head><body></body></html>');
Object.assign(globalThis, { document, window });
const labels = {
  preparing: 'Preparing', unavailable: 'Unavailable', resourceUnavailable: 'Resource unavailable',
  previousPage: 'Previous', nextPage: 'Next', page: (page, total) => `${page}/${total}`,
  zoom: 'Zoom', fitWidth: 'Width', fitPage: 'Page', actualSize: 'Actual',
};
const url = 'http://chat-file.localhost/01ARZ3NDEKTSV4RRFFQ69G5FAV';
const text = 'a'.repeat(32768) + '\ufeff😀tail';
const bytes = new TextEncoder().encode(text);
globalThis.fetch = async (_url, request) => {
  const [, a, b] = /bytes=(\d+)-(\d+)/.exec(request.headers.Range);
  return new Response(bytes.subarray(+a, +b + 1), {
    status: 206, headers: { 'content-range': `bytes ${a}-${b}/${bytes.length}` },
  });
};
const container = document.createElement('div');
const abort = new AbortController();
await mountChatTextPreview(container, new AttachmentByteReader(url, bytes.length, abort.signal), labels);
const pageOne = container.querySelector('pre').textContent;
container.querySelectorAll('button')[1].dispatchEvent(new window.Event('click'));
for (let i = 0; container.dataset.chatPreviewState === 'loading' && i < 100; i++) {
  await new Promise(resolve => setImmediate(resolve));
}
assert.equal(pageOne + container.querySelector('pre').textContent, text);
abort.abort();

const queue = [];
let response;
let input;
globalThis.postMessage = message => {
  if (message.type === 'read') {
    queueMicrotask(() => globalThis.onmessage({ data: {
      type: 'bytes', id: message.id, bytes: input.slice(message.offset, message.offset + message.length),
    } }));
  } else if (response) { const done = response; response = undefined; done(message); }
  else queue.push(message);
};
const receive = () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Office worker response timeout')), 5000);
  response = value => { clearTimeout(timeout); resolve(value); };
});
await import('../dist/officeWorker.js');
const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
const parts = {
  '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="bmp" ContentType="image/bmp"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Landscape page</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="16840" w:h="11900" w:orient="landscape"/></w:sectPr></w:body></w:document>',
};
const bmp = new Uint8Array(58);
const view = new DataView(bmp.buffer);
bmp.set([0x42, 0x4d]);
for (const [offset, value] of [[2, 58], [10, 54], [14, 40], [18, 1], [22, 1], [34, 4]]) view.setUint32(offset, value, true);
view.setUint16(26, 1, true); view.setUint16(28, 24, true);
bmp.set([0, 0, 255, 0], 54);
parts['word/media/image1.bmp'] = bmp;
for (const [name, content] of Object.entries(parts)) {
  await writer.add(name, new Uint8ArrayReader(typeof content === 'string' ? new TextEncoder().encode(content) : content), { level: 0 });
}
input = new Uint8Array(await writer.close());
const { admitOfficeArchive } = await import('../dist/officeArchive.js');
const admitted = await admitOfficeArchive(input.length, async (offset, length) => input.slice(offset, offset + length));
const reader = new ZipReader(new Uint8ArrayReader(admitted), { useWebWorkers: false });
assert.ok((await reader.getEntries()).some(entry => entry.filename === 'word/media/image1.bmp'));
await reader.close();
globalThis.onmessage({ data: { type: 'load', extension: 'docx', size: input.length } });
assert.equal((await receive()).type, 'document');
globalThis.onmessage({ data: { type: 'page', page: 1, revision: 1 } });
const page = await receive();
assert.equal(page.width, 842 * 4 / 3);
assert.equal(page.height, 595 * 4 / 3);

const disguised = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
await disguised.add('xl/unused.xml', new Uint8ArrayReader(
  new TextEncoder().encode(' '.repeat(9 * 1024 * 1024))), { level: 9 });
input = new Uint8Array(await disguised.close());
for (const extension of ['xls', 'ppt']) {
  globalThis.onmessage({ data: { type: 'load', extension, size: input.length } });
  assert.deepEqual(await receive(), { type: 'error', code: 'FILE_PREVIEW_RESOURCE_UNAVAILABLE' });
}

// Exercise the PDF adapter's raster budget separately from logical page size.
let pdf = fs.readFileSync(new URL('../dist/pdfPreview.js', import.meta.url), 'utf8');
pdf = pdf.replace(/^import .*pdfjs-dist.*$/gm, '').replace(/from '(\.\/[^']+)'/g,
  (_, name) => `from '${new URL('../dist/' + name.slice(2), import.meta.url).href}'`);
pdf = `const workerUrl='worker'; const GlobalWorkerOptions={};
class PDFDataRangeTransport{onDataRange(offset, bytes){globalThis.__pdfPieces.push({offset,bytes});}}
const getDocument=options=>{globalThis.__pdfTransport=options.range;return globalThis.__pdf;};
${pdf}`;
Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
  configurable: true, get() { return this.selected || ''; }, set(value) { this.selected = value; },
});
Object.defineProperties(window.HTMLElement.prototype, {
  clientWidth: { configurable: true, get: () => 800 }, clientHeight: { configurable: true, get: () => 640 },
});
window.devicePixelRatio = 2;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.__pdfPieces = [];
globalThis.__pdf = { promise: Promise.resolve({ numPages: 1, getPage: async () => ({
  getViewport: ({ scale }) => ({ width: 1191 * scale, height: 1684 * scale }),
  render: () => ({ promise: Promise.resolve(), cancel() {} }), cleanup() {},
}) }), destroy: async () => {} };
globalThis.fetch = async () => new Response(new Uint8Array(100), {
  status: 206, headers: { 'content-range': 'bytes 0-99/100' },
});
const { mountChatPdfPreview } = await import('data:text/javascript;base64,' + Buffer.from(pdf).toString('base64'));
const surface = document.createElement('div');
const pdfAbort = new AbortController();
await mountChatPdfPreview(surface, url, 100, labels, pdfAbort.signal);
const select = surface.querySelector('select');
select.value = 'actual'; select.dispatchEvent(new window.Event('change'));
for (let i = 0; surface.dataset.chatPreviewState === 'loading' && i < 100; i++) await new Promise(resolve => setImmediate(resolve));
const canvas = surface.querySelector('canvas');
assert.equal(canvas.style.width, '1191px');
assert.equal(canvas.style.height, '1684px');
assert.ok(canvas.width * canvas.height <= 4 * 1024 * 1024);
pdfAbort.abort();

const demandSize = 12 * 1024 * 1024;
const demandReads = [];
globalThis.fetch = async (_url, request) => {
  const [, start, end] = /bytes=(\d+)-(\d+)/.exec(request.headers.Range);
  demandReads.push({ start: +start, end: +end });
  return new Response(new Uint8Array(+end - +start + 1).fill((+start / 262144) % 256), {
    status: 206, headers: { 'content-range': `bytes ${start}-${end}/${demandSize}` },
  });
};
const demandAbort = new AbortController();
await mountChatPdfPreview(document.createElement('div'), url, demandSize, labels, demandAbort.signal);
const begin = 262144, end = begin + 9 * 1024 * 1024;
globalThis.__pdfTransport.requestDataRange(begin, end);
for (let i = 0; globalThis.__pdfPieces.length < 1 && i < 100; i++) await new Promise(resolve => setImmediate(resolve));
assert.equal(globalThis.__pdfPieces.length, 1);
assert.ok(demandReads.every(read => read.end - read.start + 1 <= 1024 * 1024));
assert.equal(globalThis.__pdfPieces.reduce((sum, piece) => sum + piece.bytes.length, 0), end - begin);
const piece = globalThis.__pdfPieces[0];
assert.equal(piece.offset, begin);
for (let offset = 0; offset < piece.bytes.length; offset += 1024 * 1024) {
  assert.equal(piece.bytes[offset], ((begin + offset) / 262144) % 256);
}
demandAbort.abort();

// Use the installed transport and worker to demand a real 9 MiB content stream.
// Pixel rendering is covered separately by the Native journey.
const sdk = await import('pdfjs-dist/legacy/build/pdf.mjs');
globalThis.__sdkTransport = sdk.PDFDataRangeTransport;
const stream = 'BT /F1 12 Tf 40 700 Td (Coalesced range verified) Tj ET\n' + ' '.repeat(9 * 1024 * 1024);
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
];
let source = '%PDF-1.4\n';
const offsets = [0];
for (const [index, object] of objects.entries()) {
  offsets.push(source.length);
  source += `${index + 1} 0 obj\n${object}\nendobj\n`;
}
const xref = source.length;
source += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
for (const offset of offsets.slice(1)) source += `${String(offset).padStart(10, '0')} 00000 n \n`;
source += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const realBytes = new TextEncoder().encode(source);
const realReads = [];
globalThis.fetch = async (_url, request) => {
  const [, a, b] = /bytes=(\d+)-(\d+)/.exec(request.headers.Range);
  realReads.push(+b - +a + 1);
  return new Response(realBytes.slice(+a, +b + 1), {
    status: 206, headers: { 'content-range': `bytes ${a}-${b}/${realBytes.length}` },
  });
};
globalThis.__realGetDocument = options => {
  sdk.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const loading = sdk.getDocument(options);
  return { destroy: () => loading.destroy(), promise: loading.promise.then(doc => ({
    numPages: doc.numPages,
    getPage: async number => {
      const page = await doc.getPage(number);
      return {
        getViewport: options => page.getViewport(options),
        cleanup: () => page.cleanup(),
        render: () => ({ promise: page.getOperatorList(), cancel() {} }),
      };
    },
  })) };
};
const realAdapter = pdf.replace(
  /class PDFDataRangeTransport\{.*\}/, 'const PDFDataRangeTransport=globalThis.__sdkTransport;',
).replace(/const getDocument=options=>.*;/, 'const getDocument=globalThis.__realGetDocument;');
const realMount = (await import('data:text/javascript;base64,' + Buffer.from(realAdapter).toString('base64'))).mountChatPdfPreview;
const realSurface = document.createElement('div');
const realAbort = new AbortController();
await realMount(realSurface, url, realBytes.length, labels, realAbort.signal);
assert.equal(realSurface.dataset.chatPreviewState, 'ready');
assert.ok(realReads.length > 8 && realReads.every(length => length <= 1024 * 1024));
realAbort.abort();
process.stdout.write('Preview regression checks passed: text fidelity, BMP, landscape, PDF size/ranges, renamed Office limits\n');
