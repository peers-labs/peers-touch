// AvatarAssets owner (r3.1 Identity/Avatar vertical closure).
//
// React-free owner for avatar resolution and *decode* readiness. Identity
// truth stays with the Station profile and the identity state machine; this
// module only manages asset presentation state:
//
//   canonical key = [sessionEpoch, actorPtid, stationScope,
//                    canonicalAvatarIdentity, profileRevision]
//
// It owns shared native resolve flights, a bounded LRU of decoded Images
// (256), same-actor last-good, session-epoch fencing and scope cleanup. It is
// deliberately framework-free; the React binding lives in
// components/common/useAvatarAsset.ts and SquareAvatar stays a pure consumer.
import { convertFileSrc } from '@tauri-apps/api/core';

import { log } from '../utils/logger';
import { api, type NativeAvatarState } from './desktop_api';

/** Retired demo image generator prefix. Such identities must never resolve. */
export const RETIRED_GENERATED_AVATAR_PREFIX = 'https://internal.example.invalid/api/ide/v1/text_to_image?';

/** Maximum decoded Images retained; older decoded buffers are released LRU. */
export const MAX_DECODED_IMAGES = 256;
/** Upper bound on resolution metadata entries (decoded buffers are bounded separately). */
const MAX_ENTRIES = 512;
/** Default decode budget for a single image; callers pass their edge budget. */
const DEFAULT_DECODE_BUDGET_MS = 2000;

export type AvatarAssetPhase =
  | 'unresolved'
  | 'resolving'
  | 'decoding'
  | 'ready'
  | 'absent'
  | 'failed';

export interface AvatarAssetQuery {
  /** Canonical avatar identity (raw Station path, external URL, data URI or ''). */
  identity: string;
  /** Owning actor PTID. Omit for peer/account-picker entries (epoch 0). */
  actorPtid?: string | null;
  stationScope?: string | null;
  profileRevision?: number | string | null;
  /**
   * Session epoch. Entries at epoch > 0 are fenced and cleaned when the epoch
   * advances. Entries at epoch 0 (peer avatars, account registry rows)
   * survive logout and Station cutover.
   */
  epoch?: number;
  /** Materialized local file supplied by login/profile responses (fast lane). */
  localPath?: string | null;
}

export interface AvatarAssetSnapshot {
  phase: AvatarAssetPhase;
  /** Paint-ready src (data URI or asset-protocol file URL), or null. */
  src: string | null;
  /** Showing last-good for a newer identity / after the edge budget lapsed. */
  degraded: boolean;
  identity: string;
}

export type AvatarPrepareStatus = 'ready' | 'absent' | 'degraded' | 'failed' | 'fenced';

export interface AvatarPrepareResult {
  status: AvatarPrepareStatus;
  snapshot: AvatarAssetSnapshot;
}

export interface AvatarSessionBinding {
  epoch: number;
  actorPtid: string;
  stationScope?: string | null;
  identity: string;
  revision?: number | string | null;
  localPath?: string | null;
  /** Authoritative native state when the binding edge already carries it. */
  state?: NativeAvatarState;
}

export interface AvatarResolveDependencies {
  resolveLocal: (identity: string) => Promise<{
    state?: NativeAvatarState | string;
    identity?: string;
    local_path?: string | null;
  }>;
  fileSrc: (path: string) => string;
  imageFactory: () => HTMLImageElement;
}

interface LastGood {
  identity: string;
  src: string;
  localPath: string | null;
  revision: number | string | null;
}

interface AvatarEntry {
  key: string;
  identity: string;
  epoch: number;
  actorKey: string;
  revision: number | string | null;
  localPath: string | null;
  phase: AvatarAssetPhase;
  src: string | null;
  image: HTMLImageElement | null;
  degraded: boolean;
  failureCount: number;
  /** Earliest timestamp (ms) at which another automatic retry may start. */
  notBefore: number;
  snapshot: AvatarAssetSnapshot;
}

/** `data:image/` URIs render inline and never enter native resolution. */
export function inlineAvatarSource(identity?: string | null): string | null {
  const value = identity?.trim() ?? '';
  return value.startsWith('data:image/') ? value : null;
}

/**
 * Canonical identities eligible for native resolution. Empty identities and
 * the retired generated-avatar prefix are rejected as ABSENT.
 */
