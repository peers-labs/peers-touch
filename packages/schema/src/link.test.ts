import { describe, expect, it } from 'vitest';
import { create, toBinary } from '@bufbuild/protobuf';
import { readFileSync } from 'node:fs';
import { parse, encode, DEVICE_REFERENCE_PREFIX } from './link';
import { SchemaActionSchema } from './gen/domain/schema/schema_pb';
import { DeviceLinkLocatorSchema } from './gen/domain/auth/device_link_pb';

const vectors = JSON.parse(readFileSync(new URL('../qa/link-vectors.json', import.meta.url), 'utf8')) as {
  value: string; status: string; kind?: string;
}[];
describe('cross-runtime strict link vectors', () => {
  for (const vector of vectors) it(vector.value, () => {
    const result = parse(vector.value);
    expect(result.status).toBe(vector.status);
    if (result.status === 'recognized') expect(result.link.kind).toBe(vector.kind);
  });
  it('roundtrips registered generated actions without invoking owners', () => {
    const value = create(SchemaActionSchema, { protocolVersion: 1, action: { case: 'conversationId', value: 'conversation-1' } });
    const result = parse(encode({ kind: 'action', value }));
    expect(result.status).toBe('recognized');
    if (result.status === 'recognized') expect(result.link).toEqual({ kind: 'action', value });
  });
  it('rejects overlong UTF-8 inputs before decoding', () => {
    expect(parse(`https://example.org/${'中'.repeat(12_000)}`).status).toBe('malformed');
  });
  it('preserves the existing navigation event shape', () => {
    const value = { resource: 'cron' as const, id: 'job-1', subResource: 'runs' as const, subId: 'run-2' };
    expect(parse(encode({ kind: 'navigation', value }))).toEqual({ status: 'recognized', link: { kind: 'navigation', value } });
  });
  it('uses canonical Base32 only for compact Device Link references', () => {
    const reference = create(DeviceLinkLocatorSchema, {
      protocolVersion: 1,
      offerDigest: new Uint8Array(32).fill(1),
      expiresAtUnixMs: 1_800_000_300_000n,
      stationRootEd25519: new Uint8Array(32).fill(2),
      bootstrapSecret: new Uint8Array(32).fill(3),
      canonicalDiscoveryOrigin: 'https://station.example',
      endpointRole: 1,
    });
    const action = create(SchemaActionSchema, { protocolVersion: 1, action: { case: 'deviceLinkLocator', value: reference } });
    const compact = encode({ kind: 'action', value: action });
    expect(compact.startsWith(DEVICE_REFERENCE_PREFIX)).toBe(true);
    expect(/^[a-z0-9:/.#-]+$/i.test(compact)).toBe(true);
    const parsed = parse(compact);
    expect(parsed).toEqual({ status: 'recognized', link: { kind: 'action', value: action } });
    if (parsed.status !== 'recognized' || parsed.link.kind !== 'action') throw new Error('Compact reference was not recognized');
    expect(encode(parsed.link)).toBe(compact);
    const legacyBody = btoa(String.fromCharCode(...toBinary(DeviceLinkLocatorSchema, reference)))
      .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    const legacy = `peers-touch://device/link#${legacyBody}`;
    expect(parse(legacy).status).toBe('malformed');
    const reusedRoot = create(DeviceLinkLocatorSchema, { ...reference, endpointRole: 2, relayEd25519: reference.stationRootEd25519 });
    expect(() => encode({ kind: 'action', value: create(SchemaActionSchema, {
      protocolVersion: 1, action: { case: 'deviceLinkLocator', value: reusedRoot },
    }) })).toThrow();
  });
});
