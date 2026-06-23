import { api, pickLatestKeyExchangeBundle } from '../../services/desktop_api';
import { eventBus } from '../../kernel/events/bus';
import { EVENT } from '../../kernel/events/catalog';
import type {
  RealtimeCallSignalKind,
  RealtimeCallSignalPayload,
} from '../../kernel/events/types';
import { log } from '../../utils/logger';

// Historical context (kept verbose deliberately — this module used to
// be the data-plane and the deletion is non-obvious from `git blame`):
//
// Until the realtime SSE EventBus landed (see
// docs/architecture/realtime/event-stream.md), the WebRTC DataChannel
// here doubled as a "fast path" for friend-chat text: the sender
// pushed a `MessageEnvelope` protobuf hint over the DC so the peer
// could trigger an immediate `friendChatSync` without waiting for the
// 60s safety-net poll. That path was inherently unreliable because:
//
//   1. WebRTC trickle-ICE on relay-only paths can take seconds to
//      settle, and the *first* message of a freshly-opened
//      conversation always lost the race.
//   2. Multi-device fan-out (one user with N devices) has no DC to
//      send over for the (N-1) devices that didn't initiate the
//      WebRTC pair.
//   3. The DC can silently die on NAT rebinding without firing
//      `connectionstatechange`, which left the UI thinking it had
//      real-time delivery when it didn't.
//
// SSE solves all three: the canonical event stream is server-fanned,
// reaches every active session of every participant, and is observed
// to be alive via heartbeat. The DC remains here purely for future
// voice/video media; it no longer carries text.
//
// ---------------------------------------------------------------------
// Phase 8 (2026-04): WebRTC SIGNALING also moved to SSE.
//
// Until commit e36911ca, signaling (offer / answer / ICE candidate)
// flowed over a separate HTTP polling subserver
// (`/api/v1/ice/session/...`). Every browser opened ~1 req/s per
// active conversation just to poll for candidates that almost never
// arrived. Worse, that path was clear-text — Station could observe
// every SDP and ICE candidate, including TURN credentials and
// internal IP addresses leaked through srflx candidates.
//
// The replacement (contract §2.7) wraps every signaling frame in a
// stateless authenticated sealed-box envelope (X25519 + HKDF +
// AES-256-GCM with AAD binding session_ulid and kind), publishes
// over `POST /realtime/signal`, and Station fans it out via the same
// SSE stream that already carries chat traffic. Station treats the
// payload as opaque — it never holds the keys. Out-of-order tolerance
// (each envelope is independently sealed) is essential because ICE
// candidates legitimately arrive out of order; the chat ratchet would
// have stalled the entire conversation on a single dropped candidate.
//
// One subtle invariant: peer's long-term Ed25519 identity public key
// (its *non-DH* form) is required by both seal() and open(). We rely
// on the existing X3DH bundle exchange to surface it via
// `api.keyExchangeFetchBundle(did)` and `pickLatestKeyExchangeBundle`, caching the IK
// so a chatty conversation doesn't hammer Station once per signal.
// First-contact trust is identical to the existing chat-establishment
// trust (same Station, same endpoint, same X3DH bundle), so this does
// not enlarge the threat model.
// ---------------------------------------------------------------------

export type FriendChatP2pState = 'idle' | 'connecting' | 'connected' | 'failed' | 'closed';

/**
 * Which ICE candidate pair the established RTCPeerConnection is actually
 * using. `null` while the pair has not been selected yet (or the connection
 * never reached `connected`). The naming follows WebRTC's own taxonomy:
 *
 *   - `direct` = host / srflx / prflx — UDP/TCP path between the two peers
 *   - `relay`  = both sides talk through a TURN allocation
 *
 * Calls use this to distinguish direct media from TURN relay. Text
 * messages are delivered by the canonical realtime SSE stream; WebRTC
 * here is only the call/signaling transport surface.
 */
export type FriendChatP2pTransport = 'direct' | 'relay' | null;

export interface FriendChatP2pStatus {
  state: FriendChatP2pState;
  detail?: string;
  signalingSessionId?: string;
  transport?: FriendChatP2pTransport;
}

function normalizePair(a: string, b: string): [string, string] {
  return a.localeCompare(b) <= 0 ? [a, b] : [b, a];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `(myDid, peerDid)` → stable signaling-session id agreed by both ends.
 *  We keep the legacy `${a}-${b}` shape so cross-version peers (mid-rollout)
 *  agree on AAD binding without renegotiation. */
function deriveSignalingSessionId(myDid: string, peerDid: string): string {
  const [a, b] = normalizePair(myDid, peerDid);
  return `${a}-${b}`;
}

/**
 * Inspect an RTCStatsReport for the in-use ICE candidate pair and return
 * which transport flavour it represents. Returns `null` while the pair
 * has not been selected yet.
 *
 * The traversal mirrors what Chrome devtools' `chrome://webrtc-internals`
 * does: find the `candidate-pair` whose `nominated && (selected ||
 * state === 'succeeded')` flag is set, then follow `localCandidateId`.
 * `candidateType === 'relay'` means TURN relay; everything else
 * (`host`, `srflx`, `prflx`) is a direct path.
 */
function pickTransportFromStats(stats: RTCStatsReport): FriendChatP2pTransport {
  let selectedPairId: string | null = null;
  const candidates = new Map<string, RTCStats & { candidateType?: string }>();
  for (const stat of stats.values()) {
    const s = stat as any;
    if (s.type === 'candidate-pair') {
      const isSelected = s.selected === true ||
        (s.nominated === true && (s.state === 'succeeded' || s.state === 'in-progress'));
      if (isSelected) {
        selectedPairId = s.localCandidateId || null;
      }
    } else if (s.type === 'local-candidate' || s.type === 'remote-candidate') {
      if (s.id) candidates.set(s.id, s);
    }
  }
  if (!selectedPairId) return null;
  const local = candidates.get(selectedPairId);
  const candidateType = (local as any)?.candidateType;
  if (!candidateType) return null;
  return candidateType === 'relay' ? 'relay' : 'direct';
}

// ── Peer identity-key cache ──
// Long-term Ed25519 identity public keys (base64) keyed by DID. Filled
// lazily on first need from `keyExchangeFetchBundle` + `pickLatestKeyExchangeBundle`.
// rotates per actor, so an in-process cache is sufficient; if a peer
// publishes a new bundle, the user-visible "fingerprint mismatch"
// detection on chat-message decryption will catch it before signaling
// becomes a problem.
const peerIkCache = new Map<string, string>();
const peerIkInflight = new Map<string, Promise<string>>();

async function loadPeerIk(peerDid: string): Promise<string> {
  const cached = peerIkCache.get(peerDid);
  if (cached) return cached;
  const inflight = peerIkInflight.get(peerDid);
  if (inflight) return inflight;
  const promise = (async () => {
    try {
      const resp = await api.keyExchangeFetchBundle(peerDid);
      const bundle = pickLatestKeyExchangeBundle(resp);
      const ik = String(bundle?.ik_pub || '').trim();
      if (!ik) {
        throw new Error(`peer ${peerDid} has no published ik_pub`);
      }
      peerIkCache.set(peerDid, ik);
      return ik;
    } finally {
      peerIkInflight.delete(peerDid);
    }
  })();
  peerIkInflight.set(peerDid, promise);
  return promise;
}

// ── base64 helpers (no Buffer in browser/Tauri webview) ──
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  // Process in 8 KiB chunks to avoid `String.fromCharCode(...huge)` stack overflow.
  const CHUNK = 8192;
  for (let i = 0; i < len; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, len));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