export function downloadableAvatarSource(identity?: string | null): string | null {
  const value = identity?.trim() ?? '';
  if (!value || inlineAvatarSource(value) || value.startsWith(RETIRED_GENERATED_AVATAR_PREFIX)) {
    return null;
  }
  return value;
}

export type AvatarSourceKind = 'inline' | 'retired' | 'absent' | 'remote';

/** Single source-of-truth classification shared by bind/request/prepare. */
export function classifyAvatarSource(identity?: string | null): AvatarSourceKind {
  const value = identity?.trim() ?? '';
  if (!value) return 'absent';
  if (inlineAvatarSource(value)) return 'inline';
  if (value.startsWith(RETIRED_GENERATED_AVATAR_PREFIX)) return 'retired';
  return 'remote';
}

/** Bounded backoff for failed native resolutions; explicit refresh bypasses. */
const FAILURE_BACKOFF_MAX_STEPS = 3;
const FAILURE_BACKOFF_CAP_MS = 4_000;

function failureBackoffMs(failureCount: number): number {
  // 500ms, 1s, 2s, capped at 4s.
  const step = Math.max(0, Math.min(failureCount - 1, FAILURE_BACKOFF_MAX_STEPS));
  return Math.min(500 * 2 ** step, FAILURE_BACKOFF_CAP_MS);
}

function actorKeyFor(query: Pick<AvatarAssetQuery, 'epoch' | 'actorPtid' | 'stationScope'>): string {
  return `${query.epoch ?? 0}|${query.actorPtid ?? ''}|${query.stationScope ?? ''}`;
}

export function avatarAssetKey(query: AvatarAssetQuery): string {
  const identity = (query.identity ?? '').trim();
  return `${actorKeyFor(query)}|${query.profileRevision ?? 0}|${identity}`;
}

interface DecodeController {
  settled: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}

function decodeImage(
  factory: () => HTMLImageElement,
  src: string,
  budgetMs: number,
): { promise: Promise<HTMLImageElement>; controller: DecodeController } {
  const controller: DecodeController = { settled: false, timer: undefined };
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    let image: HTMLImageElement;
    try {
      image = factory();
    } catch (error) {
      controller.settled = true;
      reject(error instanceof Error ? error : new Error('avatar image factory failed'));
      return;
    }
    const finish = (error?: Error) => {
      if (controller.settled) return;
      controller.settled = true;
      if (controller.timer) clearTimeout(controller.timer);
      if (error) reject(error);
      else resolve(image);
    };
    controller.timer = setTimeout(
      () => finish(new Error('avatar decode budget exceeded')),
      budgetMs,
    );
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        finish();
      } else {
        finish(new Error('avatar decoded with zero dimensions'));
      }
    };
    image.onerror = () => finish(new Error('avatar decode failed'));
    image.src = src;
    if (image.complete && image.naturalWidth > 0) finish();
  });
  return { promise, controller };
}

const defaultDependencies: AvatarResolveDependencies = {
  resolveLocal: (identity) => api.avatarResolveLocal(identity),
  fileSrc: convertFileSrc,
  imageFactory: () => new Image(),
};

export class AvatarAssetsStore {
  private readonly entries = new Map<string, AvatarEntry>();
  private readonly lastGoodByActor = new Map<string, LastGood>();
  private readonly flights = new Map<string, Promise<AvatarEntry>>();
  private readonly listeners = new Set<() => void>();
  private session: AvatarSessionBinding | null = null;
  private revisionCounter = 0;

  constructor(private readonly deps: AvatarResolveDependencies = defaultDependencies) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Stable snapshot for useSyncExternalStore selectors. */
  getSnapshot(key: string): AvatarAssetSnapshot | null {
    return this.entries.get(key)?.snapshot ?? null;
  }

