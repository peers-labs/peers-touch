/** Only a selected Runtime grant is accepted; every read checks Range identity. */
export class AttachmentByteReader {
  constructor(
    readonly url: string,
    readonly size: number,
    readonly signal: AbortSignal,
  ) {
    const asset = new URL(url);
    if (!['chat-file:', 'http:', 'https:'].includes(asset.protocol)
      || (asset.protocol !== 'chat-file:' && asset.hostname !== 'chat-file.localhost')
      || asset.username || asset.password || asset.search || asset.hash
      || !/^\/[0-9A-HJKMNP-TV-Z]{26}$/.test(asset.pathname)
      || !Number.isSafeInteger(size) || size < 0) throw new Error('FILE_ASSET_INVALID');
  }

  async read(start: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
    this.signal.throwIfAborted();
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length)
      || start < 0 || length < 0 || start + length > this.size || length > 8 * 1024 * 1024) {
      throw new Error('FILE_RANGE_INVALID');
    }
    if (!length) return new Uint8Array(0);
    const end = start + length - 1;
    const response = await fetch(this.url, {
      headers: { Range: `bytes=${start}-${end}` }, cache: 'no-store',
      redirect: 'error', signal: this.signal,
    });
    if (response.status !== 206
      || response.headers.get('content-range') !== `bytes ${start}-${end}/${this.size}`) {
      await response.body?.cancel();
      throw new Error('FILE_RANGE_IDENTITY_MISMATCH');
    }
    // A dishonest/stale response must not allocate an unbounded arrayBuffer.
    const body = response.body?.getReader();
    if (!body) throw new Error('FILE_PREVIEW_INCOMPLETE');
    const result = new Uint8Array(length);
    let offset = 0;
    try {
      for (;;) {
        const { done, value } = await body.read();
        this.signal.throwIfAborted();
        if (done) break;
        if (offset + value.length > length) throw new Error('FILE_PREVIEW_INCOMPLETE');
        result.set(value, offset);
        offset += value.length;
      }
    } finally {
      await body.cancel().catch(() => {});
      body.releaseLock();
    }
    if (offset !== length) throw new Error('FILE_PREVIEW_INCOMPLETE');
    return result;
  }
}
