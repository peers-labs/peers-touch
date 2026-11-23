/**
 * In-memory, attachment-scoped object URL cache for chat images.
 *
 * Why this exists: every attachment grant mints a fresh handle and therefore
 * a fresh asset URL, and the native asset response carries
 * `cache-control: no-store`. The plaintext bytes already live in the native
 * cache (decryption happens once at download), but the WebView can neither
 * reuse the old URL nor HTTP-cache the bytes, so re-opening a conversation
 * re-fetches and re-decodes every image. Holding one stable object URL per
 * attachment inside the WebView restores instant re-display — the same
 * technique Cordova apps use for local media — without touching the native
 * grant/release security model.
 *
 * The cache holds already-decrypted plaintext that the WebView had already
 * received for rendering, so it adds no new plaintext exposure. It is bounded
 * by entry count and a byte budget, and object URLs are revoked on eviction.
 */

const MAX_ENTRIES = 24;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

interface CacheEntry {
  readonly url: string;
  readonly bytes: number;
  /** True for data: URLs, which must not be revoked. */
  readonly revocable: boolean;
}

interface UrlFactory {
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
}

type DataUrlReader = (blob: Blob) => Promise<string>;

const defaultFactory: UrlFactory = {
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
};

const defaultDataUrlReader: DataUrlReader = readBlobAsDataUrl;

/** Mirrors the platform split already used by MomentImage: Android WebView
    needs data: URLs, other platforms can use blob: object URLs. */
export function chatImageRequiresDataUrl(userAgent: string): boolean {
  return /\bAndroid\b/i.test(userAgent);
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('chat image data url failed'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('chat image data url failed'));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
}

export class ChatImageObjectUrlCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<string | null>>();
  private totalBytes = 0;

  constructor(
    private readonly factory: UrlFactory = defaultFactory,
    private readonly maxEntries: number = MAX_ENTRIES,
    private readonly maxTotalBytes: number = MAX_TOTAL_BYTES,
    private readonly readDataUrl: DataUrlReader = defaultDataUrlReader,
  ) {}

  get(attachmentId: string): string | null {
    const entry = this.entries.get(attachmentId);
    if (!entry) return null;
    // Refresh LRU recency on read.
    this.entries.delete(attachmentId);
    this.entries.set(attachmentId, entry);
    return entry.url;
  }

  has(attachmentId: string): boolean {
    return this.entries.has(attachmentId);
  }

  /**
   * Ensure a stable object URL exists for an attachment. Resolves to the
   * cached URL on a cache hit, or primes it from the (ephemeral) asset URL.
   * Coalesces concurrent requests so an asset is fetched at most once.
   * Returns null when priming fails so callers fall back to the asset URL.
   */
  async prime(
    attachmentId: string,
    assetUrl: string,
    fetcher: (url: string) => Promise<Blob> = (url) => fetch(url).then((response) => {
      if (!response.ok) throw new Error(`chat image fetch failed: ${response.status}`);
      return response.blob();
    }),
    userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  ): Promise<string | null> {
    const cached = this.get(attachmentId);
    if (cached) return cached;
    const pending = this.inFlight.get(attachmentId);
    if (pending) return pending;

    const task = (async (): Promise<string | null> => {
      try {
        const blob = await fetcher(assetUrl);
        const useDataUrl = chatImageRequiresDataUrl(userAgent);
        const url = useDataUrl
          ? await this.readDataUrl(blob)
          : this.factory.createObjectUrl(blob);
        this.store(attachmentId, {
          url,
          bytes: blob.size,
          revocable: !useDataUrl,
        });
        return url;
      } catch {
        return null;
      } finally {
        this.inFlight.delete(attachmentId);
      }
    })();

    this.inFlight.set(attachmentId, task);
    return task;
  }

  /** Drop a single cached URL (e.g. when an attachment is deleted). */
  evict(attachmentId: string): void {
    const entry = this.entries.get(attachmentId);
    if (!entry) return;
    this.entries.delete(attachmentId);
    this.totalBytes -= entry.bytes;
    if (entry.revocable) this.factory.revokeObjectUrl(entry.url);
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      if (entry.revocable) this.factory.revokeObjectUrl(entry.url);
    }
    this.entries.clear();
    this.totalBytes = 0;
    this.inFlight.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private store(attachmentId: string, entry: CacheEntry): void {
    if (this.entries.has(attachmentId)) {
      this.evict(attachmentId);
    }
    this.entries.set(attachmentId, entry);
    this.totalBytes += entry.bytes;
    this.enforceLimits();
  }

  private enforceLimits(): void {
    while (
      this.entries.size > 0
      && (this.entries.size > this.maxEntries || this.totalBytes > this.maxTotalBytes)
    ) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.evict(oldestKey);
    }
  }
}

/** Process-wide singleton: survives conversation switches for the app session
    and is released naturally when the WebView tears down. */
export const chatImageObjectUrlCache = new ChatImageObjectUrlCache();