type ConnKey = string; // `${myDid}::${peerDid}`

/** Ringing state of an in-flight call on this connection. */
export type CallStateLifecycle =
  | 'idle'
  | 'outgoing'      // we sent CALL_REQUEST, waiting for accept/reject
  | 'incoming'      // peer sent CALL_REQUEST, waiting for our accept/reject
  | 'active'        // call accepted, media flowing (or about to)
  | 'reconnecting'  // ICE dropped on an active call; attempting recovery
  | 'ended';        // CALL_END seen — terminal until next startCall

export type CallMediaKind = 'audio' | 'video';

/** A selectable microphone or camera. `label` is the human-readable
 *  device name (empty until the user has granted a media permission);
 *  `deviceId` is an opaque handle used only internally — it is never
 *  surfaced in the UI (voice-video-calls.md §10). */
export interface CallMediaDevice {
  deviceId: string;
  label: string;
}

/** Available input devices, split by kind for the picker. */
export interface CallMediaDevices {
  audioInputs: CallMediaDevice[];
  videoInputs: CallMediaDevice[];
}

/**
 * Why a terminal (`ended`) call snapshot ended, so the UI can render a
 * distinct, localized result instead of a generic "call ended". Phase 1
 * acceptance (voice-video-calls.md §11) requires rejected / missed /
 * canceled / permission-denied / network-failed to be visually distinct.
 *
 *   - `hangup`        — a participant ended an active call normally.
 *   - `rejected`      — the callee explicitly declined.
 *   - `no-answer`     — ringing elapsed the unanswered timeout.
 *   - `busy`          — the callee was already in another call.
 *   - `canceled`      — the caller canceled their own outgoing ring.
 *   - `media-failed`  — local mic/camera permission or capture failed.
 *   - `network-failed`— the WebRTC connection failed irrecoverably.
 *   - `handled-elsewhere` — a sibling device of ours answered or declined
 *                     the same ringing call, so this device silently
 *                     stops ringing (multi-device convergence, §11).
 */
export type CallEndReason =
  | 'hangup'
  | 'rejected'
  | 'no-answer'
  | 'busy'
  | 'canceled'
  | 'media-failed'
  | 'network-failed'
  | 'handled-elsewhere';

/** Unanswered outgoing/incoming calls auto-terminate after this many ms.
 *  Matches the industry-common 45s ring window (voice-video-calls.md §14). */
const RING_TIMEOUT_MS = 45_000;

/** How long an active call may stay in `reconnecting` before we give up
 *  and end it with `network-failed`. WebRTC's own ICE timers fire on the
 *  order of seconds; 20s is a generous bound that covers a brief Wi-Fi /
 *  cellular handover without leaving a frozen HUD forever
 *  (voice-video-calls.md §6.5). */
const RECONNECT_TIMEOUT_MS = 20_000;

/** How often we poll `getStats()` for live call-quality metrics while a
 *  call is active. 2s is frequent enough to reflect a degrading link
 *  without flooding the main thread with stats traversals. */
const QUALITY_PROBE_INTERVAL_MS = 2_000;

/** Coarse, user-facing connection-quality grade derived from packet loss
 *  and round-trip time. Deliberately a small enum — the HUD shows a
 *  bars-style indicator, not raw numbers, and we never surface SDP /
 *  candidate addresses (voice-video-calls.md §10). */
export type CallQualityLevel = 'good' | 'fair' | 'poor';

/** Diagnostics for an active call, refreshed on the quality probe tick.
 *  All fields are derived aggregate metrics — none reveal SDP, candidate
 *  addresses, tokens, or PII (voice-video-calls.md §10, §11). */
export interface CallQuality {
  level: CallQualityLevel;
  /** Smoothed round-trip time in milliseconds, if the browser reports it. */
  rttMs?: number;
  /** Inbound packet-loss fraction in [0, 1] over the call so far. */
  packetLoss?: number;
}

/** LocalStorage keys for the last device the user picked. We persist the
 *  preference so the next call reuses the same mic/camera instead of
 *  silently reverting to the OS default. Values are opaque deviceIds and
 *  are never rendered (voice-video-calls.md §10). */
const PREFERRED_AUDIO_DEVICE_KEY = 'pt.call.preferredAudioDeviceId';
const PREFERRED_VIDEO_DEVICE_KEY = 'pt.call.preferredVideoDeviceId';

function readPreferredDevice(key: string): string | undefined {
  try {
    return window.localStorage.getItem(key) || undefined;
  } catch {
    return undefined;
  }
}

function writePreferredDevice(key: string, deviceId: string | undefined): void {
  try {
    if (deviceId) window.localStorage.setItem(key, deviceId);
    else window.localStorage.removeItem(key);
  } catch {
    /* best-effort — a missing preference just falls back to OS default */
  }
}

/** Build a `getUserMedia` constraint set honouring an optional preferred
 *  device. An explicit `deviceId` is requested as `ideal` rather than
 *  `exact` so a now-unplugged device degrades to the OS default instead
 *  of throwing `OverconstrainedError`. */
function buildMediaConstraints(
  wantVideo: boolean,
  audioDeviceId?: string,
  videoDeviceId?: string,
): MediaStreamConstraints {
  const audio: MediaTrackConstraints | boolean = audioDeviceId
    ? { deviceId: { ideal: audioDeviceId } }
    : true;
  const video: MediaTrackConstraints | boolean = !wantVideo
    ? false
    : videoDeviceId
      ? { deviceId: { ideal: videoDeviceId } }
      : true;
  return { audio, video };
}

export interface CallSnapshot {
  /** Stable per-call identifier — the originator generates a ULID
   *  in CALL_REQUEST and both ends echo it on every signal. Allows
   *  us to ignore stale CALL_REJECT for an already-ended call. */
  callId: string;
  /** Audio-only or audio+video. The receiver decides whether to
   *  enable their camera based on this hint; both sides can later
   *  toggle their own video independently. */
  mediaKind: CallMediaKind;
  state: CallStateLifecycle;
  /** Wall-clock ms when the call entered `active`. */
  startedAt?: number;
  /** Local-side media tracks. Held so we can stop them on hangup
   *  (otherwise the camera light stays on until the page reloads). */
  localStream?: MediaStream;
  /** Remote tracks aggregated as they arrive. */
  remoteStream?: MediaStream;
  /** True after the user explicitly toggled their mic mute. */
  micMuted?: boolean;
  /** True after the user explicitly toggled their camera off. */
  cameraOff?: boolean;
  /** Device id of the microphone currently captured, if a specific one
   *  was selected (otherwise the OS default is used). Internal only —
   *  never rendered. */
  audioDeviceId?: string;
  /** Device id of the camera currently captured, if a specific one was
   *  selected. Internal only — never rendered. */
  videoDeviceId?: string;
  /** Populated only on the terminal `ended` snapshot so the UI can
   *  render a distinct, localized result (declined / missed / etc.). */
  endReason?: CallEndReason;
}

