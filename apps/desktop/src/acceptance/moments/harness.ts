import { create } from '@bufbuild/protobuf';
import { invoke } from '@tauri-apps/api/core';
import {
  AudienceSchema,
  Audience_Kind,
  type Post,
} from '../../gen/proto/domain/social/post_pb';
import type {
  PrivateMomentMediaProjection,
  PrivateMomentProjection,
} from '../../services/privateMomentsNative';
import { api } from '../../services/desktop_api';
import { useMomentsStore, type MomentComposerDraft } from '../../store/moments';
import {
  selectPrivateCommentThread,
  usePrivateCommentsStore,
} from '../../store/privateComments';
import { usePrivateMomentsStore } from '../../store/privateMoments';
import { useSessionStore } from '../../store/session';
import { registerAcceptanceHarness } from '../registry';

declare const __PT_SOURCE_COMMIT__: string;

let rendererArtifactSha256Promise: Promise<string> | null = null;
const browserPageBootIdentity = (() => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
})();
const MAX_CAPTURE_EVENT_DIGESTS = 4096;

interface StagePrivateDraftInput {
  draftId: string;
  revision: number;
  text: string;
  audienceKind?: keyof typeof PRIVATE_AUDIENCE_BY_NAME;
  targetId?: string;
  baseKind?: 'PUBLIC' | 'FOLLOWERS';
  actorPtids?: string[];
  momentKind?: 'TEXT' | 'IMAGE';
  files?: Array<{
    intentId: string;
    filePath: string;
  }>;
}

const PRIVATE_AUDIENCE_BY_NAME = {
  FRIENDS: Audience_Kind.FRIENDS,
  FOLLOWERS: Audience_Kind.FOLLOWERS,
  CIRCLE: Audience_Kind.CIRCLE,
  GROUP: Audience_Kind.GROUP,
  SELF: Audience_Kind.SELF,
  CUSTOM_ALLOW: Audience_Kind.CUSTOM_ALLOW,
  CUSTOM_DENY: Audience_Kind.CUSTOM_DENY,
} as const;

function audienceName(kind: Audience_Kind): string {
  return Object.entries(PRIVATE_AUDIENCE_BY_NAME)
    .find(([, value]) => value === kind)?.[0] ?? 'OTHER';
}

function privateAudience(input: StagePrivateDraftInput) {
  const kindName = input.audienceKind ?? 'FRIENDS';
  const kind = PRIVATE_AUDIENCE_BY_NAME[kindName];
  const targetId = input.targetId?.trim()
    ? BigInt(input.targetId)
    : 0n;
  const baseKind = input.baseKind === 'PUBLIC'
    ? Audience_Kind.PUBLIC
    : input.baseKind === 'FOLLOWERS'
      ? Audience_Kind.FOLLOWERS
      : Audience_Kind.KIND_UNSPECIFIED;
  return create(AudienceSchema, {
    kind,
    targetId,
    baseKind,
    actorPtids: input.actorPtids ?? [],
  });
}

interface PrivateMomentInput {
  postId: string;
  openMedia?: boolean;
}

interface PublicMomentInput {
  text: string;
  filePath?: string;
}

interface RuntimeIdentityResult {
  ok: boolean;
  data?: {
    bootIdentitySha256?: unknown;
    sessionGeneration?: unknown;
    sourceCommit?: unknown;
    executableSha256?: unknown;
    stationRuntimeIdentitySha256?: unknown;
    stationEndpointSha256?: unknown;
  };
}

interface StreamTerminalMarker {
  schemaVersion: 1;
  captureId: string;
  actionId: string;
  runtimeManifestDigest: string;
  finalObserverSequence: number;
  openStreamIdentityDigests: readonly string[];
  captureIntervalDigest: string;
  markerDigest: string;
}

interface ActiveNetworkCapture {
  actionId: string;
  captureId: string;
  eventDigests: string[];
  failure?: Error;
  initialObserverSequence: number;
  runtimeManifestDigest: string;
}

