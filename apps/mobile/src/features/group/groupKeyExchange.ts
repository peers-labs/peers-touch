import { invoke } from '@tauri-apps/api/core';

import type { MobileAuthSession } from '../auth/authSession';
import type { SocialApiErrorContext, StationErrorEnvelope, StationSuccessEnvelope } from '../social/socialTypes';
import { SocialApiError } from '../social/socialTypes';
import type { KeyBundle } from '../../gen/proto/domain/key_exchange/key_exchange_pb';
import { userScopeForSession } from './groupE2eeBridge';

const SKDM_ENVELOPE_KIND = 'GROUP_SKDM';

interface IdentityBundleOutput {
  deviceId: string;
  ikPub: string;
  spkId: number;
  spkPub: string;
  spkSig: string;
}

interface SignalingSealOutput {
  payloadB64: string;
}

interface SignalingOpenOutput {
  plaintext: string;
}

interface FetchKeyBundlePayload {
  bundles?: KeyBundle[];
}

export async function ensureMobileKeyBundlePublished(session: MobileAuthSession): Promise<void> {
  const bundle = await invoke<IdentityBundleOutput>('crypto_identity_key_bundle', {
    input: identityScopeInput(session),
  });
  await keyExchangeRequest(session, {
    path: '/key-exchange/keys/bundle',
    body: {
      ik_pub: bundle.ikPub,
      spk_id: bundle.spkId,
      spk_pub: bundle.spkPub,
      spk_sig: bundle.spkSig,
      opk_ids: [],
      opk_pubs: [],
      device_id: bundle.deviceId,
    },
  });
}

export async function openSkdmEnvelopeFromSender(
  session: MobileAuthSession,
  senderDid: string,
  sealedBytes: Uint8Array,
): Promise<Uint8Array | null> {
  const payloadB64 = bytesToBase64(sealedBytes);
  const bundles = await fetchKeyBundles(session, senderDid);
  for (const bundle of bundles) {
    const ikPub = String(bundle.ikPub || (bundle as Record<string, unknown>).ik_pub || '').trim();
    if (!ikPub) continue;
    try {
      const opened = await invoke<SignalingOpenOutput>('signaling_envelope_open', {
        input: {
          ...identityScopeInput(session),
          senderIkPub: ikPub,
          sessionUlid: skdmEnvelopeSession(senderDid),
          kind: SKDM_ENVELOPE_KIND,
          payloadB64,
        },
      });
      return base64ToBytes(opened.plaintext);
    } catch {
      // SKDM proto does not carry device_id yet; try every published IK.
    }
  }
  return null;
}

export async function sealSkdmEnvelopeForPeer(
  session: MobileAuthSession,
  peerDid: string,
  peerIkPub: string,
  skdmBytes: Uint8Array,
): Promise<string> {
  const output = await invoke<SignalingSealOutput>('signaling_envelope_seal', {
    input: {
      ...identityScopeInput(session),
      peerIkPub,
      sessionUlid: skdmEnvelopeSession(actorDidForSession(session)),
      kind: SKDM_ENVELOPE_KIND,
      plaintext: bytesToBase64(skdmBytes),
    },
  });
  return output.payloadB64;
}

export async function fetchKeyBundles(session: MobileAuthSession, did: string): Promise<KeyBundle[]> {
  const payload = await keyExchangeRequest<FetchKeyBundlePayload>(session, {
    path: '/key-exchange/keys/bundle/fetch',
    body: { did, device_id: '' },
  });
  return payload.bundles ?? [];
}

function identityScopeInput(session: MobileAuthSession) {
  return {
    userScope: userScopeForSession(session),
    actorDid: actorDidForSession(session),
  };
}

function actorDidForSession(session: MobileAuthSession): string {
  const actorDid = String(session.actor?.id || session.actor?.actorId || session.actor?.actor_id || '').trim();
  if (!actorDid) throw new Error('mobile.group.e2eeMissingActor');
  return actorDid;
}

function skdmEnvelopeSession(actorDid: string): string {
  return `group-skdm:${actorDid}`;
}

async function keyExchangeRequest<T = Record<string, unknown>>(
  session: MobileAuthSession,
  options: { path: string; body: Record<string, unknown> },
): Promise<T> {
  const stationUrl = session.stationUrl.replace(/\/+$/, '');
  const response = await fetch(`${stationUrl}${options.path}`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options.body),
  }).catch((error) => {
    throw new SocialApiError({
      method: 'POST',
      path: options.path,
      message: error instanceof Error ? error.message : String(error),
    });
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw buildApiError(options.path, response.status, payload);
  }
  return unwrapPayload<T>(payload);
}

function unwrapPayload<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return ((payload as StationSuccessEnvelope<T>).data ?? {}) as T;
  }
  return payload as T;
}

function buildApiError(path: string, status: number, payload: unknown): SocialApiError {
  const envelope = (payload && typeof payload === 'object' ? payload : {}) as StationErrorEnvelope;
  const context: SocialApiErrorContext = {
    method: 'POST',
    path,
    status,
    code: envelope.code,
    message: envelope.msg ?? envelope.message ?? envelope.detail ?? 'key exchange request failed',
  };
  return new SocialApiError(context);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
