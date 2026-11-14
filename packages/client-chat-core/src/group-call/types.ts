export type Unsubscribe = () => void;
export type ConnectionQualityGrade = 'excellent' | 'good' | 'poor' | 'lost';
export type GroupCallState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'leaving' | 'failed';
export type GroupCallConnectionState = 'connected' | 'reconnecting' | 'failed';
export type GroupCallErrorCode = 'busy' | 'permission' | 'membership' | 'capacity' | 'network' | 'media' | 'unavailable';
export type GroupCallMediaKind = 'audio' | 'video';

export interface Participant {
  participantId: string;
  actorPtid: string;
  isLocal: boolean;
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isSpeaking: boolean;
  connectionQuality: ConnectionQualityGrade;
}

export interface GroupCallSignalPayload {
  groupUlid: string;
  roomName: string;
}

export interface GroupCallRoomEvent extends GroupCallSignalPayload {
  kind: 'room_active' | 'room_ended';
}

export interface GroupCallJoinResponse {
  url: string;
  token: string;
  room_name: string;
  grant_id: string;
  participant_identity: string;
}

export interface GroupCallSnapshot {
  state: GroupCallState;
  groupUlid: string;
  roomName: string;
  mediaKind: GroupCallMediaKind;
  participants: Participant[];
  activeSpeakerPtid: string | null;
  localMicEnabled: boolean;
  localCameraEnabled: boolean;
  startedAt?: number;
  errorCode?: GroupCallErrorCode;
  pendingControl?: 'microphone' | 'camera';
  mediaRevision: number;
}

/** Read-only media observations. Credentials and capture device IDs are absent. */
export interface GroupCallMediaStats {
  connected: boolean;
  roomSid: string;
  participantSid: string;
  canPublish: boolean;
  canSubscribe: boolean;
  localLiveTracks: number;
  tracks: Array<{
    participantId: string;
    actorPtid: string;
    trackSid: string;
    kind: 'audio' | 'video';
    direction: 'inbound' | 'outbound';
    bytes: number;
    packets: number;
    frames: number;
  }>;
}

export function createIdleSnapshot(): GroupCallSnapshot {
  return {
    state: 'idle', groupUlid: '', roomName: '', mediaKind: 'audio',
    participants: [], activeSpeakerPtid: null,
    localMicEnabled: false, localCameraEnabled: false, mediaRevision: 0,
    startedAt: undefined, errorCode: undefined, pendingControl: undefined,
  };
}

export interface GroupCallProvider {
  connect(url: string, token: string, rtcConfig?: RTCConfiguration): Promise<void>;
  /** Resolves only once listeners, capture, connections and tracks are gone. */
  disconnect(): Promise<void>;
  onParticipantChanged(cb: (participants: Participant[]) => void): Unsubscribe;
  onActiveSpeaker(cb: (actorPtid: string | null) => void): Unsubscribe;
  onConnectionStateChanged(cb: (state: GroupCallConnectionState) => void): Unsubscribe;
  attachParticipantMedia(participantId: string, video: HTMLVideoElement | null, audio: HTMLAudioElement | null): Unsubscribe;
  setMicEnabled(enabled: boolean): Promise<void>;
  setCameraEnabled(enabled: boolean): Promise<void>;
  readMediaStats(): Promise<GroupCallMediaStats>;
}