async function sha256(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function activeSessionIdentity() {
  const session = useSessionStore.getState();
  const actorPtid = session.currentUser?.actorPtid?.trim() || undefined;
  if (
    !Number.isSafeInteger(session.sessionEpoch)
    || session.sessionEpoch < 0
  ) {
    throw new Error('moments.acceptance.sessionIdentityMissing');
  }
  const authenticationState = actorPtid ? 'AUTHENTICATED' : 'ANONYMOUS';
  return {
    actorPtid,
    authenticationState,
    sessionIdentitySha256: await sha256(JSON.stringify({
      schemaVersion: 1,
      authenticationState,
      actorPtid: actorPtid ?? null,
      sessionEpoch: session.sessionEpoch,
    })),
  };
}

function rendererArtifactSha256(): Promise<string> {
  if (rendererArtifactSha256Promise) return rendererArtifactSha256Promise;
  rendererArtifactSha256Promise = (async () => {
    const candidates = new Set<string>();
    for (const script of Array.from(document.scripts)) {
      if (script.src) {
        const url = new URL(script.src, window.location.href);
        if (url.origin === window.location.origin) candidates.add(url.href);
      }
    }
    for (const entry of performance.getEntriesByType('resource')) {
      const resource = entry as PerformanceResourceTiming;
      if (resource.initiatorType === 'script' && resource.name) {
        const url = new URL(resource.name, window.location.href);
        if (url.origin === window.location.origin) candidates.add(url.href);
      }
    }
    if (candidates.size === 0) {
      throw new Error('moments.acceptance.rendererArtifactMissing');
    }
    const artifacts = await Promise.all(
      [...candidates].sort().map(async (url) => {
        const parsed = new URL(url);
        const response = await fetch(url, {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!response.ok) {
          throw new Error('moments.acceptance.rendererArtifactFetchFailed');
        }
        return {
          path: parsed.pathname,
          sha256: await sha256(await response.arrayBuffer()),
        };
      }),
    );
    return sha256(JSON.stringify({
      schemaVersion: 1,
      sourceCommit: __PT_SOURCE_COMMIT__,
      artifacts,
    }));
  })();
  return rendererArtifactSha256Promise;
}

async function browserStationIdentitySha256(): Promise<{
  stationRuntimeIdentitySha256: string;
  stationEndpointSha256: string;
}> {
  const first = resolveBoundBrowserStation(await api.stationList());
  const confirmed = resolveBoundBrowserStation(await api.stationList());
  if (
    first.generation !== confirmed.generation
    || first.stationPeerId !== confirmed.stationPeerId
    || first.stationUrl !== confirmed.stationUrl
  ) {
    throw new Error('moments.acceptance.stationIdentityMissing');
  }
  return {
    stationRuntimeIdentitySha256: await sha256(confirmed.stationPeerId),
    stationEndpointSha256: await sha256(confirmed.stationUrl),
  };
}

function resolveBoundBrowserStation(
  registry: Awaited<ReturnType<typeof api.stationList>>,
): {
  generation: number;
  stationPeerId: string;
  stationUrl: string;
} {
  const boundUrl = typeof registry.binding?.bound_url === 'string'
    ? registry.binding.bound_url.trim().replace(/\/+$/, '')
    : '';
  const activeUrl = typeof registry.active_url === 'string'
    ? registry.active_url.trim().replace(/\/+$/, '')
    : '';
  if (
    registry.binding?.phase !== 'bound'
    || !Number.isSafeInteger(registry.binding.generation)
    || registry.binding.generation < 0
    || !boundUrl
    || !activeUrl
    || boundUrl !== activeUrl
  ) {
    throw new Error('moments.acceptance.stationIdentityMissing');
  }
  const activeEntry = registry.entries.find(
    (entry) => entry.url.trim().replace(/\/+$/, '') === boundUrl,
  );
  const stationPeerId = activeEntry?.peer_id;
  if (
    typeof stationPeerId !== 'string'
    || !stationPeerId.trim()
    || stationPeerId !== stationPeerId.trim()
  ) {
    throw new Error('moments.acceptance.stationIdentityMissing');
  }
  return {
    generation: registry.binding.generation,
    stationPeerId,
    stationUrl: boundUrl,
  };
}

async function nativeRuntimeIdentitySha256(
  platform: string,
  scope: {
    actorPtid: string | null;
    rendererGeneration: number;
  },
): Promise<{
  bootIdentitySha256: string;
  sessionGeneration: number;
  nativeRuntimeIdentitySha256?: string;
  stationRuntimeIdentitySha256: string;
  stationEndpointSha256: string;
  clientArtifactSha256: string;
}> {
  if (platform !== 'native') {
    const sessionGeneration = useSessionStore.getState().sessionEpoch;
    if (
      !Number.isSafeInteger(sessionGeneration)
      || sessionGeneration < 1
    ) {
      throw new Error('moments.acceptance.browserRuntimeIdentityMissing');
    }
    return {
      bootIdentitySha256: await sha256(
        `peers-touch:browser-page-boot:v1:${browserPageBootIdentity}`,
      ),
      sessionGeneration,
      ...await browserStationIdentitySha256(),
      clientArtifactSha256: await rendererArtifactSha256(),
    };
  }
  if (
    !scope.actorPtid
    || !Number.isSafeInteger(scope.rendererGeneration)
    || scope.rendererGeneration < 1
  ) {
    throw new Error('moments.acceptance.nativeRuntimeIdentityMissing');
  }
  const result = await invoke<RuntimeIdentityResult>(
    'social_private_moments_acceptance_runtime_identity',
    {
      input: {
        actor_ptid: scope.actorPtid,
        renderer_generation: scope.rendererGeneration,
      },
    },
  );
  const bootIdentitySha256 = result.data?.bootIdentitySha256;
  const sessionGeneration = result.data?.sessionGeneration;
  const sourceCommit = result.data?.sourceCommit;
  const executableSha256 = result.data?.executableSha256;
  const stationRuntimeIdentitySha256 =
    result.data?.stationRuntimeIdentitySha256;
  const stationEndpointSha256 = result.data?.stationEndpointSha256;
  if (
    result.ok !== true
    || typeof bootIdentitySha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(bootIdentitySha256)
    || typeof sessionGeneration !== 'number'
    || !Number.isSafeInteger(sessionGeneration)
    || sessionGeneration < 1
    || sourceCommit !== __PT_SOURCE_COMMIT__
    || typeof executableSha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(executableSha256)
    || typeof stationRuntimeIdentitySha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(stationRuntimeIdentitySha256)
    || typeof stationEndpointSha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(stationEndpointSha256)
  ) {
    throw new Error('moments.acceptance.nativeRuntimeIdentityMissing');
  }
  return {
    bootIdentitySha256,
    sessionGeneration,
    nativeRuntimeIdentitySha256: bootIdentitySha256,
    stationRuntimeIdentitySha256,
    stationEndpointSha256,
    clientArtifactSha256: await sha256(JSON.stringify({
      schemaVersion: 1,
      executableSha256,
      rendererArtifactSha256: await rendererArtifactSha256(),
      sourceCommit: __PT_SOURCE_COMMIT__,
    })),
  };
}

function canonicalJson(value: unknown): string {
  if (
    value === null
    || typeof value === 'boolean'
    || typeof value === 'number'
    || typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  throw new Error('moments.acceptance.canonicalJsonUnsupported');
}

function canonicalTerminalMarker(marker: Omit<StreamTerminalMarker, 'markerDigest'>): string {
  return canonicalJson({
    actionId: marker.actionId,
    captureId: marker.captureId,
    captureIntervalDigest: marker.captureIntervalDigest,
    finalObserverSequence: marker.finalObserverSequence,
    openStreamIdentityDigests: marker.openStreamIdentityDigests,
    runtimeManifestDigest: marker.runtimeManifestDigest,
    schemaVersion: marker.schemaVersion,
  });
}

function terminalPerformanceEntry(marker: StreamTerminalMarker): string {
  const bytes = new TextEncoder().encode(canonicalTerminalMarker(marker));
  const encoded = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `sc-terminal-v1:${encoded}`;
}

class AcceptanceBrowserNetworkObserver {
  private activeCapture: ActiveNetworkCapture | null = null;
  private captureOrdinal = 0;
  private resourceOrdinal = 0;
  private observerSequence = 0;
  private observerQueue: Promise<void> = Promise.resolve();
  private readonly openStreamIdentityDigests = new Set<string>();
  private observedFetch?: typeof fetch;
  private observedWebSocket?: typeof WebSocket;
  private observedEventSource?: typeof EventSource;
  private observedXMLHttpRequest?: typeof XMLHttpRequest;

  install(): void {
    this.installFetchObserver();
    this.installXMLHttpRequestObserver();
    this.installWebSocketObserver();
    this.installEventSourceObserver();
  }

  async begin(actionId: string, runtimeManifestDigest: string) {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(actionId)
      || !/^[0-9a-f]{64}$/.test(runtimeManifestDigest)
    ) {
      throw new Error('moments.acceptance.actionIdInvalid');
    }
    await this.observerQueue;
    if (this.activeCapture) {
      throw new Error('moments.acceptance.captureAlreadyActive');
    }
    this.captureOrdinal += 1;
    const nonce = new Uint8Array(32);
    crypto.getRandomValues(nonce);
    const captureId = await sha256(JSON.stringify({
      schemaVersion: 1,
      actionId,
      ordinal: this.captureOrdinal,
      nonce: Array.from(nonce),
      pageBootIdentity: browserPageBootIdentity,
    }));
    this.activeCapture = {
      actionId,
      captureId,
      eventDigests: [],
      initialObserverSequence: this.observerSequence,
      runtimeManifestDigest,
    };
    return {
      schemaVersion: 1,
      captureId,
      actionId,
      initialObserverSequence: this.observerSequence,
      runtimeManifestDigest,
    };
  }

  finalize(captureId: string, actionId: string): Promise<StreamTerminalMarker> {
    if (
      !/^[0-9a-f]{64}$/.test(captureId)
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(actionId)
    ) {
      return Promise.reject(
        new Error('moments.acceptance.captureIdentityInvalid'),
      );
    }
    const expected = this.activeCapture;
    if (
      !expected
      || expected.captureId !== captureId
      || expected.actionId !== actionId
    ) {
      return Promise.reject(
        new Error('moments.acceptance.captureIdentityMismatch'),
      );
    }
    return new Promise<StreamTerminalMarker>((resolve, reject) => {
      this.observerQueue = this.observerQueue.then(async () => {
        const capture = this.activeCapture;
        if (
          !capture
          || capture.captureId !== captureId
          || capture.actionId !== actionId
        ) {
          throw new Error('moments.acceptance.captureIdentityMismatch');
        }
        if (capture.failure) throw capture.failure;
        this.activeCapture = null;
        const interval = {
          schemaVersion: 1 as const,
          captureId,
          actionId,
          runtimeManifestDigest: capture.runtimeManifestDigest,
          finalObserverSequence: this.observerSequence,
          openStreamIdentityDigests: Object.freeze(
            [...this.openStreamIdentityDigests].sort(),
          ),
        };
        const captureIntervalDigest = await sha256(
          canonicalJson({
            actionId,
            captureId,
            eventDigests: capture.eventDigests,
            finalObserverSequence: this.observerSequence,
            initialObserverSequence: capture.initialObserverSequence,
            openStreamIdentityDigests: interval.openStreamIdentityDigests,
            runtimeManifestDigest: capture.runtimeManifestDigest,
            schemaVersion: 1,
          }),
        );
        const unsignedMarker = {
          ...interval,
          captureIntervalDigest,
        };
        const marker: StreamTerminalMarker = Object.freeze({
          ...unsignedMarker,
          markerDigest: await sha256(
            canonicalTerminalMarker(unsignedMarker),
          ),
        });
        const entryName = terminalPerformanceEntry(marker);
        await new Promise<void>((persisted) => {
          queueMicrotask(() => {
            performance.mark(entryName, { detail: marker });
            persisted();
          });
        });
        resolve(marker);
      }).catch((error) => {
        reject(error);
      });
    });
  }

  private nextResourceIdentity(kind: string, value: string): string {
    this.resourceOrdinal += 1;
    return `${kind}:${this.resourceOrdinal}:${value}`;
  }

  private record(
    kind: string,
    resourceIdentity: string,
    metadata: string,
    streamTransition?: 'open' | 'close',
  ): void {
    this.observerQueue = this.observerQueue.then(async () => {
      this.observerSequence += 1;
      const identityDigest = await sha256(resourceIdentity);
      if (streamTransition === 'open') {
        this.openStreamIdentityDigests.add(identityDigest);
      } else if (streamTransition === 'close') {
        this.openStreamIdentityDigests.delete(identityDigest);
      }
      const capture = this.activeCapture;
      if (!capture) return;
      if (capture.eventDigests.length >= MAX_CAPTURE_EVENT_DIGESTS) {
        capture.failure = new Error(
          'moments.acceptance.networkCaptureEventLimitExceeded',
        );
        return;
      }
      const metadataDigest = await sha256(metadata);
      capture.eventDigests.push(await sha256(canonicalJson({
        schemaVersion: 1,
        captureId: capture.captureId,
        identityDigest,
        kind,
        metadataDigest,
        observerSequence: this.observerSequence,
      })));
    });
  }

  private installFetchObserver(): void {
    const nativeFetch = globalThis.fetch;
    if (typeof nativeFetch !== 'function' || nativeFetch === this.observedFetch) return;
    const observer = this;
    const observed = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const method = (
        init?.method
        || (typeof Request !== 'undefined' && input instanceof Request
          ? input.method
          : 'GET')
      ).toUpperCase();
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      const identity = observer.nextResourceIdentity(
        'http',
        `${method}:${url}`,
      );
      observer.record('http.request', identity, method);
      try {
        const response = await nativeFetch.call(globalThis, input, init);
        observer.record(
          'http.response',
          identity,
          `${response.status}`,
        );
        return response;
      } catch (error) {
        observer.record('http.error', identity, errorName(error));
        throw error;
      }
    }) as typeof fetch;
    this.observedFetch = observed;
    globalThis.fetch = observed;
  }

  private installXMLHttpRequestObserver(): void {
    const NativeXMLHttpRequest = globalThis.XMLHttpRequest;
    if (
      typeof NativeXMLHttpRequest !== 'function'
      || NativeXMLHttpRequest === this.observedXMLHttpRequest
    ) return;
    const observer = this;
    const ObservedXMLHttpRequest = function () {
      const request = new NativeXMLHttpRequest();
      const nativeOpen = request.open.bind(request);
      const nativeSend = request.send.bind(request);
      let identity = '';
      (request as unknown as { open: (...args: unknown[]) => void }).open = (
        ...args: unknown[]
      ) => {
        const method = String(args[0] ?? 'GET').toUpperCase();
        const url = String(args[1] ?? '');
        identity = observer.nextResourceIdentity('xhr', `${method}:${url}`);
        Reflect.apply(nativeOpen, request, args);
      };
      (request as unknown as { send: (...args: unknown[]) => void }).send = (
        ...args: unknown[]
      ) => {
        if (!identity) {
          identity = observer.nextResourceIdentity('xhr', 'UNKNOWN');
        }
        observer.record('http.request', identity, 'XMLHTTPREQUEST');
        request.addEventListener('load', () => {
          observer.record('http.response', identity, `${request.status}`);
        }, { once: true });
        for (const kind of ['error', 'abort', 'timeout'] as const) {
          request.addEventListener(kind, () => {
            observer.record(`http.${kind}`, identity, kind);
          }, { once: true });
        }
        Reflect.apply(nativeSend, request, args);
      };
      return request;
    } as unknown as typeof XMLHttpRequest;
    ObservedXMLHttpRequest.prototype = NativeXMLHttpRequest.prototype;
    Object.setPrototypeOf(ObservedXMLHttpRequest, NativeXMLHttpRequest);
    this.observedXMLHttpRequest = ObservedXMLHttpRequest;
    globalThis.XMLHttpRequest = ObservedXMLHttpRequest;
  }

  private installWebSocketObserver(): void {
    const NativeWebSocket = globalThis.WebSocket;
    if (
      typeof NativeWebSocket !== 'function'
      || NativeWebSocket === this.observedWebSocket
    ) return;
    const observer = this;
    const ObservedWebSocket = function (
      url: string | URL,
      protocols?: string | string[],
    ) {
      const socket = protocols === undefined
        ? new NativeWebSocket(url)
        : new NativeWebSocket(url, protocols);
      const identity = observer.nextResourceIdentity(
        'websocket',
        String(url),
      );
      socket.addEventListener('open', () => {
        observer.record('websocket.open', identity, 'open', 'open');
      });
      socket.addEventListener('message', (event) => {
        observer.record(
          'websocket.frame',
          identity,
          payloadSize(event.data).toString(),
        );
      });
      socket.addEventListener('error', () => {
        observer.record('websocket.error', identity, 'error');
      });
      socket.addEventListener('close', (event) => {
        observer.record(
          'websocket.close',
          identity,
          `${event.code}`,
          'close',
        );
      });
      return socket;
    } as unknown as typeof WebSocket;
    ObservedWebSocket.prototype = NativeWebSocket.prototype;
    Object.setPrototypeOf(ObservedWebSocket, NativeWebSocket);
    for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const) {
      Object.defineProperty(ObservedWebSocket, key, {
        value: NativeWebSocket[key],
      });
    }
    this.observedWebSocket = ObservedWebSocket;
    globalThis.WebSocket = ObservedWebSocket;
  }

  private installEventSourceObserver(): void {
    const NativeEventSource = globalThis.EventSource;
    if (
      typeof NativeEventSource !== 'function'
      || NativeEventSource === this.observedEventSource
    ) return;
    const observer = this;
    const ObservedEventSource = function (
      url: string | URL,
      init?: EventSourceInit,
    ) {
      const source = new NativeEventSource(url, init);
      const identity = observer.nextResourceIdentity(
        'eventsource',
        String(url),
      );
      source.addEventListener('open', () => {
        observer.record('eventsource.open', identity, 'open', 'open');
      });
      source.addEventListener('message', (event) => {
        observer.record(
          'eventsource.frame',
          identity,
          payloadSize(event.data).toString(),
        );
      });
      source.addEventListener('error', () => {
        const closed = source.readyState === EventSource.CLOSED;
        observer.record(
          'eventsource.error',
          identity,
          closed ? 'closed' : 'error',
          closed ? 'close' : undefined,
        );
      });
      const nativeClose = source.close.bind(source);
      source.close = () => {
        observer.record('eventsource.close', identity, 'close', 'close');
        nativeClose();
      };
      return source;
    } as unknown as typeof EventSource;
    ObservedEventSource.prototype = NativeEventSource.prototype;
    Object.setPrototypeOf(ObservedEventSource, NativeEventSource);
    for (const key of ['CONNECTING', 'OPEN', 'CLOSED'] as const) {
      Object.defineProperty(ObservedEventSource, key, {
        value: NativeEventSource[key],
      });
    }
    this.observedEventSource = ObservedEventSource;
    globalThis.EventSource = ObservedEventSource;
  }
}

