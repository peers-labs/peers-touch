import { fromBinary, toBinary } from '@bufbuild/protobuf';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  EncryptedPayloadSchema,
  PayloadEncryptionSuite,
  SecureContentOwnerDomain,
  ViewerContentKeyEnvelopeSchema,
} from '../gen/proto/domain/secure_content/content_pb';
import {
  EncryptedObjectDescriptorSchema,
  ObjectEncryptionSuite,
  ObjectNonceStrategy,
} from '../gen/proto/domain/secure_content/object_pb';

const vectorRoot = new URL(
  '../../../../model/domain/secure_content/testdata/',
  import.meta.url,
);

const readVector = (name: string): Uint8Array => {
  const encoded = readFileSync(new URL(`${name}.hex`, vectorRoot), 'utf8').trim();
  expect(encoded).toMatch(/^(?:[0-9a-f]{2})+$/);
  return Uint8Array.from(
    encoded.match(/.{2}/g)?.map((value) => Number.parseInt(value, 16)) ?? [],
  );
};

describe('Secure Content generated contracts', () => {
  it('decodes and re-encodes the canonical encrypted payload', () => {
    const encoded = readVector('encrypted_payload');
    const payload = fromBinary(EncryptedPayloadSchema, encoded);

    expect(payload.formatVersion).toBe(1);
    expect(payload.resource?.ownerDomain).toBe(SecureContentOwnerDomain.SOCIAL);
    expect(payload.resource?.contentId).toBe('01HX');
    expect(payload.resource?.generation).toBe(7n);
    expect(payload.suite).toBe(PayloadEncryptionSuite.AES_256_GCM);
    const reencoded = toBinary(EncryptedPayloadSchema, payload);
    const roundTrip = fromBinary(EncryptedPayloadSchema, reencoded);
    expect(roundTrip).toEqual(payload);
    expect(toBinary(EncryptedPayloadSchema, roundTrip)).toEqual(reencoded);
  });

  it('decodes and re-encodes the canonical viewer envelope', () => {
    const encoded = readVector('viewer_content_key_envelope');
    const envelope = fromBinary(ViewerContentKeyEnvelopeSchema, encoded);

    expect(envelope.binding?.formatVersion).toBe(1);
    expect(envelope.binding?.planId).toBe('plan-1');
    expect(envelope.binding?.resource?.contentId).toBe('01HX');
    expect(envelope.principalEpoch).toBe(9n);
    expect(envelope.recipient.case).toBe('endpoint');
    if (envelope.recipient.case !== 'endpoint') {
      throw new Error('canonical envelope must target an endpoint');
    }
    expect(envelope.recipient.value.actor?.ptid).toBe('did:plc:bob');
    expect(envelope.recipient.value.deviceId).toBe('device-b');
    const reencoded = toBinary(ViewerContentKeyEnvelopeSchema, envelope);
    const roundTrip = fromBinary(ViewerContentKeyEnvelopeSchema, reencoded);
    expect(roundTrip).toEqual(envelope);
    expect(toBinary(ViewerContentKeyEnvelopeSchema, roundTrip)).toEqual(reencoded);
  });

  it('decodes and re-encodes the canonical object descriptor', () => {
    const encoded = readVector('encrypted_object_descriptor');
    const descriptor = fromBinary(EncryptedObjectDescriptorSchema, encoded);

    expect(descriptor.objectId).toBe('obj-1');
    expect(descriptor.storageRef).toBe('secure://obj-1');
    expect(descriptor.commitment?.ciphertextSize).toBe(42n);
    expect(descriptor.commitment?.chunkSize).toBe(1_048_576);
    expect(descriptor.commitment?.encryptionSuite).toBe(
      ObjectEncryptionSuite.AES_256_GCM_CHUNKED,
    );
    expect(descriptor.commitment?.nonceStrategy).toBe(
      ObjectNonceStrategy.COUNTER32_BE,
    );
    const reencoded = toBinary(EncryptedObjectDescriptorSchema, descriptor);
    const roundTrip = fromBinary(EncryptedObjectDescriptorSchema, reencoded);
    expect(roundTrip).toEqual(descriptor);
    expect(toBinary(EncryptedObjectDescriptorSchema, roundTrip)).toEqual(reencoded);
  });
});
