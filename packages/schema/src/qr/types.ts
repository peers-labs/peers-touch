import type { LinkInput } from '../link';

export type ExternalQrOwner =
  | 'identity.safety-number.v1'
  | 'channels.provider-provisioning'
  | 'channels.requester-authorization';
export type QrContent = LinkInput | { kind: 'external-protocol'; owner: ExternalQrOwner; value: string };
export interface QrConstraints {
  size?: number;
  pixelRatio?: number;
  style?: 'classic' | 'peers';
  errorCorrection?: 'M' | 'Q' | 'H';
  quietZoneModules?: number;
  maxVersion?: number;
  minModulePixels?: number;
  maxPayloadBytes?: number;
  foreground?: string;
  background?: string;
  avatar?: { asset: Blob; shape?: 'circle' | 'rounded'; fraction?: number };
}
export interface QrDiagnostics {
  payloadDigest: string;
  bytes: number;
  version: number;
  modules: number;
  modulePixels: number;
  quietZoneModules: number;
  errorCorrection: 'M' | 'Q' | 'H';
  style: 'classic' | 'peers';
  avatar: boolean;
  fallback?: 'AVATAR_UNAVAILABLE' | 'UNSAFE_STYLE';
}
export interface QrArtifact {
  readonly size: number;
  readonly diagnostics: Readonly<QrDiagnostics>;
  element(): Promise<SVGElement>;
  export(format: 'svg' | 'png'): Promise<Blob>;
  dispose(): void;
}
