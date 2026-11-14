/** Aggregate RTP evidence only: no SDP, device IDs or candidate addresses. */
export interface CallMediaStats {
  callId: string;
  connectionState: string;
  iceConnectionState: string;
  media: Record<'audio' | 'video', {
    bytesSent: number;
    bytesReceived: number;
    packetsSent: number;
    packetsReceived: number;
    framesEncoded: number;
    framesDecoded: number;
  }>;
}

export async function readCallMediaStats(
  callId: string,
  connection: RTCPeerConnection | null,
): Promise<CallMediaStats> {
  const counters = () => ({
    bytesSent: 0, bytesReceived: 0, packetsSent: 0, packetsReceived: 0,
    framesEncoded: 0, framesDecoded: 0,
  });
  const result: CallMediaStats = {
    callId,
    connectionState: connection?.connectionState ?? 'closed',
    iceConnectionState: connection?.iceConnectionState ?? 'closed',
    media: { audio: counters(), video: counters() },
  };
  if (!connection) return result;
  const reports = await connection.getStats();
  reports.forEach((report) => {
    if (report.isRemote || !['inbound-rtp', 'outbound-rtp'].includes(report.type)) return;
    const kind = report.kind ?? report.mediaType;
    if (kind !== 'audio' && kind !== 'video') return;
    const target = result.media[kind as 'audio' | 'video'];
    const fields = report.type === 'outbound-rtp'
      ? ['bytesSent', 'packetsSent', 'framesEncoded'] as const
      : ['bytesReceived', 'packetsReceived', 'framesDecoded'] as const;
    for (const field of fields) {
      const value = report[field];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        target[field] += value;
      }
    }
  });
  return result;
}

/** Read actual playback elements without exposing media or device identities. */
export function readCallMediaPresentation(
  surface: Element | null,
  selectors: { localVideo: string; remoteVideo: string; remoteAudio: string },
  streams: { local?: MediaStream; remote?: MediaStream },
) {
  const observe = (selector: string, stream?: MediaStream) =>
    Array.from(surface?.querySelectorAll<HTMLMediaElement>(selector) ?? []).map((element) => ({
      bound: !!stream && element.srcObject === stream,
      muted: element.muted,
      paused: element.paused,
      readyState: element.readyState,
      currentTime: element.currentTime,
      videoWidth: element instanceof HTMLVideoElement ? element.videoWidth : 0,
      videoHeight: element instanceof HTMLVideoElement ? element.videoHeight : 0,
      width: element.clientWidth,
      height: element.clientHeight,
    }));
  return {
    localVideo: observe(selectors.localVideo, streams.local),
    remoteVideo: observe(selectors.remoteVideo, streams.remote),
    remoteAudio: observe(selectors.remoteAudio, streams.remote),
    audibleRemoteCount: Array.from(surface?.querySelectorAll<HTMLMediaElement>('audio,video') ?? [])
      .filter((element) => streams.remote && element.srcObject === streams.remote
        && !element.muted && !element.paused && element.volume > 0).length,
  };
}
