import { api } from '../../services/desktop_api';
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

type ConnKey = string; // `${myDid}::${peerDid}`

interface Conn {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  status: FriendChatP2pStatus;
  seenCandidates: Set<string>;
  candidateLoopStopped: boolean;
  /** Stop flag for the {@link transportProbeLoop} once the connection terminates. */
  transportProbeStopped: boolean;
}

class FriendChatP2pManager {
  private conns = new Map<ConnKey, Conn>();
  private onStatus: ((myDid: string, peerDid: string, status: FriendChatP2pStatus) => void) | null = null;

  setOnStatus(handler: ((myDid: string, peerDid: string, status: FriendChatP2pStatus) => void) | null) {
    this.onStatus = handler;
  }

  private emitStatus(myDid: string, peerDid: string, status: FriendChatP2pStatus) {
    this.onStatus?.(myDid, peerDid, status);
  }

  async ensurePeerRegistered(myDid: string): Promise<void> {
    if (!myDid.trim()) return;
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

    const status: FriendChatP2pStatus = { state: 'connecting' };
    this.emitStatus(myDid, peerDid, status);

    const [a, b] = normalizePair(myDid, peerDid);
    const isOfferer = myDid === a;

    // Create (or reuse) signaling session id; server is dumb and uses `a-b` as id.
    const signalingSession = await api.iceSessionNew(a, b);
    const signalingSessionId = (signalingSession as any)?.id || `${a}-${b}`;
    status.signalingSessionId = signalingSessionId;

    let iceServers: any[] = [];
    try {
      const cfg = await api.iceGetServers();
      iceServers = (cfg as any)?.ice_servers || [];
    } catch (error) {
      // TURN not available; still try with no ICE servers (may work on LAN).
      log.warn('p2p', 'iceGetServers failed, continuing without TURN', error);
    }

    const pc = new RTCPeerConnection({ iceServers });
    const conn: Conn = {
      pc,
      dc: null,
      status,
      seenCandidates: new Set<string>(),
      candidateLoopStopped: false,
      transportProbeStopped: false,
    };
    this.conns.set(key, conn);

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') {
        conn.candidateLoopStopped = true;
        // Spin up the transport probe so we can distinguish P2P-direct
        // from TURN-relay; emit an interim status while the probe runs
        // (`transport: null` means "connected but path not yet known").
        conn.status = { state: 'connected', signalingSessionId, transport: null };
        this.emitStatus(myDid, peerDid, conn.status);
        this.updatePeerRole(myDid, 'client+p2p:connected').catch(() => {});
        this.startTransportProbe(myDid, peerDid, conn);
      } else if (s === 'failed') {
        conn.candidateLoopStopped = true;
        conn.transportProbeStopped = true;
        conn.status = { state: 'failed', detail: 'webrtc connection failed', signalingSessionId };
        this.emitStatus(myDid, peerDid, conn.status);
        this.updatePeerRole(myDid, 'client+p2p:failed').catch(() => {});
      } else if (s === 'closed') {
        conn.candidateLoopStopped = true;
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
      // Candidate exchange via signaling server.
      api.iceSessionCandidatePost(signalingSessionId, c.candidate, c.sdpMid || '', c.sdpMLineIndex ?? 0, myDid)
        .catch((error) => log.warn('p2p', 'candidate post failed', error));
    };

    const pollCandidates = async () => {
      const INITIAL_DELAY = 600;
      const DELAY_INCREMENT = 200;
      const MAX_DELAY = 5000;
      let delay = INITIAL_DELAY;

      while (!conn.candidateLoopStopped) {
        let receivedNew = false;
        try {
          const data = await api.iceSessionCandidatesGet(signalingSessionId);
          const list = ((data as any)?.candidates || []) as Array<any>;
          for (const item of list) {
            const from = String(item?.from || '');
            if (from === myDid) continue;
            const candidate = String(item?.candidate || '');
            const mid = String(item?.mid || '');
            const mline = Number(item?.mline || 0);
            const key2 = `${from}|${mid}|${mline}|${candidate}`;
            if (conn.seenCandidates.has(key2)) continue;
            conn.seenCandidates.add(key2);
            receivedNew = true;
            if (candidate) {
              await pc.addIceCandidate({ candidate, sdpMid: mid || undefined, sdpMLineIndex: Number.isFinite(mline) ? mline : undefined })
                .catch(() => {});
            }
          }
        } catch {
          // ignore; server may return 404 until first candidate exists
        }

        // Reset delay when new candidates arrive; otherwise back off progressively.
        if (receivedNew) {
          delay = INITIAL_DELAY;
        } else {
          delay = Math.min(delay + DELAY_INCREMENT, MAX_DELAY);
        }
        await sleep(delay);
      }
    };
    pollCandidates().catch(() => {});

    // SDP exchange.
    try {
      if (isOfferer) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await api.iceSessionOfferPost(signalingSessionId, offer.sdp || '');

        // Wait for answer.
        for (let i = 0; i < 50; i++) {
          const ans = await api.iceSessionAnswerGet(signalingSessionId).catch(() => null);
          const sdp = (ans as any)?.sdp;
          if (typeof sdp === 'string' && sdp.trim()) {
            await pc.setRemoteDescription({ type: 'answer', sdp });
            break;
          }
          await sleep(200);
        }
      } else {
        // Wait for offer.
        let offerSdp = '';
        for (let i = 0; i < 50; i++) {
          const off = await api.iceSessionOfferGet(signalingSessionId).catch(() => null);
          const sdp = (off as any)?.sdp;
          if (typeof sdp === 'string' && sdp.trim()) {
            offerSdp = sdp;
            break;
          }
          await sleep(200);
        }
        if (!offerSdp) {
          throw new Error('offer not found');
        }
        await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await api.iceSessionAnswerPost(signalingSessionId, answer.sdp || '');
      }
      conn.status = { state: 'connecting', signalingSessionId };
      this.emitStatus(myDid, peerDid, conn.status);
      return conn.status;
    } catch (error) {
      conn.status = { state: 'failed', detail: error instanceof Error ? error.message : String(error), signalingSessionId };
      this.emitStatus(myDid, peerDid, conn.status);
      return conn.status;
    }
  }

  // Tear down every active connection; intended for component unmount cleanup.
  closeAll() {
    for (const conn of this.conns.values()) {
      conn.candidateLoopStopped = true;
      conn.transportProbeStopped = true;
      try { conn.dc?.close(); } catch { /* best-effort */ }
      try { conn.pc.close(); } catch { /* best-effort */ }
    }
    this.conns.clear();
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
