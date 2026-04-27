import { api } from '../../services/desktop_api';
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
// `api.keyExchangeFetchBundle(did).ik_pub`, and cache it process-wide
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
 * The UI surfaces this so users can tell "real-time over P2P" from
 * "real-time over TURN relay" — both are equally responsive, but TURN
 * costs station bandwidth and has implications for privacy. **There is no
 * SSE / business-layer relay; the entire real-time path is WebRTC.**
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
// lazily on first need from `keyExchangeFetchBundle`. The key never
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
      const bundle = await api.keyExchangeFetchBundle(peerDid);
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
}

class FriendChatP2pManager {
  private conns = new Map<ConnKey, Conn>();
  private onStatus: ((myDid: string, peerDid: string, status: FriendChatP2pStatus) => void) | null = null;
  private signalSubscription: (() => void) | null = null;

  setOnStatus(handler: ((myDid: string, peerDid: string, status: FriendChatP2pStatus) => void) | null) {
    this.onStatus = handler;
  }

  private emitStatus(myDid: string, peerDid: string, status: FriendChatP2pStatus) {
    this.onStatus?.(myDid, peerDid, status);
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

  async ensurePeerRegistered(myDid: string): Promise<void> {
    if (!myDid.trim()) return;
    this.ensureSignalSubscription();
    try {
      await api.icePeerRegister(myDid, 'client', []);
    } catch (error) {
      // Non-fatal: direct channel will fail but station-sync path remains.
      log.warn('p2p', 'icePeerRegister failed', error);
    }
  }

  private async updatePeerRole(myDid: string, role: string): Promise<void> {
    if (!myDid.trim()) return;
    try {
      await api.icePeerRegister(myDid, role, []);
    } catch {
      // Best-effort only.
    }
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
    };
    this.conns.set(key, conn);

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') {
        // Spin up the transport probe so we can distinguish P2P-direct
        // from TURN-relay; emit an interim status while the probe runs
        // (`transport: null` means "connected but path not yet known").
        conn.status = { state: 'connected', signalingSessionId, transport: null };
        this.emitStatus(myDid, peerDid, conn.status);
        this.updatePeerRole(myDid, 'client+p2p:connected').catch(() => {});
        this.startTransportProbe(myDid, peerDid, conn);
      } else if (s === 'failed') {
        conn.transportProbeStopped = true;
        conn.status = { state: 'failed', detail: 'webrtc connection failed', signalingSessionId };
        this.emitStatus(myDid, peerDid, conn.status);
        this.updatePeerRole(myDid, 'client+p2p:failed').catch(() => {});
      } else if (s === 'closed') {
        conn.transportProbeStopped = true;
        conn.status = { state: 'closed', signalingSessionId };
        this.emitStatus(myDid, peerDid, conn.status);
        this.updatePeerRole(myDid, 'client+p2p:closed').catch(() => {});
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
        this.updatePeerRole(myDid, 'client+p2p:connected').catch(() => {});
        // Probe again in case the data channel opened *before* the
        // connectionstatechange handler had a chance to start one.
        if (!conn.transportProbeStopped && conn.status.transport == null) {
          this.startTransportProbe(myDid, peerDid, conn);
        }
      };
      dc.onclose = () => {
        log.warn('p2p', 'datachannel closed', { peerDid, signalingSessionId });
        this.updatePeerRole(myDid, 'client+p2p:closed').catch(() => {});
      };
      dc.onerror = () => {
        conn.status = { state: 'failed', detail: 'datachannel error', signalingSessionId };
        this.emitStatus(myDid, peerDid, conn.status);
        this.updatePeerRole(myDid, 'client+p2p:failed').catch(() => {});
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
      // Multi-device echo: Station fans out to both recipient and
      // sender for chat-message receipts so the sender's *other*
      // devices stay in sync, but for signaling we drop it because
      // we already have local descriptions / candidates from the
      // RTCPeerConnection that produced the outbound signal.
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

  // Tear down every active connection; intended for component unmount cleanup.
  closeAll() {
    for (const conn of this.conns.values()) {
      conn.transportProbeStopped = true;
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