interface Conn {
  myDid: string;
  peerDid: string;
  signalingSessionId: string;
  isOfferer: boolean;
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  status: FriendChatP2pStatus;
  /** Remote candidates that arrived before `setRemoteDescription` had
   *  finished. WebRTC will reject `addIceCandidate` until the remote
   *  description is in place; rather than dropping them silently
   *  (which is what the old polling loop did and which caused the
   *  occasional "connecting forever" hang), we buffer and replay. */
  pendingRemoteCandidates: Array<{ candidate: string; mid?: string; mline?: number }>;
  remoteDescriptionApplied: boolean;
  /** Stop flag for the {@link transportProbeLoop} once the connection terminates. */
  transportProbeStopped: boolean;
  /** Current call ringing / media state for this peer connection.
   *  Voice and video calls reuse the existing RTCPeerConnection
   *  (same ICE pair, same envelope crypto) and bolt media tracks
   *  on top of the data-channel connection kept for call readiness. */
  call: CallSnapshot;
  /** RTP receivers we've added an `ontrack` listener to, keyed
   *  by `RTCRtpReceiver.track.id`, so we don't double-attach
   *  remote tracks to the snapshot's `remoteStream`. */
  remoteTrackIds: Set<string>;
  /** Pending unanswered-ring timeout handle. Armed while a call is
   *  `outgoing` / `incoming`, cleared the moment it is answered or
   *  terminated. `null` when no ring is in flight. */
  ringTimer: ReturnType<typeof setTimeout> | null;
  /** Pending reconnect-window timeout handle. Armed when an active call
   *  drops to `reconnecting`, cleared when ICE recovers or the call ends.
   *  `null` when the call is not reconnecting. */
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

class FriendChatP2pManager {
  private conns = new Map<ConnKey, Conn>();
  private onStatus: ((myDid: string, peerDid: string, status: FriendChatP2pStatus) => void) | null = null;
  private onCall: ((myDid: string, peerDid: string, snapshot: CallSnapshot) => void) | null = null;
  private signalSubscription: (() => void) | null = null;

  setOnStatus(handler: ((myDid: string, peerDid: string, status: FriendChatP2pStatus) => void) | null) {
    this.onStatus = handler;
  }

  /** Listen for call lifecycle changes (ringing in / out, accepted,
   *  ended) so the chat UI can render its modal + HUD. The manager
   *  emits a fresh snapshot whenever any field of `Conn.call`
   *  changes — consumers should snapshot defensively (the object
   *  identity is stable across emits, so `useState({...snapshot})`
   *  is the right pattern). */
  setOnCall(handler: ((myDid: string, peerDid: string, snapshot: CallSnapshot) => void) | null) {
    this.onCall = handler;
  }

  private emitStatus(myDid: string, peerDid: string, status: FriendChatP2pStatus) {
    this.onStatus?.(myDid, peerDid, status);
  }

  private emitCall(conn: Conn) {
    this.onCall?.(conn.myDid, conn.peerDid, { ...conn.call });
  }

  /** Arm the unanswered-ring timeout for a freshly-ringing call. If the
   *  call is still ringing (`outgoing` / `incoming`) when the window
   *  elapses, the caller side notifies the peer with CALL_END and both
   *  sides tear down with a `no-answer` result. Re-arming clears any
   *  previous timer so a renegotiation can't leak handles. */
  private armRingTimeout(conn: Conn): void {
    this.clearRingTimeout(conn);
    const callId = conn.call.callId;
    conn.ringTimer = setTimeout(() => {
      conn.ringTimer = null;
      // Only fire if the very same call is still ringing — accept /
      // reject / hangup all clear the timer, but a late callback can
      // still race a state change.
      if (conn.call.callId !== callId) return;
      if (conn.call.state !== 'outgoing' && conn.call.state !== 'incoming') return;
      // The originator (outgoing side) owns the missed-call notification
      // so the peer's ringing UI clears too; the callee just tears down
      // its own incoming ring locally.
      if (conn.call.state === 'outgoing') {
        this.sendSignal(conn, 'CALL_END', JSON.stringify({ callId })).catch(() => {});
      }
      this.teardownCallLocal(conn, 'no-answer');
    }, RING_TIMEOUT_MS);
  }

  /** Cancel a pending ring timeout, if any. Safe to call repeatedly. */
  private clearRingTimeout(conn: Conn): void {
    if (conn.ringTimer !== null) {
      clearTimeout(conn.ringTimer);
      conn.ringTimer = null;
    }
  }

  /**
   * Move an active call into `reconnecting` and attempt to recover the
   * media path (voice-video-calls.md §6.5).
   *
   * We keep local tracks alive and the HUD visible, fire a single ICE
   * restart from the offerer side (the only side that may renegotiate in
   * our perfect-negotiation setup), and arm a bounded give-up timer. If
   * `connectionState` returns to `connected` before the timer fires,
   * `recoverReconnectingCall` cancels it and restores `active`; otherwise
   * the call ends with a localized `network-failed`.
   *
   * Idempotent: a `disconnected` followed by `failed` (WebRTC emits both)
   * must not stack timers or fire two restarts.
   */
  private enterReconnectingCall(conn: Conn): void {
    if (conn.call.state === 'reconnecting') return;
    conn.call = { ...conn.call, state: 'reconnecting' };
    this.emitCall(conn);

    // Only the offerer may drive renegotiation; the answerer waits for
    // the restart OFFER to arrive over the (reliable) SSE signaling path.
    if (conn.isOfferer) {
      void (async () => {
        try {
          const offer = await conn.pc.createOffer({ iceRestart: true });
          await conn.pc.setLocalDescription(offer);
          await this.sendSignal(conn, 'OFFER', JSON.stringify({ sdp: offer.sdp || '' }));
        } catch (error) {
          log.warn('p2p', 'ICE restart offer failed', error);
        }
      })();
    }

    if (conn.reconnectTimer !== null) return;
    const callId = conn.call.callId;
    conn.reconnectTimer = setTimeout(() => {
      conn.reconnectTimer = null;
      // Only give up if the very same call is still reconnecting — a late
      // recovery can race this callback.
      if (conn.call.callId !== callId) return;
      if (conn.call.state !== 'reconnecting') return;
      this.sendSignal(conn, 'CALL_END', JSON.stringify({ callId })).catch(() => {});
      this.teardownCallLocal(conn, 'network-failed');
    }, RECONNECT_TIMEOUT_MS);
  }

  /** ICE recovered while reconnecting: cancel the give-up timer and
   *  restore the active HUD. The `startedAt` is preserved so the call
   *  timer keeps counting from the original answer. */
  private recoverReconnectingCall(conn: Conn): void {
    this.clearReconnectTimeout(conn);
    if (conn.call.state !== 'reconnecting') return;
    conn.call = { ...conn.call, state: 'active' };
    this.emitCall(conn);
  }

  /** Cancel a pending reconnect give-up timeout, if any. */
  private clearReconnectTimeout(conn: Conn): void {
    if (conn.reconnectTimer !== null) {
      clearTimeout(conn.reconnectTimer);
      conn.reconnectTimer = null;
    }
  }

  /** Generate a 26-char Crockford-base32 ULID without pulling in an
   *  external dep. Time-prefixed so it's roughly sortable and
   *  collision-resistant for the 16-byte random tail. */
  private newCallId(): string {
    const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const time = Date.now();
    const tBytes = new Uint8Array(6);
    let t = time;
    for (let i = 5; i >= 0; i--) {
      tBytes[i] = t & 0xff;
      t = Math.floor(t / 256);
    }
    const rand = new Uint8Array(10);
    crypto.getRandomValues(rand);
    const all = new Uint8Array(16);
    all.set(tBytes, 0);
    all.set(rand, 6);
    // Encode 16 bytes (128 bits) as 26 chars of base32.
    let out = '';
    for (let i = 0; i < 26; i++) {
      const bitOffset = i * 5;
      const byteIdx = Math.floor(bitOffset / 8);
      const bitInByte = bitOffset % 8;
      const hi = all[byteIdx] ?? 0;
      const lo = all[byteIdx + 1] ?? 0;
      const val = ((hi << 8) | lo) >>> (16 - 5 - bitInByte);
      out += ALPHABET[val & 0x1f];
    }
    return out;
  }

