import { create } from '@bufbuild/protobuf';
import {
  AudienceSchema,
  Audience_Kind,
  ImageAttachmentSchema,
  type Audience,
  type ImageAttachment,
} from '../gen/proto/domain/social/post_pb';
import { AudienceKeyEnvelopeSchema } from '../gen/proto/domain/social/media_pb';
import { EncryptedMediaDescriptorSchema } from '../gen/proto/domain/common/common_pb';
import { api } from './desktop_api';
import { socialGetFollowers, type MomentDraft } from './social_api';
import { currentAuthenticatedActorPtid } from '../store/session';
import { log } from '../utils/logger';

const TAG = 'moment-audience-keys';
const MOMENT_MEDIA_KEY_ENVELOPE_KIND = 'MOMENT_MEDIA_KEY';
const MOMENT_MEDIA_KEY_ENVELOPE_SUITE = 'signaling-envelope-x3dh-aes256gcm/media-key-v1';
const FOLLOWER_PAGE_SIZE = 100;

interface SealedMomentMediaKeyPayload {
  v: 1;
  kind: 'moment-media-key';
  cid: string;
  keyB64: string;
}

export async function sealMomentDraftAudienceKeys(
  draft: MomentDraft,
  authorPtid: string | null | undefined,
): Promise<MomentDraft> {
  if (draft.kind !== 'image') return draft;
  if (!draft.images?.length) return draft;
  if (!draft.audience || draft.audience.kind === Audience_Kind.PUBLIC) return draft;

  const normalizedAuthorDid = String(authorPtid ?? '').trim();
  if (!normalizedAuthorDid) throw new Error('moment-audience-keys:missing-author-did');

  const recipients = await resolveAudienceRecipientDids(draft.audience, normalizedAuthorDid);
  if (recipients.length === 0) throw new Error('moment-audience-keys:empty-recipient-set');

  const keyEnvelopes = [];
  for (const image of draft.images) {
    const cid = image.url || image.id;
    const keyB64 = image.mediaEncryption?.keyB64?.trim() ?? '';
    if (!cid || !keyB64) throw new Error('moment-audience-keys:image-key-missing');
    const payload: SealedMomentMediaKeyPayload = {
      v: 1,
      kind: 'moment-media-key',
      cid,
      keyB64,
    };
    const plaintext = JSON.stringify(payload);
    const sessionUlid = momentMediaKeySession(normalizedAuthorDid, cid);

    for (const recipientPtid of recipients) {
      const bundles = await fetchRecipientBundles(recipientPtid);
      for (const bundle of bundles) {
        const peerIk = String(bundle.ik_pub ?? '').trim();
        const deviceId = String(bundle.device_id ?? '').trim();
        if (!peerIk || !deviceId) continue;
        const sealed = await api.signalingEnvelopeSeal(
          peerIk,
          sessionUlid,
          MOMENT_MEDIA_KEY_ENVELOPE_KIND as never,
          plaintext,
        );
        keyEnvelopes.push(create(AudienceKeyEnvelopeSchema, {
          recipientPtid: recipientPtid,
          deviceId,
          keyId: cid,
          encryptedKey: base64ToBytes(sealed.payload_b64),
          suite: MOMENT_MEDIA_KEY_ENVELOPE_SUITE,
        }));
      }
    }
  }

  if (keyEnvelopes.length === 0) throw new Error('moment-audience-keys:no-key-envelopes-created');

  const audience = create(AudienceSchema, {
    ...draft.audience,
    keyEnvelopes,
  });
  const images = draft.images.map(stripInlineImageKey);
  return { ...draft, audience, images };
}

