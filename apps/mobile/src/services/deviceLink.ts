import { invoke } from '@tauri-apps/api/core';
import type {
  NativeAccessSubmitInput,
  NativeStationRouteCandidate,
  OAuthAccessDecisionProjection,
} from './mobileCommands';
import type { NativeSessionProjection } from '../runtimes/sessionRuntime';

/** Redacted native projection. QR payloads, capabilities and keys stay in Rust. */
export interface DeviceLinkProjection {
  phase: 'idle' | 'linking' | 'cancelling' | 'committed';
  state: number;
  stationPeerId: string;
  stationOrigin: string;
  actorPtid: string;
  actorLabel: string;
  deviceId: string;
  comparisonCode: string;
  expiresAtUnixMs: number;
  revision: number;
  accessDecision: OAuthAccessDecisionProjection | null;
  session: NativeSessionProjection | null;
  route: NativeStationRouteCandidate | null;
  routeRevision: number;
}

export const scanDeviceLink = () => invoke<DeviceLinkProjection>('device_link_scan');
export const readDeviceLink = () => invoke<DeviceLinkProjection>('device_link_status');
export const cancelDeviceLink = () => invoke<DeviceLinkProjection>('device_link_cancel');
export const submitDeviceLink = (input: NativeAccessSubmitInput) =>
  invoke<DeviceLinkProjection>('device_link_submit', { input });