  /**
   * Bind the current authenticated session. Replaces the session-scoped
   * projection (fencing older epochs), seeds the native local-path fast lane,
   * and starts the canonical resolution. Called only by identity owners
   * (session store / identity runtime), never by components.
   */
  bindSession(binding: AvatarSessionBinding): void {
    if (this.session?.epoch !== binding.epoch) {
      this.cleanupSessionEpoch(binding.epoch);
    }
    this.session = binding;
    const identity = (binding.identity ?? '').trim();
    const query: AvatarAssetQuery = {
      identity,
      actorPtid: binding.actorPtid,
      stationScope: binding.stationScope,
      profileRevision: binding.revision,
      epoch: binding.epoch,
      localPath: binding.localPath,
    };
    const kind = classifyAvatarSource(identity);
    // Empty/retired identities are terminal ABSENT and never resolve natively;
    // inline data: URIs decode locally. A native failed seed also stays absent
    // only when there is no identity at all.
    if (kind === 'absent' || kind === 'retired' || binding.state === 'absent') {
      this.recordTerminal(query, 'absent');
      this.emit();
      return;
    }
    if (!identity) return;
    // Explicit session binding always bypasses failure backoff.
    this.request(query, { force: true });
  }

  /** Drop the authenticated projection (logout). Persistent entries remain. */
  unbindSession(): void {
    if (this.session) {
      this.cleanupSessionEpoch(this.session.epoch);
    }
    this.session = null;
    this.emit();
  }

  currentSessionEpoch(): number {
    return this.session?.epoch ?? 0;
  }

  /**
   * Ensure a resolution is in flight for `query`. Components call this; failed
   * entries retry on a bounded backoff instead of serving as a permanent
   * negative cache. `force` (explicit refresh / identity binding) bypasses
   * the backoff.
   */
  request(query: AvatarAssetQuery, options: { force?: boolean } = {}): AvatarAssetSnapshot | null {
    const key = avatarAssetKey(query);
    const existing = this.entries.get(key);
    if (existing && (existing.phase === 'ready' || existing.phase === 'absent')) {
      this.touch(key);
      return existing.snapshot;
    }
    if (existing && existing.phase === 'failed' && !options.force && Date.now() < existing.notBefore) {
      // Within the bounded retry window; keep the last-good/neutral snapshot.
      return existing.snapshot;
    }
    if (classifyAvatarSource(query.identity) === 'retired') {
      return this.recordTerminal(query, 'absent').snapshot;
    }
    if (!this.flights.has(key)) {
      this.startFlight(key, query);
    }
    return existing?.snapshot ?? null;
  }