  /**
   * Subscribe to the realtime SSE stream's signaling channel exactly
   * once per process. The subscription stays live for the entire app
   * lifetime — even after `closeAll()` — because the cost is one
   * eventBus listener and otherwise we'd race the next `ensureConnected`
   * call against a freshly-arriving offer (peer reconnects, sends offer
   * before our resubscribe lands).
   */
  private ensureSignalSubscription() {
    if (this.signalSubscription) return;
    this.signalSubscription = eventBus.subscribe(
      EVENT.REALTIME_CALL_SIGNAL,
      (payload) => {
        // Fire-and-forget — eventBus listeners are sync. Errors inside
        // the async handler are logged, never propagated.
        this.handleInboundSignal(payload).catch((error) => {
          log.warn('p2p', 'inbound signal handler crashed', error);
        });
      },
    );
  }

  /**
   * Mount-time priming hook called once per session from
   * SocialChatPage.tsx. Historically this also published a
   * presence/role hint to Station's `/api/v1/ice/peer/register`
   * endpoint so the dashboard could observe transport state. That
   * endpoint and the entire signaling subserver were removed in 8.3c
   * — presence is now carried by the realtime SSE PresenceFlip event,
   * and transport observability moved to the Realtime page. The
   * function survives only to make sure the `ensureSignalSubscription`
   * side effect runs *before* the first conversation is opened, so
   * the SSE inbound path is wired by the time an OFFER lands.
   */
  async ensurePeerRegistered(myDid: string): Promise<void> {
    if (!myDid.trim()) return;
    this.ensureSignalSubscription();
  }

