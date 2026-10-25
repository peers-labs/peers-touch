import type { ChatAttachmentLike } from './index.js';

export type ChatFilePreviewKind = 'image' | 'audio' | 'video' | 'pdf' | 'text' | 'office' | 'file';
export const CHAT_TEXT_PREVIEW_LIMIT = 512 * 1024;

/** Active formats never become executable WebView documents. */
export function chatFilePreviewKind(attachment: ChatAttachmentLike): ChatFilePreviewKind {
  const declaredMime = (attachment.mimeType ?? attachment.mime_type ?? '').split(';')[0].trim().toLowerCase();
  const mime = ['audio/m4a', 'audio/x-m4a'].includes(declaredMime) ? 'audio/mp4'
    : declaredMime === 'audio/x-wav' ? 'audio/wav' : declaredMime;
  const extension = (attachment.filename ?? '').split('.').pop()?.toLowerCase() ?? '';
  if (/^(exe|com|bat|cmd|ps1|sh|app|apk|jar|msi|dmg|html?|xhtml|svg|js|mjs)$/.test(extension)) return 'file';
  const unspecified = !mime || mime === 'application/octet-stream';
  if (['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'].includes(mime)
    || (unspecified && /^(jpe?g|png|gif|webp|avif)$/.test(extension))) return 'image';
  if (['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm'].includes(mime)
    || (unspecified && /^(mp3|m4a|ogg|wav)$/.test(extension))) return 'audio';
  if (['video/mp4', 'video/webm', 'video/ogg'].includes(mime)
    || (unspecified && /^(mp4|webm|ogv)$/.test(extension))) return 'video';
  if (mime === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (/^(docx?|xlsx?|pptx?|odt|ods|odp)$/.test(extension)) return 'office';
  if (
    (mime === 'text/plain' || /^(txt|md|csv|tsv|log|json|yaml|yml)$/.test(extension))
    && Number(attachment.size ?? 0) <= CHAT_TEXT_PREVIEW_LIMIT
  ) return 'text';
  return 'file';
}

export function chatAttachmentAccessId(attachment: ChatAttachmentLike): string {
  const explicit = (attachment as ChatAttachmentLike & { attachmentId?: string }).attachmentId?.trim();
  if (explicit) return explicit;
  const cid = attachment.cid?.trim() ?? '';
  return cid.startsWith('messaging:') ? cid.slice('messaging:'.length) : cid;
}

export interface ChatAttachmentAccessSnapshot<Projection> {
  readonly projection: Projection | null;
  readonly loading: boolean;
  readonly error: boolean;
}

export interface ChatAttachmentAccessPort<Scope, Projection, Action, Result> {
  read(scope: Scope, id: string, startDownload: boolean, retry: boolean): Promise<Projection>;
  release(scope: Scope, handle: string): Promise<void>;
  cancel(scope: Scope, id: string): Promise<void>;
  action(scope: Scope, id: string, handle: string, action: Action): Promise<Result>;
  handle(projection: Projection): string;
  pending(projection: Projection): boolean;
}

interface Entry<Projection> {
  snapshot: ChatAttachmentAccessSnapshot<Projection>;
  listeners: Set<() => void>;
  inFlight: Promise<void> | null;
  cancelling: boolean;
  releaseBarrier: Promise<void>;
  revision: number;
  followup: { start: boolean; retry: boolean } | null;
  expiresAt: number;
}

const EMPTY = Object.freeze({ projection: null, loading: false, error: false });
const MAX_ENTRIES = 256;
const REQUEST_TIMEOUT_MS = 30_000;
const RECONCILE_LIFETIME_MS = 5 * 60_000;

/**
 * One controller per Messaging Runtime. Generated protobuf values remain the
 * projection; ports bind each host's scope and codec without duplicating DTOs.
 * Closing presentation revokes its grant, while durable downloads keep running.
 */
export class ChatAttachmentAccessController<Scope, Projection, Action, Result> {
  private scope: Scope | null = null;
  private scopeKey = '';
  private generation = 0;
  private entries = new Map<string, Entry<Projection>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private selection: string | null = null;
  private selectionMetadata: ChatAttachmentLike | null = null;
  private selectionRevision = 0;
  private selectionListeners = new Set<() => void>();
  private actionInFlight = false;

  constructor(private readonly port: ChatAttachmentAccessPort<Scope, Projection, Action, Result>) {}

  setScope(scope: Scope | null, key = ''): void {
    if (key === this.scopeKey && Boolean(scope) === Boolean(this.scope)) return;
    this.close();
    const previous = this.scope;
    this.generation += 1;
    this.scope = scope;
    this.scopeKey = key;
    for (const entry of this.entries.values()) {
      this.releaseEntry(previous, entry);
      entry.revision += 1;
      entry.snapshot = EMPTY;
      entry.inFlight = null;
      entry.cancelling = false;
      entry.followup = null;
      entry.listeners.forEach((notify) => notify());
    }
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = scope ? setInterval(() => this.refreshPending(), 1000) : null;
    if (scope) {
      for (const [id, entry] of this.entries) {
        if (entry.listeners.size) void this.request(id, false, false);
      }
    }
  }

  snapshot(id: string): ChatAttachmentAccessSnapshot<Projection> {
    return this.entries.get(id)?.snapshot ?? EMPTY;
  }

  observe(id: string, notify: () => void, eager = false): () => void {
    if (!id) return () => {};
    const entry = this.entry(id);
    entry.listeners.add(notify);
    if (!entry.snapshot.projection
      || (eager && !this.port.handle(entry.snapshot.projection) && !this.port.pending(entry.snapshot.projection))) {
      void this.request(id, eager, false);
    }
    return () => {
      entry.listeners.delete(notify);
      if (!entry.listeners.size && this.selection !== id) {
        this.releaseEntry(this.scope, entry);
        if (entry.snapshot.projection && !this.port.pending(entry.snapshot.projection)) {
          entry.revision += 1;
          entry.snapshot = EMPTY;
        }
      }
    };
  }

  selectedId = (): string | null => this.selection;

  selectedMetadata = (): ChatAttachmentLike | null => this.selectionMetadata;

  subscribeSelection = (notify: () => void): (() => void) => {
    this.selectionListeners.add(notify);
    return () => this.selectionListeners.delete(notify);
  };

  open(id: string, metadata?: ChatAttachmentLike): void {
    if (!id) return;
    if (this.selection !== id) this.close();
    this.selection = id;
    this.selectionMetadata = metadata ?? null;
    this.selectionRevision += 1;
    this.selectionListeners.forEach((notify) => notify());
    const projection = this.snapshot(id).projection;
    if (!projection || !this.port.handle(projection)) void this.request(id, true, false);
  }

  close = (): void => {
    const id = this.selection;
    this.selection = null;
    this.selectionMetadata = null;
    this.selectionRevision += 1;
    if (id) {
      const entry = this.entries.get(id);
      if (entry) {
        this.releaseEntry(this.scope, entry);
        entry.revision += 1;
        // Retain pending checkpoints for runtime reconciliation, never a grant.
        if (!entry.snapshot.projection || !this.port.pending(entry.snapshot.projection)) {
          entry.snapshot = EMPTY;
        }
        entry.listeners.forEach((notify) => notify());
        const generation = this.generation;
        queueMicrotask(() => {
          if (generation === this.generation && entry.listeners.size && this.selection !== id) {
            void this.request(id, false, false);
          }
        });
      }
      this.selectionListeners.forEach((notify) => notify());
    }
  };

  retry(id: string): Promise<void> {
    return this.request(id, true, true);
  }

  async cancel(id: string): Promise<void> {
    const scope = this.scope;
    const generation = this.generation;
    if (!scope) return;
    const entry = this.entry(id);
    if (entry.cancelling) return;
    entry.cancelling = true;
    entry.revision += 1;
    entry.followup = null;
    try {
      await this.port.cancel(scope, id);
    } catch {
      if (generation === this.generation) this.update(entry, { ...entry.snapshot, error: true });
    } finally {
      if (generation === this.generation) {
        entry.cancelling = false;
        entry.followup = { start: false, retry: false };
        await this.request(id, false, false);
      }
    }
  }

  async perform(id: string, action: Action): Promise<Result | null> {
    const scope = this.scope;
    const projection = this.snapshot(id).projection;
    const revision = this.selectionRevision;
    if (!scope || this.selection !== id || !projection || this.actionInFlight) return null;
    const handle = this.port.handle(projection);
    if (!handle) return null;
    this.actionInFlight = true;
    try {
      const result = await this.port.action(scope, id, handle, action);
      return revision === this.selectionRevision && this.selection === id ? result : null;
    } finally {
      this.actionInFlight = false;
    }
  }

  /** Projection notifications wake the same single-flight owner as polling. */
  refreshPending(): void {
    for (const [id, entry] of this.entries) {
      const pending = entry.snapshot.projection && this.port.pending(entry.snapshot.projection);
      if (pending && (this.selection === id || Date.now() < entry.expiresAt)) {
        void this.request(id, false, false);
      }
      if (!entry.listeners.size && this.selection !== id && !entry.inFlight && (!pending || Date.now() >= entry.expiresAt)) {
        this.releaseProjection(this.scope, entry.snapshot.projection);
        this.entries.delete(id);
      }
    }
  }

  private entry(id: string): Entry<Projection> {
    let entry = this.entries.get(id);
    if (!entry) {
      this.refreshPending();
      if (this.entries.size >= MAX_ENTRIES) throw new Error('FILE_ACCESS_CAPACITY');
      entry = { snapshot: EMPTY, listeners: new Set(), inFlight: null, cancelling: false, releaseBarrier: Promise.resolve(), revision: 0, followup: null, expiresAt: 0 };
      this.entries.set(id, entry);
    }
    return entry;
  }

  private request(id: string, start: boolean, retry: boolean): Promise<void> {
    const scope = this.scope;
    if (!scope) return Promise.resolve();
    const entry = this.entry(id);
    if (entry.cancelling) return Promise.resolve();
    if (start) entry.expiresAt = Date.now() + RECONCILE_LIFETIME_MS;
    if (entry.inFlight) {
      if (start || retry) entry.followup = { start, retry: retry || Boolean(entry.followup?.retry) };
      return entry.inFlight;
    }
    entry.followup = null;
    const generation = this.generation;
    const revision = entry.revision;
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout>;
    this.update(entry, { ...entry.snapshot, loading: true, error: false });
    const read = entry.releaseBarrier.then(() => {
      if (generation !== this.generation || revision !== entry.revision || entry.cancelling) return null;
      return this.port.read(scope, id, start, retry);
    }).then((projection) => {
      if (!projection) return null;
      if (timedOut || generation !== this.generation || revision !== entry.revision) {
        this.releaseProjection(scope, projection);
        return null;
      }
      return projection;
    });
    const operation = Promise.race([
      read,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { timedOut = true; reject(new Error('FILE_ACCESS_TIMEOUT')); }, REQUEST_TIMEOUT_MS);
      }),
    ]).then((projection) => {
      if (!projection) return;
      if (generation !== this.generation || revision !== entry.revision) {
        this.releaseProjection(scope, projection);
        return;
      }
      const previousHandle = entry.snapshot.projection && this.port.handle(entry.snapshot.projection);
      if (previousHandle && previousHandle !== this.port.handle(projection)) {
        this.releaseEntry(scope, entry);
      }
      if (this.port.pending(projection) && !entry.expiresAt) {
        entry.expiresAt = Date.now() + RECONCILE_LIFETIME_MS;
      }
      if (!entry.listeners.size && this.selection !== id && !this.port.pending(projection)) {
        this.releaseProjection(scope, projection);
        this.update(entry, EMPTY);
      } else {
        this.update(entry, { projection, loading: false, error: false });
      }
    }).catch(() => {
      if (generation === this.generation && revision === entry.revision) {
        this.update(entry, { ...entry.snapshot, loading: false, error: true });
      }
    }).finally(() => {
      clearTimeout(timeout);
      if (entry.inFlight !== operation) return;
      entry.inFlight = null;
      if (generation !== this.generation || entry.cancelling) return;
      const followup = entry.followup;
      entry.followup = null;
      if (followup) void this.request(id, followup.start, followup.retry);
      else if (revision !== entry.revision && (entry.listeners.size || this.selection === id)) {
        void this.request(id, this.selection === id, false);
      }
    });
    entry.inFlight = operation;
    return operation;
  }

  private update(entry: Entry<Projection>, snapshot: ChatAttachmentAccessSnapshot<Projection>): void {
    entry.snapshot = snapshot;
    entry.listeners.forEach((notify) => notify());
  }

  private releaseProjection(scope: Scope | null, projection: Projection | null): void {
    if (!scope || !projection) return;
    const handle = this.port.handle(projection);
    if (handle) void this.port.release(scope, handle).catch(() => {});
  }

  private releaseEntry(scope: Scope | null, entry: Entry<Projection>): void {
    const projection = entry.snapshot.projection;
    const handle = projection && this.port.handle(projection);
    if (scope && handle) {
      entry.releaseBarrier = entry.releaseBarrier.then(() => this.port.release(scope, handle)).catch(() => {});
    }
  }
}