function payloadSize(value: unknown): number {
  if (typeof value === 'string') return new TextEncoder().encode(value).byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size;
  return 0;
}

function errorName(value: unknown): string {
  return value instanceof Error ? value.name : 'Error';
}

const browserNetworkObserver = new AcceptanceBrowserNetworkObserver();

async function draftEvidence(draft: MomentComposerDraft | null) {
  if (!draft) {
    return {
      present: false,
      fileCount: 0,
      files: [],
    };
  }
  return {
    present: true,
    draftIdSha256: await sha256(draft.draftId),
    revision: draft.revision,
    textSha256: await sha256(draft.text),
    textByteLength: new TextEncoder().encode(draft.text).byteLength,
    audienceKind: audienceName(draft.audience.kind),
    fileCount: draft.files.length,
    files: await Promise.all(draft.files.map(async (file) => ({
      intentIdSha256: await sha256(file.intentId),
      filePathSha256: await sha256(file.filePath),
    }))),
  };
}

async function mediaEvidence(media: PrivateMomentMediaProjection) {
  let plaintextSha256: string | undefined;
  let byteLength: number | undefined;
  if (media.state === 'MEDIA_READY') {
    if (!media.renderUrl) {
      throw new Error('moments.acceptance.readyMediaUrlMissing');
    }
    if (!media.plaintextSha256 || !/^[0-9a-f]{64}$/.test(media.plaintextSha256)) {
      throw new Error('moments.acceptance.readyMediaDigestMissing');
    }
    if (!Number.isSafeInteger(media.plaintextSize) || (media.plaintextSize ?? 0) <= 0) {
      throw new Error('moments.acceptance.readyMediaLengthMissing');
    }
    plaintextSha256 = media.plaintextSha256;
    byteLength = media.plaintextSize;
  }
  return {
    objectIdSha256: await sha256(media.objectId),
    state: media.state,
    mimeType: media.mimeType,
    plaintextSha256,
    byteLength,
  };
}