export async function openMomentMediaKeyFromAudience(
  input: {
    cid: string;
    audience?: Audience | null;
    authorPtid?: string | null;
  },
): Promise<string | null> {
  const cid = input.cid.trim();
  if (!cid || !input.audience?.keyEnvelopes?.length) return null;

  const localDid = currentAuthenticatedActorPtid();
  if (!localDid) return null;

  let localDeviceId = '';
  try {
    localDeviceId = String((await api.accountGetDeviceId())?.device_id ?? '').trim();
  } catch (err) {
    log.warn(TAG, 'accountGetDeviceId failed while opening moment media key', err);
    return null;
  }

  const envelope = input.audience.keyEnvelopes.find((item) => {
    if (item.keyId !== cid) return false;
    if (item.recipientPtid && item.recipientPtid !== localDid) return false;
    return !localDeviceId || !item.deviceId || item.deviceId === localDeviceId;
  });
  if (!envelope) return null;

  const authorPtid = String(input.authorPtid ?? '').trim();
  if (!authorPtid) return null;

  let authorBundles;
  try {
    authorBundles = (await api.keyExchangeFetchBundle(authorPtid)).bundles ?? [];
  } catch (err) {
    log.warn(TAG, 'fetch author bundles failed while opening moment media key', err);
    return null;
  }

  const payloadB64 = bytesToBase64(envelope.encryptedKey);
  const sessionUlid = momentMediaKeySession(authorPtid, cid);
  for (const bundle of authorBundles) {
    const senderIk = String(bundle.ik_pub ?? '').trim();
    if (!senderIk) continue;
    try {
      const opened = await api.signalingEnvelopeOpen(
        senderIk,
        sessionUlid,
        MOMENT_MEDIA_KEY_ENVELOPE_KIND as never,
        payloadB64,
      );
      const decoded = JSON.parse(opened.plaintext) as Partial<SealedMomentMediaKeyPayload>;
      if (decoded.v === 1 && decoded.kind === 'moment-media-key' && decoded.cid === cid && decoded.keyB64) {
        return decoded.keyB64;
      }
    } catch {
      // Try the next published author device bundle. The envelope binds to
      // the sender identity key, so only the originating bundle will open it.
    }
  }
  return null;
}

async function resolveAudienceRecipientDids(audience: Audience, authorPtid: string): Promise<string[]> {
  const recipients = new Set<string>([authorPtid]);
  switch (audience.kind) {
    case Audience_Kind.SELF:
      break;
    case Audience_Kind.CUSTOM_ALLOW:
      for (const did of audience.actorPtids) addDid(recipients, did);
      break;
    case Audience_Kind.FOLLOWERS:
      for (const did of await listAllFollowerDids()) addDid(recipients, did);
      break;
    case Audience_Kind.CUSTOM_DENY: {
      if (audience.baseKind !== Audience_Kind.FOLLOWERS) {
        throw new Error('moment-audience-keys:custom-deny-public-not-enumerable');
      }
      for (const did of await listAllFollowerDids()) addDid(recipients, did);
      for (const did of audience.actorPtids) recipients.delete(did);
      break;
    }
    case Audience_Kind.CIRCLE:
    case Audience_Kind.GROUP:
      throw new Error('moment-audience-keys:audience-membership-expansion-unavailable');
    default:
      throw new Error('moment-audience-keys:unsupported-audience-kind');
  }
  return [...recipients].filter(Boolean);
}

async function listAllFollowerDids(): Promise<string[]> {
  const out: string[] = [];
  let cursor = '';
  do {
    const page = await socialGetFollowers(undefined, cursor || undefined, FOLLOWER_PAGE_SIZE);
    for (const follower of page.followers) addDidToArray(out, follower.actorPtid);
    cursor = page.nextCursor || '';
  } while (cursor);
  return out;
}

async function fetchRecipientBundles(did: string) {
  const resp = await api.keyExchangeFetchBundle(did);
  const bundles = resp.bundles ?? [];
  if (bundles.length === 0) throw new Error('moment-audience-keys:recipient-has-no-key-bundle');
  return bundles;
}

function stripInlineImageKey(image: ImageAttachment): ImageAttachment {
  if (!image.mediaEncryption) return image;
  return create(ImageAttachmentSchema, {
    ...image,
    mediaEncryption: create(EncryptedMediaDescriptorSchema, {
      ...image.mediaEncryption,
      keyB64: '',
    }),
  });
}

function momentMediaKeySession(authorPtid: string, cid: string): string {
  return `moment-media-key:${authorPtid}:${cid}`;
}

function addDid(target: Set<string>, did: string): void {
  const normalized = did.trim();
  if (normalized) target.add(normalized);
}

function addDidToArray(target: string[], did: string): void {
  const normalized = did.trim();
  if (normalized && !target.includes(normalized)) target.push(normalized);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
