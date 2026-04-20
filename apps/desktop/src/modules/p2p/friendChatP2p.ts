import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { MessageEnvelope } from '../../gen/proto/domain/chat/friend_chat_pb';
import { MessageEnvelopeSchema } from '../../gen/proto/domain/chat/friend_chat_pb';
import { api } from '../../services/desktop_api';
import { log } from '../../utils/logger';

export type FriendChatP2pState = 'idle' | 'connecting' | 'connected' | 'failed' | 'closed';

export interface FriendChatP2pStatus {
  state: FriendChatP2pState;
  detail?: string;
  signalingSessionId?: string;
}

export type FriendChatP2pOnEnvelope = (envelope: MessageEnvelope) => void;

function normalizePair(a: string, b: string): [string, string] {
  return a.localeCompare(b) <= 0 ? [a, b] : [b, a];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof SharedArrayBuffer !== 'undefined' && data instanceof SharedArrayBuffer) {
    return new Uint8Array(data);
  }
  if (data instanceof Blob) return null; // not expected
  // Some runtimes deliver Uint8Array-like.
  if (data instanceof Uint8Array) return data;
  return null;
}

type ConnKey = string; // `${myDid}::${peerDid}`

interface Conn {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  status: FriendChatP2pStatus;
  seenCandidates: Set<string>;
  candidateLoopStopped: boolean;
}

class FriendChatP2pManager {
  private conns = new Map<ConnKey, Conn>();
  private onEnvelope: FriendChatP2pOnEnvelope | null = null;
  private onStatus: ((myDid: string, peerDid: string, status: FriendChatP2pStatus) => void) | null = null;

  setOnEnvelope(handler: FriendChatP2pOnEnvelope | null) {
    this.onEnvelope = handler;
  }

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
    };
    this.conns.set(key, conn);

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') {
        conn.status = { state: 'connected', signalingSessionId };
        this.emitStatus(myDid, peerDid, conn.status);
        this.updatePeerRole(myDid, 'client+p2p:connected').catch(() => {});
      } else if (s === 'failed') {
        conn.status = { state: 'failed', detail: 'webrtc connection failed', signalingSessionId };
        this.emitStatus(myDid, peerDid, conn.status);
        this.updatePeerRole(myDid, 'client+p2p:failed').catch(() => {});
      } else if (s === 'closed') {
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
        conn.status = { state: 'connected', signalingSessionId };
        this.emitStatus(myDid, peerDid, conn.status);
        this.updatePeerRole(myDid, 'client+p2p:connected').catch(() => {});
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
      dc.onmessage = (ev) => {
        const bytes = asBytes(ev.data);
        if (!bytes) return;
        try {
          const env = fromBinary(MessageEnvelopeSchema, bytes);
          this.onEnvelope?.(env);
        } catch (error) {
          log.warn('p2p', 'failed to decode p2p envelope', error);
        }
      };
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
      while (!conn.candidateLoopStopped) {
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
            if (candidate) {
              await pc.addIceCandidate({ candidate, sdpMid: mid || undefined, sdpMLineIndex: Number.isFinite(mline) ? mline : undefined })
                .catch(() => {});
            }
          }
        } catch {
          // ignore; server may return 404 until first candidate exists
        }
        await sleep(600);
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

  sendMessageHint(myDid: string, peerDid: string, sessionUlid: string, messageUlid: string): boolean {
    const key: ConnKey = `${myDid}::${peerDid}`;
    const conn = this.conns.get(key);
    if (!conn?.dc || conn.dc.readyState !== 'open') return false;
    const env = create(MessageEnvelopeSchema, {
      messageUlid,
      senderDid: myDid,
      receiverDid: peerDid,
      sessionUlid,
      encryptedPayload: new Uint8Array(),
      timestamp: BigInt(Date.now()),
      signature: '',
    });
    try {
      const bytes = toBinary(MessageEnvelopeSchema, env);
      conn.dc.send(bytes);
      return true;
    } catch (error) {
      log.warn('p2p', 'sendMessageHint failed', error);
      return false;
    }
  }
}

export const friendChatP2p = new FriendChatP2pManager();
