import { Reader, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js/lib/zip-core-native.js';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { imageSize } from 'image-size';

const MAX_ENTRIES = 4096;
const MAX_DECODED = 64 * 1024 * 1024;
const MAX_XML = 8 * 1024 * 1024;
const MAX_NODES = 100_000;
export const OFFICE_RESOURCE_ERROR = 'FILE_PREVIEW_RESOURCE_UNAVAILABLE';

export type ReadOfficeRange = (offset: number, length: number) => Promise<Uint8Array<ArrayBuffer>>;

/** ZIP directory and selected inert parts are admitted before inflation. */
export async function admitOfficeArchive(size: number, read: ReadOfficeRange): Promise<Uint8Array<ArrayBuffer>> {
  class GrantReader extends Reader<Uint8Array> {
    constructor() { super(new Uint8Array(0)); this.size = size; }
    async readUint8Array(offset: number, length: number) {
      if (length > 8 * 1024 * 1024) throw new Error(OFFICE_RESOURCE_ERROR);
      return read(offset, length);
    }
  }
  class PartWriter extends Uint8ArrayWriter {
    private written = 0;
    constructor(private readonly limit: number) { super(); }
    async init(size = 0) {
      if (size > this.limit) throw new Error(OFFICE_RESOURCE_ERROR);
      await super.init?.(size);
    }
    async writeUint8Array(bytes: Uint8Array<ArrayBuffer>) {
      this.written += bytes.length;
      if (this.written > this.limit) throw new Error(OFFICE_RESOURCE_ERROR);
      await super.writeUint8Array(bytes);
    }
  }
  const source = new ZipReader(new GrantReader(), { useWebWorkers: false });
  const target = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false, dataDescriptor: false, bufferedWrite: true,
  });
  let count = 0;
  let decoded = 0;
  let nodes = 0;
  const names = new Set<string>();
  try {
    const admitted = [];
    for await (const entry of source.getEntriesGenerator()) {
      if (++count > MAX_ENTRIES) throw new Error(OFFICE_RESOURCE_ERROR);
      const name = entry.filename;
      if (entry.encrypted || name.startsWith('/') || name.includes('\\')
        || name.split('/').includes('..') || names.has(name)) throw new Error('FILE_ARCHIVE_INVALID');
      names.add(name);
      if (entry.directory || !/^(\[Content_Types\]\.xml|_rels\/\.rels|(?:word|xl|ppt)\/.*)$/i.test(name)) continue;
      // Macros, embedded objects, HTML altChunks, SVG and fonts never reach a renderer.
      if (!/\.(xml|rels|png|jpe?g|gif|webp|bmp)$/i.test(name)
        || /\/(embeddings|activeX|fonts)\//i.test(name)) continue;
      decoded += entry.uncompressedSize;
      if (!Number.isSafeInteger(decoded) || decoded > MAX_DECODED
        || entry.uncompressedSize > (/\.(xml|rels)$/i.test(name) ? MAX_XML : 16 * 1024 * 1024)) {
        throw new Error(OFFICE_RESOURCE_ERROR);
      }
      admitted.push(entry);
    }
    for (const entry of admitted) {
      let bytes = await entry.getData!(new PartWriter(entry.uncompressedSize), {
        checkSignature: true, useWebWorkers: false,
      });
      if (bytes.length !== entry.uncompressedSize) throw new Error('FILE_ARCHIVE_INVALID');
      if (/\.(xml|rels)$/i.test(entry.filename)) {
        const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('FILE_DOCUMENT_INVALID');
        const document = new DOMParser({
          onError: (level) => { if (level !== 'warning') throw new Error('FILE_DOCUMENT_INVALID'); },
        }).parseFromString(xml, 'application/xml');
        const elements = Array.from(document.getElementsByTagName('*'));
        nodes += elements.length;
        if (nodes > MAX_NODES) throw new Error(OFFICE_RESOURCE_ERROR);
        for (const element of elements) {
          if (element.localName === 'Relationship') {
            const destination = element.getAttribute('Target') || '';
            if (element.getAttribute('TargetMode') === 'External'
              || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(destination)) {
              element.parentNode?.removeChild(element);
            }
          }
          if (['altChunk', 'attachedTemplate', 'object', 'control'].includes(element.localName || '')) {
            element.parentNode?.removeChild(element);
          }
        }
        bytes = new TextEncoder().encode(new XMLSerializer().serializeToString(document));
      } else {
        // Bitmap dimensions are inspected before the document decoder can use them.
        const dimensions = imageSize(bytes);
        const pixels = dimensions.width * dimensions.height;
        if (pixels > 4 * 1024 * 1024) throw new Error(OFFICE_RESOURCE_ERROR);
      }
      await target.add(entry.filename, new Uint8ArrayReader(bytes), { level: 0 });
    }
    return new Uint8Array(await target.close());
  } finally {
    await source.close();
  }
}
