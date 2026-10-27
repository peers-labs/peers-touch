import { invoke } from '@tauri-apps/api/core';

export interface DeviceLinkClaim {
  id: string;
  deviceLabel: string;
  platform: 'android' | 'ios';
  comparisonCode: string;
}
export interface DeviceLinkProjection {
  offerId: string;
  actorPtid: string;
  stationName: string;
  qrLink: string | null;
  state: number;
  revision: number;
  expiresAtUnixMs: number;
  claims: DeviceLinkClaim[];
}

interface NativeResult<T> { ok: boolean; data?: T; error?: { message: string } }
async function call<T>(command: string, input?: Record<string, unknown>): Promise<T> {
  const result = await invoke<NativeResult<T>>(command, input ? { input } : undefined);
  if (!result.ok) throw new Error(result.error?.message ?? 'deviceLink.runtimeFailed');
  return result.data as T;
}
export const deviceLinkCommands = {
  create: () => call<DeviceLinkProjection>('device_link_create'),
  status: () => call<DeviceLinkProjection>('device_link_status'),
  cancel: () => call<void>('device_link_cancel'),
  decide: (claim: DeviceLinkClaim, observedRevision: number, allow: boolean) =>
    call<DeviceLinkProjection>('device_link_decide', {
      claimId: claim.id, comparisonCode: claim.comparisonCode, observedRevision, allow,
    }),
};