  async ensureConnected(myDid: string, peerDid: string): Promise<FriendChatP2pStatus> {
    const key: ConnKey = `${myDid}::${peerDid}`;
    const existing = this.conns.get(key);
    if (existing && (existing.status.state === 'connecting' || existing.status.state === 'connected')) {
      return existing.status;
    }

    this.ensureSignalSubscription();

    const signalingSessionId = deriveSignalingSessionId(myDid, peerDid);
    const status: FriendChatP2pStatus = { state: 'connecting', signalingSessionId };
    this.emitStatus(myDid, peerDid, status);

    const isOfferer = myDid === normalizePair(myDid, peerDid)[0];

    let iceServers: any[] = [];
    try {
      const cfg = await api.iceGetServers();
      iceServers = (cfg as any)?.ice_servers || [];
    } catch (error) {
      // TURN not available; still try with no ICE servers (may work on LAN).
      log.warn('p2p', 'iceGetServers failed, continuing without TURN', error);
    }

    // Pre-warm peer identity key so the first outbound candidate (which
    // is gathered the instant `setLocalDescription` lands) doesn't pay
    // the round-trip latency. Failure is fatal: we cannot encrypt
    // signaling without it.
    try {
      await loadPeerIk(peerDid);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const failed: FriendChatP2pStatus = {
        state: 'failed',
        detail: `peer key unavailable: ${detail}`,
        signalingSessionId,
      };
      this.emitStatus(myDid, peerDid, failed);
      return failed;
    }

    const pc = new RTCPeerConnection({ iceServers });
    const conn: Conn = {
      myDid,
      peerDid,
      signalingSessionId,
      isOfferer,
      pc,
      dc: null,
      status,
      pendingRemoteCandidates: [],
      remoteDescriptionApplied: false,
      transportProbeStopped: false,
      call: { callId: '', mediaKind: 'audio', state: 'idle' },
      remoteTrackIds: new Set(),
      ringTimer: null,
      reconnectTimer: null,
    };
    this.conns.set(key, conn);

    // Aggregate inbound media tracks into a single MediaStream we can
    // hand to <video>/<audio>.srcObject. WebRTC fires `ontrack` once
    // per remote track; the first call creates the stream and
    // subsequent ones append. Tracks are removed on `mute` (peer
    // toggled their camera) but the stream stays around so the UI
    // can render a "camera off" placeholder without unmounting the
    // video element.
    pc.ontrack = (ev) => {
      const track = ev.track;
      if (conn.remoteTrackIds.has(track.id)) return;
      conn.remoteTrackIds.add(track.id);
      const stream = conn.call.remoteStream ?? new MediaStream();
      stream.addTrack(track);
      track.onended = () => {
        try { stream.removeTrack(track); } catch { /* best-effort */ }
        conn.remoteTrackIds.delete(track.id);
        // Don't down-state the call here — the peer might be just
        // toggling video off; let CALL_END / HANGUP drive teardown.
        this.emitCall(conn);
      };
      conn.call = { ...conn.call, remoteStream: stream };
      this.emitCall(conn);
    };

    // Renegotiation: adding/removing media tracks after the initial
    // SDP requires a fresh OFFER. We only let the impolite side
    // (offerer) start renegotiation — the polite side answers. That
    // matches Mozilla's "perfect negotiation" pattern minus the
    // collision recovery, which we don't need because our
    // signaling channel is reliable+ordered per kind (SSE).
    pc.onnegotiationneeded = () => {
      if (!conn.isOfferer) return;
      // Skip if the connection isn't even open yet — the initial
      // offer in `ensureConnected` will pick this state up.
      if (pc.signalingState !== 'stable') return;
      void (async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await this.sendSignal(conn, 'OFFER', JSON.stringify({ sdp: offer.sdp || '' }));
        } catch (error) {
          log.warn('p2p', 'renegotiation offer failed', error);
        }
      })();
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') {
        // Spin up the transport probe so we can distinguish P2P-direct
        // from TURN-relay; emit an interim status while the probe runs
        // (`transport: null` means "connected but path not yet known").
        conn.status = { state: 'connected', signalingSessionId, transport: null };
        this.emitStatus(myDid, peerDid, conn.status);
        // ICE recovered: if a call was riding through a reconnect window,
        // restore the active HUD and cancel the give-up timer
        // (voice-video-calls.md §6.5).
        if (conn.call.state === 'reconnecting') {
          this.recoverReconnectingCall(conn);
        }
        conn.transportProbeStopped = false;
        this.startTransportProbe(myDid, peerDid, conn);
      } else if (s === 'disconnected') {
        // A transient ICE drop on an active call. Keep the UI and local
        // tracks alive and attempt recovery within a bounded window
        // before declaring failure (voice-video-calls.md §6.5). Ringing
        // calls (no media yet) are left for the ring timeout to resolve.
        if (conn.call.state === 'active') {
          this.enterReconnectingCall(conn);
        }
      } else if (s === 'failed') {
        // ICE failed outright. Try a single ICE restart if we can still
        // reach TURN; only give up (network-failed) when that path is
        // exhausted. The restart re-enters `reconnecting` so the timer
        // bounds the recovery attempt.
        if (conn.call.state === 'active' || conn.call.state === 'reconnecting') {
          this.enterReconnectingCall(conn);
          return;
        }
        conn.transportProbeStopped = true;
        conn.status = { state: 'failed', detail: 'webrtc connection failed', signalingSessionId };
        this.emitStatus(myDid, peerDid, conn.status);
        if (conn.call.state === 'outgoing' || conn.call.state === 'incoming') {
          this.teardownCallLocal(conn, 'network-failed');
        }
      } else if (s === 'closed') {
        conn.transportProbeStopped = true;
        conn.status = { state: 'closed', signalingSessionId };
        this.emitStatus(myDid, peerDid, conn.status);
      }
    };

    const bindDataChannel = (dc: RTCDataChannel) => {
      conn.dc = dc;
      dc.binaryType = 'arraybuffer';
      dc.onopen = () => {
        log.info('p2p', 'datachannel open', { peerDid, signalingSessionId });
        // Preserve any transport the probe may have already resolved —
        // `dc.onopen` and `connectionstate==='connected'` race, and
        // re-emitting without `transport` would briefly flicker the UI
        // back to "connected (unknown path)".
        conn.status = {
          state: 'connected',
          signalingSessionId,
          transport: conn.status.transport ?? null,
        };
        this.emitStatus(myDid, peerDid, conn.status);
        // Probe again in case the data channel opened *before* the
        // connectionstatechange handler had a chance to start one.
        if (!conn.transportProbeStopped && conn.status.transport == null) {
          this.startTransportProbe(myDid, peerDid, conn);
        }
      };
      dc.onclose = () => {
        log.warn('p2p', 'datachannel closed', { peerDid, signalingSessionId });
      };
      dc.onerror = () => {
        conn.status = { state: 'failed', detail: 'datachannel error', signalingSessionId };
        this.emitStatus(myDid, peerDid, conn.status);
      };
      // Drain inbound bytes silently. Text data plane is now SSE; a
      // peer running an older build might still push hint frames, and
      // we drop them rather than letting the `bufferedAmount` grow.
      dc.onmessage = () => {};
    };

    if (isOfferer) {
      bindDataChannel(pc.createDataChannel('friend-chat'));
    } else {
      pc.ondatachannel = (ev) => bindDataChannel(ev.channel);
    }

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      const c = ev.candidate;
      const plaintext = JSON.stringify({
        candidate: c.candidate,
        mid: c.sdpMid ?? '',
        mline: c.sdpMLineIndex ?? 0,
      });
      this.sendSignal(conn, 'CANDIDATE', plaintext).catch((error) => {
        log.warn('p2p', 'send candidate failed', { peerDid, error });
      });
    };

    // SDP exchange — offerer drives, non-offerer waits passively for
    // the SSE-delivered OFFER.
    if (isOfferer) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await this.sendSignal(conn, 'OFFER', JSON.stringify({ sdp: offer.sdp || '' }));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        conn.status = { state: 'failed', detail, signalingSessionId };
        this.emitStatus(myDid, peerDid, conn.status);
        return conn.status;
      }
    }
    // For both sides, status stays 'connecting' until the inbound
    // OFFER/ANSWER arrives and `connectionstatechange` flips to
    // 'connected'. There's no polling loop here — the SSE handler
    // (`handleInboundSignal`) drives the rest of the handshake.
    return conn.status;
  }

  private async sendSignal(
    conn: Conn,
    kind: RealtimeCallSignalKind,
    plaintext: string,
  ): Promise<void> {
    let peerIkPub: string;
    try {
      peerIkPub = await loadPeerIk(conn.peerDid);
    } catch (error) {
      log.warn('p2p', 'loadPeerIk failed', { peerDid: conn.peerDid, error });
      return;
    }
    let payloadB64: string;
    try {
      const sealed = await api.signalingEnvelopeSeal(
        peerIkPub,
        conn.signalingSessionId,
        kind,
        plaintext,
      );
      payloadB64 = sealed.payload_b64;
    } catch (error) {
      log.warn('p2p', 'signaling envelope seal failed', { kind, error });
      return;
    }
    try {
      await api.realtimeSignalSend(
        conn.peerDid,
        conn.signalingSessionId,
        kind,
        payloadB64,
      );
    } catch (error) {
      log.warn('p2p', 'realtimeSignalSend failed', { kind, error });
    }
  }

  private findConnBySession(sessionUlid: string): Conn | null {
    for (const conn of this.conns.values()) {
      if (conn.signalingSessionId === sessionUlid) return conn;
    }
    return null;
  }

  private async handleInboundSignal(payload: RealtimeCallSignalPayload): Promise<void> {
    const { sessionUlid, fromActorId, kind, payload: ciphertext } = payload;
    const conn = this.findConnBySession(sessionUlid);
    if (!conn) {
      // Two legitimate cases land here:
      //   1. Multi-device echo of our own outbound signal arriving
      //      before the conversation page has mounted — drop.
      //   2. Peer initiated a call against a session we haven't opened
      //      a UI for yet. We don't auto-create a Conn from the SSE
      //      side because that would let any actor force us into a
      //      WebRTC handshake; the UI must call `ensureConnected`
      //      explicitly. The OFFER is dropped; once the user opens
      //      the chat, our own `ensureConnected` will (re)issue a
      //      fresh handshake under our own session id.
      return;
    }
    if (fromActorId === conn.myDid) {
      // Multi-device echo of our own outbound signal. Station fans out
      // every signal to the sender's *other* devices too, but those
      // devices cannot decrypt the payload — the sealed envelope is
      // addressed to the peer's identity key, not ours. The envelope
      // metadata (`kind`, `sessionUlid`) is plaintext, though, which is
      // exactly enough to converge a multi-device ring without ever
      // touching the ciphertext.
      //
      // If *this* device is ringing an incoming call and a sibling
      // device just sent a CALL_ACCEPT or CALL_REJECT for the same
      // session, the call has been handled elsewhere — stop ringing
      // here so the user isn't pestered on every device
      // (voice-video-calls.md §11 multi-device ringing resolution).
      if (conn.call.state === 'incoming' && (kind === 'CALL_ACCEPT' || kind === 'CALL_REJECT')) {
        this.teardownCallLocal(conn, 'handled-elsewhere');
        return;
      }
      // For media signals (OFFER / ANSWER / CANDIDATE) we already hold
      // the authoritative local descriptions from the RTCPeerConnection
      // that produced the outbound signal, so the echo is redundant.
      return;
    }

    let plaintext: string;
    try {
      const senderIkPub = await loadPeerIk(fromActorId);
      const payloadB64 = bytesToBase64(ciphertext);
      const opened = await api.signalingEnvelopeOpen(
        senderIkPub,
        sessionUlid,
        kind,
        payloadB64,
      );
      plaintext = opened.plaintext;
    } catch (error) {
      log.warn('p2p', 'signaling envelope open failed', { kind, sessionUlid, error });
      return;
    }

    let json: any;
    try {
      json = JSON.parse(plaintext);
    } catch (error) {
      log.warn('p2p', 'signal plaintext is not valid JSON', { kind, error });
      return;
    }

    if (kind === 'OFFER') {
      const sdp = String(json?.sdp || '');
      if (!sdp) {
        log.warn('p2p', 'OFFER missing sdp', { sessionUlid });
        return;
      }
      try {
        await conn.pc.setRemoteDescription({ type: 'offer', sdp });
        conn.remoteDescriptionApplied = true;
        await this.flushPendingRemoteCandidates(conn);
        const answer = await conn.pc.createAnswer();
        await conn.pc.setLocalDescription(answer);
        await this.sendSignal(conn, 'ANSWER', JSON.stringify({ sdp: answer.sdp || '' }));
      } catch (error) {
        log.warn('p2p', 'apply OFFER failed', error);
      }
    } else if (kind === 'ANSWER') {
      const sdp = String(json?.sdp || '');
      if (!sdp) {
        log.warn('p2p', 'ANSWER missing sdp', { sessionUlid });
        return;
      }
      try {
        await conn.pc.setRemoteDescription({ type: 'answer', sdp });
        conn.remoteDescriptionApplied = true;
        await this.flushPendingRemoteCandidates(conn);
      } catch (error) {
        log.warn('p2p', 'apply ANSWER failed', error);
      }
    } else if (kind === 'CANDIDATE') {
      const candidate = String(json?.candidate || '');
      if (!candidate) return;
      const mid = json?.mid != null ? String(json.mid) : undefined;
      const mline = json?.mline != null ? Number(json.mline) : undefined;
      if (!conn.remoteDescriptionApplied) {
        // WebRTC rejects `addIceCandidate` until the remote description
        // is applied; buffer and replay rather than silently lose them.
        conn.pendingRemoteCandidates.push({
          candidate,
          mid,
          mline: Number.isFinite(mline) ? mline : undefined,
        });
        return;
      }
      try {
        await conn.pc.addIceCandidate({
          candidate,
          sdpMid: mid,
          sdpMLineIndex: Number.isFinite(mline) ? mline : undefined,
        });
      } catch (error) {
        log.debug('p2p', 'addIceCandidate failed', error);
      }
    } else if (kind === 'HANGUP') {
      try { conn.dc?.close(); } catch { /* best-effort */ }
      try { conn.pc.close(); } catch { /* best-effort */ }
    } else if (kind === 'CALL_REQUEST') {
      // Peer is calling us. Park the call in `incoming` so the UI
      // can render the ringing modal; we don't add tracks until the
      // user accepts. Multi-device collision: if we receive
      // CALL_REQUEST while we already have an active call (or our
      // own outgoing one) for this peer, we auto-reject the new
      // attempt — the user can retry once the previous call ends.
      const callId = String(json?.callId || '');
      const mediaKind = json?.kind === 'video' ? 'video' : 'audio';
      if (!callId) {
        log.warn('p2p', 'CALL_REQUEST missing callId');
        return;
      }
      if (conn.call.state === 'active' || conn.call.state === 'outgoing' || conn.call.state === 'incoming') {
        // Decline the colliding attempt without disturbing the
        // existing call. We only echo the rejected callId, never
        // our own current one.
        await this.sendSignal(conn, 'CALL_REJECT', JSON.stringify({ callId, reason: 'busy' }));
        return;
      }
      conn.call = { callId, mediaKind, state: 'incoming' };
      this.emitCall(conn);
      // Arm the unanswered-ring timeout so an ignored incoming call
      // clears its modal instead of ringing forever.
      this.armRingTimeout(conn);
    } else if (kind === 'CALL_ACCEPT') {
      // Peer accepted our call. Flip to active; the WebRTC
      // renegotiation kicked off by `addTrack` (in startCall)
      // produces the OFFER independently. We don't gate on call-id
      // matching here because a stale ACCEPT is harmless — at
      // worst we light up an already-ended call for one tick before
      // CALL_END arrives.
      const callId = String(json?.callId || '');
      if (conn.call.state !== 'outgoing' || (callId && callId !== conn.call.callId)) {
        return;
      }
      this.clearRingTimeout(conn);
      conn.call = { ...conn.call, state: 'active', startedAt: Date.now() };
      this.emitCall(conn);
    } else if (kind === 'CALL_REJECT') {
      const callId = String(json?.callId || '');
      if (callId && callId !== conn.call.callId) return;
      // Map the peer's sealed reason onto our terminal result so the
      // caller's UI can distinguish "declined" from "busy".
      const rawReason = String(json?.reason || '');
      const reason: CallEndReason =
        rawReason === 'busy' ? 'busy'
        : rawReason === 'media-failed' ? 'media-failed'
        : 'rejected';
      this.teardownCallLocal(conn, reason);
    } else if (kind === 'CALL_END') {
      const callId = String(json?.callId || '');
      if (callId && callId !== conn.call.callId) return;
      // A remote end while still ringing is a missed call; while active
      // or reconnecting it is a normal hangup.
      const reason: CallEndReason =
        conn.call.state === 'active' || conn.call.state === 'reconnecting' ? 'hangup' : 'no-answer';
      this.teardownCallLocal(conn, reason);
    }
  }

  private async flushPendingRemoteCandidates(conn: Conn): Promise<void> {
    if (conn.pendingRemoteCandidates.length === 0) return;
    const queued = conn.pendingRemoteCandidates.splice(0);
    for (const c of queued) {
      try {
        await conn.pc.addIceCandidate({
          candidate: c.candidate,
          sdpMid: c.mid,
          sdpMLineIndex: c.mline,
        });
      } catch (error) {
        log.debug('p2p', 'flushPendingRemoteCandidates: addIceCandidate failed', error);
      }
    }
  }

  // ─────────────────────────── Voice / video calls ────────────────────────────
  //
  // The ringing protocol (CALL_REQUEST / CALL_ACCEPT / CALL_REJECT /
  // CALL_END) lives on top of the same sealed-envelope signaling
  // channel used for SDP. The actual media negotiation is plain
  // WebRTC: `addTrack` triggers `onnegotiationneeded` → fresh
  // OFFER → ANSWER → re-running ICE if needed. The data channel
  // stays up across renegotiation.

  /** Look up the local conn for a peer, returning null if no chat
   *  PC has been opened yet. The UI must call `ensureConnected`
   *  *before* `startCall` — we can't bring up media without the
   *  underlying RTCPeerConnection. */
  getCall(myDid: string, peerDid: string): CallSnapshot | null {
    const conn = this.conns.get(`${myDid}::${peerDid}`);
    return conn ? { ...conn.call } : null;
  }

  /** Initiate an outbound call. Acquires local media via
   *  `getUserMedia`, attaches the resulting tracks to the PC (which
   *  will trigger `onnegotiationneeded`), and sends CALL_REQUEST so
   *  the peer's UI can ring. The promise resolves once the local
   *  media is captured + tracks added; it does NOT wait for the
   *  peer to accept (subscribe to `setOnCall` for that). */
  async startCall(myDid: string, peerDid: string, mediaKind: CallMediaKind): Promise<void> {
    const conn = this.conns.get(`${myDid}::${peerDid}`);
    if (!conn) throw new Error('startCall: no PC; call ensureConnected first');
    if (conn.call.state === 'active' || conn.call.state === 'outgoing') {
      throw new Error('startCall: call already in progress');
    }
    const callId = this.newCallId();
    const audioDeviceId = readPreferredDevice(PREFERRED_AUDIO_DEVICE_KEY);
    const videoDeviceId = readPreferredDevice(PREFERRED_VIDEO_DEVICE_KEY);
    conn.call = { callId, mediaKind, state: 'outgoing', audioDeviceId, videoDeviceId };
    this.emitCall(conn);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(
        buildMediaConstraints(mediaKind === 'video', audioDeviceId, videoDeviceId),
      );
    } catch (error) {
      this.teardownCallLocal(conn, 'media-failed');
      throw error;
    }
    for (const track of stream.getTracks()) {
      conn.pc.addTrack(track, stream);
    }
    conn.call = { ...conn.call, localStream: stream };
    this.emitCall(conn);
    // Notify the peer. Renegotiation OFFER will follow
    // automatically through the existing onnegotiationneeded path.
    await this.sendSignal(conn, 'CALL_REQUEST', JSON.stringify({ callId, kind: mediaKind }));
    // Arm the unanswered-ring timeout: if the callee never picks up,
    // we cancel the outgoing ring and notify the peer (no-answer).
    this.armRingTimeout(conn);
  }

  /** Accept an incoming call (`call.state === 'incoming'`). Same
   *  acquisition path as startCall, just in the other direction. */
  async acceptCall(myDid: string, peerDid: string): Promise<void> {
    const conn = this.conns.get(`${myDid}::${peerDid}`);
    if (!conn) throw new Error('acceptCall: no PC');
    if (conn.call.state !== 'incoming') return;
    const { callId, mediaKind } = conn.call;
    // The user answered — stop the unanswered-ring countdown before we
    // pay the getUserMedia round-trip.
    this.clearRingTimeout(conn);
    const audioDeviceId = readPreferredDevice(PREFERRED_AUDIO_DEVICE_KEY);
    const videoDeviceId = readPreferredDevice(PREFERRED_VIDEO_DEVICE_KEY);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(
        buildMediaConstraints(mediaKind === 'video', audioDeviceId, videoDeviceId),
      );
    } catch (error) {
      // Acquisition failed — politely reject so the caller doesn't
      // wait for a ring-out.
      await this.sendSignal(conn, 'CALL_REJECT', JSON.stringify({ callId, reason: 'media-failed' }));
      this.teardownCallLocal(conn, 'media-failed');
      throw error;
    }
    for (const track of stream.getTracks()) {
      conn.pc.addTrack(track, stream);
    }
    conn.call = {
      ...conn.call,
      localStream: stream,
      state: 'active',
      startedAt: Date.now(),
      audioDeviceId,
      videoDeviceId,
    };
    this.emitCall(conn);
    await this.sendSignal(conn, 'CALL_ACCEPT', JSON.stringify({ callId }));
  }

  /** Reject a ringing incoming call without acquiring media. */
  async rejectCall(myDid: string, peerDid: string, reason: string = 'declined'): Promise<void> {
    const conn = this.conns.get(`${myDid}::${peerDid}`);
    if (!conn) return;
    if (conn.call.state !== 'incoming') return;
    const { callId } = conn.call;
    await this.sendSignal(conn, 'CALL_REJECT', JSON.stringify({ callId, reason }));
    this.teardownCallLocal(conn, 'rejected');
  }

  /** End the active call (or cancel an outbound ringing one). */
  async endCall(myDid: string, peerDid: string): Promise<void> {
    const conn = this.conns.get(`${myDid}::${peerDid}`);
    if (!conn) return;
    if (conn.call.state === 'idle' || conn.call.state === 'ended') return;
    const { callId } = conn.call;
    // Canceling an outgoing/incoming ring is distinct from hanging up
    // an active (or reconnecting) call, so the UI can show "Canceled"
    // vs "Call ended".
    const reason: CallEndReason =
      conn.call.state === 'active' || conn.call.state === 'reconnecting' ? 'hangup' : 'canceled';
    await this.sendSignal(conn, 'CALL_END', JSON.stringify({ callId }));
    this.teardownCallLocal(conn, reason);
  }

  /** Mute or unmute the local microphone in-place. The track stays
   *  in the PC sender; only `enabled` flips, which is the cheapest
   *  way to mute and is what every WebRTC tutorial recommends. */
  toggleMic(myDid: string, peerDid: string, muted: boolean): void {
    const conn = this.conns.get(`${myDid}::${peerDid}`);
    if (!conn?.call.localStream) return;
    for (const t of conn.call.localStream.getAudioTracks()) {
      t.enabled = !muted;
    }
    conn.call = { ...conn.call, micMuted: muted };
    this.emitCall(conn);
  }

  /** Same idea for the camera. We don't `removeTrack` here because
   *  that would force a renegotiation; flipping `enabled` is enough
   *  for the peer to see a black frame, and the local <video> tag
   *  shows our own placeholder via `cameraOff`. */
  toggleCamera(myDid: string, peerDid: string, off: boolean): void {
    const conn = this.conns.get(`${myDid}::${peerDid}`);
    if (!conn?.call.localStream) return;
    for (const t of conn.call.localStream.getVideoTracks()) {
      t.enabled = !off;
    }
    conn.call = { ...conn.call, cameraOff: off };
    this.emitCall(conn);
  }

  /** Enumerate the available microphones and cameras for the device
   *  picker. Labels are only populated once a media permission has been
   *  granted (browser privacy rule), so the UI should be tolerant of
   *  empty labels and fall back to a generic "Microphone N" / "Camera N".
   *  Returns empty lists if the platform has no media devices API. */
  async listMediaDevices(): Promise<CallMediaDevices> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return { audioInputs: [], videoInputs: [] };
    }
    let devices: MediaDeviceInfo[];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch (error) {
      log.warn('p2p', 'enumerateDevices failed', error);
      return { audioInputs: [], videoInputs: [] };
    }
    const audioInputs: CallMediaDevice[] = [];
    const videoInputs: CallMediaDevice[] = [];
    for (const d of devices) {
      if (!d.deviceId) continue;
      if (d.kind === 'audioinput') audioInputs.push({ deviceId: d.deviceId, label: d.label });
      else if (d.kind === 'videoinput') videoInputs.push({ deviceId: d.deviceId, label: d.label });
    }
    return { audioInputs, videoInputs };
  }

  /** Return the persisted device preferences so the picker can show the
   *  current selection before any call is in flight. */
  getPreferredDevices(): { audioDeviceId?: string; videoDeviceId?: string } {
    return {
      audioDeviceId: readPreferredDevice(PREFERRED_AUDIO_DEVICE_KEY),
      videoDeviceId: readPreferredDevice(PREFERRED_VIDEO_DEVICE_KEY),
    };
  }

  /** Switch the microphone mid-call (or just persist the preference when
   *  no call is active). Uses `RTCRtpSender.replaceTrack` so the swap is
   *  seamless — no renegotiation, no peer-visible interruption. Passing
   *  `undefined` clears the preference back to the OS default. */
  async switchAudioDevice(myDid: string, peerDid: string, deviceId: string | undefined): Promise<void> {
    writePreferredDevice(PREFERRED_AUDIO_DEVICE_KEY, deviceId);
    await this.replaceLocalTrack(myDid, peerDid, 'audio', deviceId);
  }

  /** Switch the camera mid-call (or persist the preference when idle).
   *  Same seamless `replaceTrack` path as {@link switchAudioDevice}. */
  async switchVideoDevice(myDid: string, peerDid: string, deviceId: string | undefined): Promise<void> {
    writePreferredDevice(PREFERRED_VIDEO_DEVICE_KEY, deviceId);
    await this.replaceLocalTrack(myDid, peerDid, 'video', deviceId);
  }

  /**
   * Re-capture a single input from a new device and hot-swap it into the
   * live RTCPeerConnection sender and local snapshot stream. No-op when no
   * media is flowing (the persisted preference takes effect on next call).
   *
   * We capture ONLY the requested kind so we never re-prompt for the other
   * track, then stop the old track to release the previous device. The new
   * track inherits the current mute/camera-off state so a swap doesn't
   * silently un-mute the user.
   */
  private async replaceLocalTrack(
    myDid: string,
    peerDid: string,
    kind: CallMediaKind,
    deviceId: string | undefined,
  ): Promise<void> {
    const conn = this.conns.get(`${myDid}::${peerDid}`);
    if (!conn?.call.localStream) return;
    if (conn.call.state !== 'active' && conn.call.state !== 'reconnecting') return;
    const wantVideo = kind === 'video';
    if (wantVideo && conn.call.mediaKind !== 'video') return;

    let captured: MediaStream;
    try {
      captured = await navigator.mediaDevices.getUserMedia(
        wantVideo
          ? buildMediaConstraints(true, undefined, deviceId)
          : { audio: deviceId ? { deviceId: { ideal: deviceId } } : true, video: false },
      );
    } catch (error) {
      log.warn('p2p', 'device switch capture failed', error);
      throw error;
    }
    const newTrack = wantVideo
      ? captured.getVideoTracks()[0]
      : captured.getAudioTracks()[0];
    if (!newTrack) {
      for (const t of captured.getTracks()) { try { t.stop(); } catch { /* best-effort */ } }
      return;
    }
    // Preserve the existing mute / camera-off state on the fresh track.
    newTrack.enabled = wantVideo ? !conn.call.cameraOff : !conn.call.micMuted;

    const sender = conn.pc.getSenders().find((s) => s.track?.kind === newTrack.kind);
    if (sender) {
      try {
        await sender.replaceTrack(newTrack);
      } catch (error) {
        try { newTrack.stop(); } catch { /* best-effort */ }
        log.warn('p2p', 'replaceTrack failed', error);
        throw error;
      }
    }
    // Swap the track inside the snapshot's local stream so the self-view
    // <video> reflects the new device, then stop the superseded track.
    const oldTrack = wantVideo
      ? conn.call.localStream.getVideoTracks()[0]
      : conn.call.localStream.getAudioTracks()[0];
    if (oldTrack) {
      conn.call.localStream.removeTrack(oldTrack);
      try { oldTrack.stop(); } catch { /* best-effort */ }
    }
    conn.call.localStream.addTrack(newTrack);
    conn.call = {
      ...conn.call,
      ...(wantVideo ? { videoDeviceId: deviceId } : { audioDeviceId: deviceId }),
    };
    this.emitCall(conn);
  }

  /** Stop the local stream and reset the call snapshot. Used by
   *  every terminal path (CALL_END/CALL_REJECT, errors, manual
   *  hangup). The PC itself stays alive so we can ring again later
   *  without reopening the entire connection. The `reason` surfaces
   *  on the terminal snapshot so the UI can render a distinct,
   *  localized result (declined / missed / network failure / …). */
  private teardownCallLocal(conn: Conn, reason: CallEndReason): void {
    this.clearRingTimeout(conn);
    this.clearReconnectTimeout(conn);
    if (conn.call.localStream) {
      for (const t of conn.call.localStream.getTracks()) {
        try { t.stop(); } catch { /* best-effort */ }
      }
    }
    // Detach senders so the next call's renegotiation starts clean.
    // (Keeping them around would force two extra m-lines in every
    // future SDP for no benefit.)
    for (const sender of conn.pc.getSenders()) {
      if (sender.track) {
        try { conn.pc.removeTrack(sender); } catch { /* best-effort */ }
      }
    }
    conn.remoteTrackIds.clear();
    conn.call = { callId: '', mediaKind: 'audio', state: 'ended', endReason: reason };
    this.emitCall(conn);
  }

  /**
   * Tear down only connections that have no in-flight call, leaving
   * any ringing / active / reconnecting call alive.
   *
   * This is the conversation-switch teardown. The call projection must
   * survive navigation between chats (a user can receive a call from
   * peer B while reading peer C — see voice-video-calls.md §7), so the
   * page's per-peer connection effect must NOT blow away a live call
   * when the active conversation changes. Connections whose call is
   * `idle` / `ended` are pure transport-readiness probes and safe to
   * recycle; connections carrying an `outgoing` / `incoming` / `active`
   * call are kept until that call reaches a terminal state.
   */
  closeIdleConnections() {
    for (const [key, conn] of this.conns) {
      const callState = conn.call.state;
      if (callState === 'outgoing' || callState === 'incoming' || callState === 'active' || callState === 'reconnecting') {
        continue;
      }
      conn.transportProbeStopped = true;
      try { conn.dc?.close(); } catch { /* best-effort */ }
      try { conn.pc.close(); } catch { /* best-effort */ }
      this.conns.delete(key);
    }
  }

  // Tear down every active connection; intended for component unmount cleanup.
  closeAll() {
    for (const conn of this.conns.values()) {
      conn.transportProbeStopped = true;
      this.clearRingTimeout(conn);
      this.clearReconnectTimeout(conn);
      // Stop any in-flight call media first so the camera light
      // turns off promptly even if pc.close() races.
      if (conn.call.localStream) {
        for (const t of conn.call.localStream.getTracks()) {
          try { t.stop(); } catch { /* best-effort */ }
        }
      }
      try { conn.dc?.close(); } catch { /* best-effort */ }
      try { conn.pc.close(); } catch { /* best-effort */ }
    }
    this.conns.clear();
    // Note: signalSubscription is intentionally NOT torn down here.
    // See `ensureSignalSubscription` for the reasoning.
  }

  /**
   * Resolve which ICE candidate pair the connection is actually using.
   *
   * `RTCPeerConnection.connectionState === 'connected'` only tells us
   * "media flows"; it does not say whether that's via host candidates,
   * a server-reflexive (STUN) pair, or a TURN allocation. We need that
   * distinction so the UI can show "Direct" vs "Relay" honestly instead
   * of mis-labelling TURN as "Fallback".
   *
   * The probe re-checks every 4 s for ~30 s after handshake (TURN
   * allocations sometimes win the candidate race late). It stops as
   * soon as the connection terminates, the transport is determined and
   * stable, or the budget runs out.
   */
  private startTransportProbe(myDid: string, peerDid: string, conn: Conn) {
    let elapsed = 0;
    const intervalMs = 4000;
    const budgetMs = 32000;

    const probe = async () => {
      if (conn.transportProbeStopped) return;
      if (conn.pc.connectionState !== 'connected') return;
      let transport: FriendChatP2pTransport = null;
      try {
        const stats = await conn.pc.getStats();
        transport = pickTransportFromStats(stats);
      } catch (error) {
        log.warn('p2p', 'getStats probe failed', { peerDid, error });
        return;
      }
      if (!transport) return;
      // Only emit if the transport just became known or flipped.
      if (conn.status.transport === transport) return;
      conn.status = { ...conn.status, transport };
      this.emitStatus(myDid, peerDid, conn.status);
      // Once we settle on a transport, stop the loop. WebRTC won't silently
      // switch pairs without going through `iceconnectionstatechange`, and
      // we react to that via the existing `onconnectionstatechange` hook.
      conn.transportProbeStopped = true;
    };

    const tick = async () => {
      while (!conn.transportProbeStopped && elapsed < budgetMs) {
        await probe();
        if (conn.transportProbeStopped) return;
        await sleep(intervalMs);
        elapsed += intervalMs;
      }
    };
    tick().catch(() => {});
  }

}

export const friendChatP2p = new FriendChatP2pManager();