async function privateProjectionEvidence(
  projection: PrivateMomentProjection,
) {
  const content = projection.content;
  const text = content?.text ?? '';
  return {
    platform: usePrivateMomentsStore.getState().platform,
    state: projection.state,
    errorCode: projection.errorCode,
    postIdSha256: await sha256(projection.postId),
    contentIdSha256: await sha256(projection.contentId),
    authorPtidSha256: projection.authorPtid
      ? await sha256(projection.authorPtid)
      : undefined,
    generationSha256: await sha256(projection.generation),
    audienceKind: projection.audienceKind,
    contentKind: content?.kind,
    textSha256: content ? await sha256(text) : undefined,
    textByteLength: content
      ? new TextEncoder().encode(text).byteLength
      : undefined,
    media: content?.kind === 'IMAGE'
      ? await Promise.all(content.media.map(mediaEvidence))
      : [],
  };
}

function publicPostText(post: Post): string {
  switch (post.content.case) {
    case 'textPost':
    case 'imagePost':
    case 'videoPost':
    case 'linkPost':
    case 'pollPost':
    case 'locationPost':
      return post.content.value.text;
    case 'repostPost':
      return post.content.value.comment;
    default:
      return '';
  }
}

async function publicPostEvidence(post: Post) {
  const text = publicPostText(post);
  const images = post.content.case === 'imagePost'
    ? post.content.value.images
    : [];
  const media = await Promise.all(images.map(async (image) => {
    const resolved = await api.ossResolveUrl(image.url);
    const source = resolved?.data_url || resolved?.url;
    if (!source) {
      throw new Error('moments.acceptance.publicMediaResolveFailed');
    }
    const response = await fetch(source, {
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!response.ok) {
      throw new Error('moments.acceptance.publicMediaFetchFailed');
    }
    const bytes = await response.arrayBuffer();
    return {
      plaintextSha256: await sha256(bytes),
      byteLength: bytes.byteLength,
    };
  }));
  return {
    found: true,
    postIdSha256: await sha256(post.id),
    textSha256: await sha256(text),
    textByteLength: new TextEncoder().encode(text).byteLength,
    media,
  };
}

async function privateCommentEvidence(comment: {
  authorPtid: string;
  commentId: string;
  contentId: string;
  postId: string;
  state: string;
  text: string;
}) {
  return {
    authorPtidSha256: await sha256(comment.authorPtid),
    commentIdSha256: await sha256(comment.commentId),
    contentIdSha256: await sha256(comment.contentId),
    postIdSha256: await sha256(comment.postId),
    state: comment.state,
    textByteLength: new TextEncoder().encode(comment.text).byteLength,
    textSha256: await sha256(comment.text),
  };
}

async function stagePrivateDraft(input: StagePrivateDraftInput) {
  if (
    !input
    || !input.draftId?.trim()
    || !Number.isSafeInteger(input.revision)
    || input.revision < 1
    || !input.text?.trim()
  ) {
    throw new Error('moments.acceptance.invalidDraft');
  }
  useMomentsStore.getState().setComposerDraft({
    draftId: input.draftId,
    revision: input.revision,
    text: input.text,
    audience: privateAudience(input),
    mentions: [],
    files: (input.files ?? []).map((file) => ({
      intentId: file.intentId,
      filePath: file.filePath,
      previewSrc: '',
    })),
  });
  return draftEvidence(useMomentsStore.getState().composerDraft);
}

async function publishPrivateDraft() {
  const moments = useMomentsStore.getState();
  const draft = moments.composerDraft;
  if (!draft) {
    throw new Error('moments.acceptance.draftMissing');
  }
  let transientPostId: string | undefined;
  try {
    transientPostId = await moments.createPost({
      kind: draft.files.length > 0 ? 'image' : 'text',
      text: draft.text,
      imageIds: [],
      localFiles: draft.files,
      audience: draft.audience,
      draftId: draft.draftId,
      draftRevision: draft.revision,
      mentions: draft.mentions,
    });
  } catch {
    // The production store owns the typed failure projection.
  }
  const publish = usePrivateMomentsStore.getState().publish;
  return {
    platform: usePrivateMomentsStore.getState().platform,
    state: publish.state,
    errorCode: publish.errorCode,
    ...(transientPostId
      ? {
          postIdSha256: await sha256(transientPostId),
          transientPostId,
        }
      : {}),
    draft: await draftEvidence(useMomentsStore.getState().composerDraft),
  };
}

export function installAcceptanceHarness(): void {
  rendererArtifactSha256Promise = null;
  browserNetworkObserver.install();
  registerAcceptanceHarness('moments', {
    async snapshot() {
      const privateState = usePrivateMomentsStore.getState();
      const sessionIdentity = await activeSessionIdentity();
      const runtimeIdentity = await nativeRuntimeIdentitySha256(
        privateState.platform,
        privateState.scope,
      );
      return {
        platform: privateState.platform,
        sourceCommit: __PT_SOURCE_COMMIT__,
        authenticationState: sessionIdentity.authenticationState,
        sessionIdentitySha256: sessionIdentity.sessionIdentitySha256,
        ...(sessionIdentity.actorPtid
          ? { actorPtidSha256: await sha256(sessionIdentity.actorPtid) }
          : {}),
        ...runtimeIdentity,
        draft: await draftEvidence(useMomentsStore.getState().composerDraft),
        publishState: privateState.publish.state,
        privateProjectionCount: Object.keys(privateState.postsById).length,
      };
    },

    async stagePrivateDraft(input: StagePrivateDraftInput) {
      return stagePrivateDraft(input);
    },

    async acceptanceActorIdentity() {
      const actorPtid = useSessionStore.getState().currentUser?.actorPtid?.trim();
      if (!actorPtid) {
        throw new Error('moments.acceptance.actorIdentityMissing');
      }
      return { actorPtid };
    },

    async friendshipAuthority() {
      const [self, federationProjection] = await Promise.all([
        api.federationGetSelf(),
        api.federationListFederations(),
      ]);
      const homeStationPeerId = self.homeStationPeerId.trim();
      const federationId = federationProjection.federations
        .map((federation) => federation.federationId.trim())
        .find(Boolean);
      if (!homeStationPeerId || !federationId) {
        throw new Error('moments.acceptance.friendshipAuthorityMissing');
      }
      return { federationId, homeStationPeerId };
    },

    async sendFriendRequest(input: {
      actorPtid: string;
      federationId: string;
      homeStationPeerId: string;
    }) {
      if (
        !input.actorPtid?.trim()
        || !input.federationId?.trim()
        || !input.homeStationPeerId?.trim()
      ) {
        throw new Error('moments.acceptance.actorIdentityMissing');
      }
      const response = await api.socialFriendRequestSend({
        receiverPtid: input.actorPtid,
        receiverHomeStationPeerId: input.homeStationPeerId,
        federationId: input.federationId,
        message: 'secure-content-w7 friendship',
      });
      const requestId = response.request?.requestId.trim();
      if (!requestId) {
        throw new Error('moments.acceptance.friendRequestMissing');
      }
      return { requestId };
    },

    async acceptFriendRequest(input: { actorPtid: string }) {
      if (!input.actorPtid?.trim()) {
        throw new Error('moments.acceptance.actorIdentityMissing');
      }
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const response = await api.socialFriendRequestList(1, 200, 0);
        const request = response.requests.find(
          (candidate) => candidate.sender?.ptid === input.actorPtid,
        );
        if (request) {
          const requestId = request.requestId.trim();
          const senderHomeStationPeerId =
            request.senderHomeStationPeerId.trim();
          const federationId = request.federationId.trim();
          if (!requestId || !senderHomeStationPeerId || !federationId) {
            throw new Error('moments.acceptance.friendRequestInvalid');
          }
          await api.socialFriendRequestAccept({
            requestId,
            senderPtid: input.actorPtid,
            senderHomeStationPeerId,
            federationId,
            message: '',
          });
          return { accepted: true, requestId };
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error('moments.acceptance.friendRequestMissing');
    },

    async createAudienceCircle(input: { name: string }) {
      if (!input.name?.trim()) {
        throw new Error('moments.acceptance.circleNameMissing');
      }
      const circleId = await useMomentsStore.getState().createCircle(input.name);
      return { circleId };
    },

    async addAudienceCircleMember(input: {
      circleId: string;
      actorPtid: string;
    }) {
      if (!input.circleId?.trim() || !input.actorPtid?.trim()) {
        throw new Error('moments.acceptance.circleMemberInvalid');
      }
      await useMomentsStore.getState().addCircleMember(
        input.circleId,
        input.actorPtid,
      );
      return { added: true };
    },

    async stageFriendsDraft(input: StagePrivateDraftInput) {
      return stagePrivateDraft({ ...input, audienceKind: 'FRIENDS' });
    },

    async publishPrivateDraft() {
      return publishPrivateDraft();
    },

    async publishFriendsDraft() {
      return publishPrivateDraft();
    },

    async readPrivateMoment(input: PrivateMomentInput) {
      if (!input?.postId?.trim()) {
        throw new Error('moments.acceptance.postIdMissing');
      }
      const store = usePrivateMomentsStore.getState();
      await store.readMoment(input.postId);
      let projection = usePrivateMomentsStore.getState().postsById[input.postId];
      if (!projection) {
        throw new Error('moments.acceptance.privateProjectionMissing');
      }
      if (input.openMedia && projection.content?.kind === 'IMAGE') {
        for (const media of projection.content.media) {
          await usePrivateMomentsStore.getState().openMedia(
            input.postId,
            media.objectId,
          );
        }
        projection = usePrivateMomentsStore.getState().postsById[input.postId];
      }
      if (!projection) {
        throw new Error('moments.acceptance.privateProjectionMissing');
      }
      return privateProjectionEvidence(projection);
    },

    async recoverPrivateMoment(input: PrivateMomentInput) {
      if (!input?.postId?.trim()) {
        throw new Error('moments.acceptance.postIdMissing');
      }
      const store = usePrivateMomentsStore.getState();
      await store.recoverMoment(input.postId);
      const projection = usePrivateMomentsStore.getState().postsById[input.postId];
      if (!projection) {
        throw new Error('moments.acceptance.privateProjectionMissing');
      }
      return privateProjectionEvidence(projection);
    },

    async submitPrivateComment(input: {
      postId: string;
      text: string;
    }) {
      if (!input?.postId?.trim() || !input?.text?.trim()) {
        throw new Error('moments.acceptance.privateCommentInvalid');
      }
      const store = usePrivateCommentsStore.getState();
      await store.submitComment(input.postId, input.text);
      const thread = selectPrivateCommentThread(
        usePrivateCommentsStore.getState(),
        input.postId,
      );
      const comment = [...thread.comments]
        .reverse()
        .find((candidate) => candidate.text === input.text);
      if (!comment) {
        throw new Error('moments.acceptance.privateCommentProjectionMissing');
      }
      return privateCommentEvidence(comment);
    },

    async readPrivateComments(input: {
      postId: string;
      refresh?: boolean;
    }) {
      if (!input?.postId?.trim()) {
        throw new Error('moments.acceptance.postIdMissing');
      }
      const store = usePrivateCommentsStore.getState();
      try {
        await store.loadComments(input.postId, input.refresh !== false);
      } catch {
        // The production store owns the typed failure projection.
      }
      const thread = selectPrivateCommentThread(
        usePrivateCommentsStore.getState(),
        input.postId,
      );
      return {
        comments: await Promise.all(thread.comments.map(privateCommentEvidence)),
        errorCode: thread.errorCode,
        hasMore: thread.hasMore,
        loaded: thread.loaded,
        state: thread.state,
      };
    },

    async findPublicMoment(input: PublicMomentInput) {
      if (!input?.text?.trim()) {
        throw new Error('moments.acceptance.publicTextMissing');
      }
      const store = useMomentsStore.getState();
      await store.loadFeed('explore', { refresh: true, sort: 'recent' });
      const current = useMomentsStore.getState();
      const post = current.feeds.explore.postIds
        .map((postId) => current.postsById[postId])
        .find((candidate) => candidate && publicPostText(candidate) === input.text);
      if (!post) {
        return {
          found: false,
          textSha256: await sha256(input.text),
          media: [],
        };
      }
      return publicPostEvidence(post);
    },

    async publishPublicMoment(input: PublicMomentInput) {
      if (!input?.text?.trim()) {
        throw new Error('moments.acceptance.publicTextMissing');
      }
      const audience = create(AudienceSchema, { kind: Audience_Kind.PUBLIC });
      let postId: string;
      if (input.filePath) {
        const uploaded = await api.ossUploadEncryptedAttachmentSocial(
          input.filePath,
        );
        if (!uploaded?.cid) {
          throw new Error('moments.acceptance.publicMediaUploadFailed');
        }
        postId = await useMomentsStore.getState().createPost({
          kind: 'image',
          text: input.text,
          imageIds: [uploaded.cid],
          audience,
        });
      } else {
        postId = await useMomentsStore.getState().createPost({
          kind: 'text',
          text: input.text,
          audience,
        });
      }
      return {
        published: true,
        mediaCount: input.filePath ? 1 : 0,
        transientPostId: postId,
        postIdSha256: await sha256(postId),
        textSha256: await sha256(input.text),
      };
    },

    async clearLocalState() {
      const moments = useMomentsStore.getState();
      moments.clearComposerDraft();
      const privateMoments = usePrivateMomentsStore.getState();
      privateMoments.clearPublishState();
      return {
        draftPresent: useMomentsStore.getState().composerDraft !== null,
        publishState: usePrivateMomentsStore.getState().publish.state,
      };
    },

    async beginNetworkCapture(input: {
      actionId: string;
      runtimeManifestDigest: string;
    }) {
      if (
        !input?.actionId?.trim()
        || !input?.runtimeManifestDigest?.trim()
      ) {
        throw new Error('moments.acceptance.actionIdMissing');
      }
      return browserNetworkObserver.begin(
        input.actionId,
        input.runtimeManifestDigest,
      );
    },

    async emitTerminalMarker(input: {
      captureId: string;
      actionId: string;
    }) {
      if (!input?.captureId?.trim() || !input?.actionId?.trim()) {
        throw new Error('moments.acceptance.captureIdentityMissing');
      }
      return browserNetworkObserver.finalize(input.captureId, input.actionId);
    },
  });
}