  /**
   * Wait for decode readiness under an edge budget.
   *
   * `localOnly` (restore / PIN unlock / account switch) never touches the
   * network: it decodes a seeded local path or same-actor last-good and
   * otherwise returns `degraded`/`failed` immediately so the shell is not
   * blocked. Fresh edges may resolve natively.
   */
  async prepare(
    query: AvatarAssetQuery,
    options: { budgetMs: number; localOnly?: boolean; force?: boolean } = { budgetMs: DEFAULT_DECODE_BUDGET_MS },
  ): Promise<AvatarPrepareResult> {
    const identity = (query.identity ?? '').trim();
    const normalized: AvatarAssetQuery = { ...query, identity };
    const kind = classifyAvatarSource(identity);
    if (kind === 'absent' || kind === 'retired') {
      const snapshot = this.recordTerminal(normalized, 'absent');
      return { status: 'absent', snapshot };
    }

    const budget = Math.max(0, options.budgetMs);
    const flight = options.localOnly
      ? this.requestLocalFlight(normalized)
      : this.requestFlight(normalized, options.force ?? false);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      flight.then((entry): AvatarPrepareResult => ({
        status: entry.phase === 'ready'
          ? 'ready'
          : entry.phase === 'absent'
            ? 'absent'
            : this.lastGoodFallback(normalized) ? 'degraded' : 'failed',
        snapshot: entry.snapshot,
      })),
      new Promise<AvatarPrepareResult>((resolve) => {
        timer = setTimeout(() => {
          const fallback = this.lastGoodFallback(normalized);
          resolve({
            status: fallback ? 'degraded' : 'failed',
            snapshot: fallback ?? this.placeholderSnapshot(normalized, true),
          });
        }, budget);
      }),
    ]);
    if (timer) clearTimeout(timer);

    if (this.isFenced(normalized)) {
      return { status: 'fenced', snapshot: outcome.snapshot };
    }
    return outcome;
  }

  /** Forget a broken src after an <img> error so the next mount can retry. */
  invalidateSrc(src: string): void {
    for (const entry of this.entries.values()) {
      if (entry.src === src) {
        entry.src = null;
        entry.image = null;
        entry.phase = entry.identity ? 'failed' : 'absent';
        this.publish(entry);
      }
    }
  }

  /** Drop all session-scoped entries/flights except the given epoch. */
  cleanupSessionEpoch(keepEpoch: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.epoch > 0 && entry.epoch !== keepEpoch) this.entries.delete(key);
    }
    for (const [key] of this.flights) {
      const epoch = Number(key.slice(0, key.indexOf('|')));
      if (Number.isFinite(epoch) && epoch > 0 && epoch !== keepEpoch) this.flights.delete(key);
    }
    for (const actorKey of this.lastGoodByActor.keys()) {
      const epoch = Number(actorKey.slice(0, actorKey.indexOf('|')));
      if (Number.isFinite(epoch) && epoch > 0 && epoch !== keepEpoch) {
        this.lastGoodByActor.delete(actorKey);
      }
    }
    this.enforceEntryBound();
    this.emit();
  }

  /** Test/teardown helper. */
  reset(): void {
    this.entries.clear();
    this.lastGoodByActor.clear();
    this.flights.clear();
    this.session = null;
    this.revisionCounter = 0;
  }

  // ── internals ──

  private startFlight(key: string, query: AvatarAssetQuery): Promise<AvatarEntry> {
    const flight = this.runFlight(key, query).finally(() => {
      this.flights.delete(key);
    });
    this.flights.set(key, flight);
    return flight;
  }

  private requestFlight(query: AvatarAssetQuery, force = false): Promise<AvatarEntry> {
    const key = avatarAssetKey(query);
    const existing = this.entries.get(key);
    if (existing && (existing.phase === 'ready' || existing.phase === 'absent')) {
      return Promise.resolve(existing);
    }
    if (
      existing
      && existing.phase === 'failed'
      && !force
      && Date.now() < existing.notBefore
    ) {
      return Promise.resolve(existing);
    }
    if (classifyAvatarSource(query.identity) === 'retired') {
      return Promise.resolve(this.recordTerminal(query, 'absent'));
    }
    return this.flights.get(key) ?? this.startFlight(key, query);
  }

  private requestLocalFlight(query: AvatarAssetQuery): Promise<AvatarEntry> {
    const key = avatarAssetKey(query);
    const existing = this.entries.get(key);
    if (existing?.phase === 'ready') return Promise.resolve(existing);
    if (this.flights.has(key)) return this.flights.get(key)!;
    const flight = this.runLocalFlight(key, query).finally(() => {
      this.flights.delete(key);
    });
    this.flights.set(key, flight);
    return flight;
  }

  private async runLocalFlight(key: string, query: AvatarAssetQuery): Promise<AvatarEntry> {
    const inline = inlineAvatarSource(query.identity);
    if (inline) {
      try {
        const image = await this.decodeWith(key, inline, DEFAULT_DECODE_BUDGET_MS);
        if (this.isFenced(query)) return this.entries.get(key) ?? this.placeholderEntry(query);
        return this.recordReady(query, inline, null, image);
      } catch (error) {
        log.warn('avatar', 'inline avatar decode failed', { error: String(error) });
        return this.recordTerminal(query, 'failed');
      }
    }
    const localPath = query.localPath?.trim()
      ?? (query.actorPtid ? this.lastGoodByActor.get(actorKeyFor(query))?.localPath : undefined);
    if (!localPath) {
      return this.recordTerminal(query, 'failed');
    }
    try {
      const src = this.deps.fileSrc(localPath);
      const image = await this.decodeWith(key, src, DEFAULT_DECODE_BUDGET_MS);
      if (this.isFenced(query)) return this.entries.get(key) ?? this.placeholderEntry(query);
      return this.recordReady(query, src, localPath, image);
    } catch (error) {
      log.warn('avatar', 'local avatar decode failed', { error: String(error) });
      return this.recordTerminal(query, 'failed');
    }
  }

  private async runFlight(key: string, query: AvatarAssetQuery): Promise<AvatarEntry> {
    const inline = inlineAvatarSource(query.identity);
    if (inline) {
      try {
        const image = await this.decodeWith(key, inline, DEFAULT_DECODE_BUDGET_MS);
        if (this.isFenced(query)) return this.placeholderEntry(query);
        return this.recordReady(query, inline, null, image);
      } catch (error) {
        log.warn('avatar', 'inline avatar decode failed', { error: String(error) });
        return this.recordTerminal(query, 'failed');
      }
    }

    // Native local path fast lane (login response / synced profile): decode it
    // before issuing any network work.
    const seededPath = query.localPath?.trim();
    if (seededPath) {
      try {
        const src = this.deps.fileSrc(seededPath);
        const image = await this.decodeWith(key, src, DEFAULT_DECODE_BUDGET_MS);
        if (!this.isFenced(query)) {
          return this.recordReady(query, src, seededPath, image);
        }
      } catch (error) {
        log.warn('avatar', 'seeded avatar path failed to decode; resolving natively', {
          error: String(error),
        });
      }
    }
    if (this.isFenced(query)) return this.placeholderEntry(query);

    this.markPhase(key, query, 'resolving');
    let result: Awaited<ReturnType<AvatarResolveDependencies['resolveLocal']>>;
    try {
      result = await this.deps.resolveLocal(query.identity);
    } catch (error) {
      log.warn('avatar', 'native avatar resolve failed', { error: String(error) });
      return this.isFenced(query)
        ? this.placeholderEntry(query)
        : this.recordTerminal(query, 'failed');
    }

    if (this.isFenced(query)) {
      return this.placeholderEntry(query);
    }

    const state = (result.state ?? 'failed') as NativeAvatarState;
    if (state === 'absent') {
      return this.recordTerminal(query, 'absent');
    }
    const localPath = result.local_path?.trim() || null;
    if (state !== 'ready' || !localPath) {
      return this.recordTerminal(query, 'failed');
    }

    try {
      const src = this.deps.fileSrc(localPath);
      const image = await this.decodeWith(key, src, DEFAULT_DECODE_BUDGET_MS);
      if (this.isFenced(query)) return this.placeholderEntry(query);
      return this.recordReady(query, src, localPath, image);
    } catch (error) {
      log.warn('avatar', 'resolved avatar failed to decode', { error: String(error) });
      return this.recordTerminal(query, 'failed');
    }
  }

  private decodeWith(
    key: string,
    src: string,
    budgetMs: number,
  ): Promise<HTMLImageElement> {
    const entry = this.entries.get(key);
    if (entry) {
      entry.phase = 'decoding';
      entry.degraded = false;
      this.publish(entry);
    }
    return decodeImage(this.deps.imageFactory, src, budgetMs).promise;
  }

  private recordReady(
    query: AvatarAssetQuery,
    src: string,
    localPath: string | null,
    image: HTMLImageElement,
  ): AvatarEntry {
    const key = avatarAssetKey(query);
    const entry: AvatarEntry = {
      key,
      identity: query.identity,
      epoch: query.epoch ?? 0,
      actorKey: actorKeyFor(query),
      revision: query.profileRevision ?? null,
      localPath,
      phase: 'ready',
      src,
      image,
      degraded: false,
      failureCount: 0,
      notBefore: 0,
      snapshot: { phase: 'ready', src, degraded: false, identity: query.identity },
    };
    this.entries.set(key, entry);
    this.touch(key);
    // Last-good is only usable when the owner is known. Peer avatars without
    // an actor PTID and the authenticated session must never share a bucket.
    if (query.actorPtid) {
      this.lastGoodByActor.set(entry.actorKey, {
        identity: entry.identity,
        src,
        localPath,
        revision: entry.revision,
      });
    }
    this.enforceEntryBound();
    this.enforceImageBound();
    this.emit();
    return entry;
  }

  private recordTerminal(query: AvatarAssetQuery, phase: 'absent' | 'failed'): AvatarEntry {
    const key = avatarAssetKey(query);
    const previous = this.entries.get(key);
    // Last-good fallback only applies to an attributed owner; an unattributed
    // peer identity (no actorPtid) must never inherit another actor's image.
    const fallback = phase === 'failed' && query.actorPtid ? this.lastGoodFallback(query) : null;
    const failureCount = (previous?.failureCount ?? 0) + (phase === 'failed' ? 1 : 0);
    const notBefore = phase === 'failed'
      ? Date.now() + failureBackoffMs(failureCount)
      : 0;
    const entry: AvatarEntry = {
      key,
      identity: query.identity,
      epoch: query.epoch ?? 0,
      actorKey: actorKeyFor(query),
      revision: query.profileRevision ?? null,
      localPath: previous?.localPath ?? query.localPath?.trim() ?? null,
      phase,
      // Failed is not a permanent null cache: keep same-actor last-good src
      // while the bounded backoff allows a later retry.
      src: fallback?.src ?? null,
      image: null,
      degraded: Boolean(fallback),
      failureCount,
      notBefore,
      snapshot: {
        phase,
        src: fallback?.src ?? null,
        degraded: Boolean(fallback),
        identity: query.identity,
      },
    };
    this.entries.set(key, entry);
    this.enforceEntryBound();
    this.emit();
    return entry;
  }

  private markPhase(
    key: string,
    query: AvatarAssetQuery,
    phase: AvatarAssetPhase,
  ): void {
    const existing = this.entries.get(key);
    const entry: AvatarEntry = existing
      ? { ...existing, phase }
      : {
          key,
          identity: query.identity,
          epoch: query.epoch ?? 0,
          actorKey: actorKeyFor(query),
          revision: query.profileRevision ?? null,
          localPath: query.localPath?.trim() ?? null,
          phase,
          src: null,
          image: null,
          degraded: false,
          failureCount: 0,
          notBefore: 0,
          snapshot: { phase, src: null, degraded: false, identity: query.identity },
        };
    entry.snapshot = {
      phase,
      src: entry.src,
      degraded: entry.degraded,
      identity: entry.identity,
    };
    this.entries.set(key, entry);
    this.emit();
  }

  private publish(entry: AvatarEntry): void {
    entry.snapshot = {
      phase: entry.phase,
      src: entry.src,
      degraded: entry.degraded,
      identity: entry.identity,
    };
    this.emit();
  }

  private lastGoodFallback(query: AvatarAssetQuery): AvatarAssetSnapshot | null {
    // Only attributed owners (session actor or explicit peer PTID) may show
    // last-good. An unattributed identity must not inherit another actor.
    if (!query.actorPtid) return null;
    const good = this.lastGoodByActor.get(actorKeyFor(query));
    if (!good?.src) return null;
    return { phase: 'ready', src: good.src, degraded: true, identity: good.identity };
  }

  private placeholderSnapshot(query: AvatarAssetQuery, degraded: boolean): AvatarAssetSnapshot {
    return { phase: 'resolving', src: null, degraded, identity: query.identity };
  }

  private placeholderEntry(query: AvatarAssetQuery): AvatarEntry {
    return {
      key: avatarAssetKey(query),
      identity: query.identity,
      epoch: query.epoch ?? 0,
      actorKey: actorKeyFor(query),
      revision: query.profileRevision ?? null,
      localPath: query.localPath?.trim() ?? null,
      phase: 'unresolved',
      src: null,
      image: null,
      degraded: false,
      failureCount: 0,
      notBefore: 0,
      snapshot: { phase: 'unresolved', src: null, degraded: false, identity: query.identity },
    };
  }

  private isFenced(query: AvatarAssetQuery): boolean {
    if ((query.epoch ?? 0) <= 0) return false;
    // Only fence once a newer session is bound; an unbound store allows
    // standalone (e.g. test) epoch-scoped resolutions.
    return this.session !== null && this.session.epoch !== query.epoch;
  }

  private touch(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    // Re-insert to mark LRU recency (Map iterates in insertion order).
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private enforceEntryBound(): void {
    while (this.entries.size > MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }

  private enforceImageBound(): void {
    let decoded = 0;
    for (const entry of this.entries.values()) if (entry.image) decoded += 1;
    for (const entry of this.entries.values()) {
      if (decoded <= MAX_DECODED_IMAGES) break;
      if (entry.image) {
        // Release the decoded buffer only; src stays paint-ready via WebKit cache.
        entry.image = null;
        decoded -= 1;
      }
    }
  }

  private emit(): void {
    this.revisionCounter += 1;
    this.listeners.forEach((listener) => listener());
  }
}

/**
 * Process-wide AvatarAssets owner. The identity runtime and the React avatar
 * components share this single instance; there is no per-component cache.
 */
export const avatarAssets = new AvatarAssetsStore();
