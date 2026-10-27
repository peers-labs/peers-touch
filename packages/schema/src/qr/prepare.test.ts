import { beforeAll, describe, expect, it } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { JSDOM } from 'jsdom';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { encode } from '../link';
import { SchemaActionSchema } from '../gen/domain/schema/schema_pb';
import { DeviceLinkLocatorSchema } from '../gen/domain/auth/device_link_pb';
import { prepareQr } from './prepare';
import { protectedModules } from './protectedModules';

beforeAll(() => {
  const dom = new JSDOM('');
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
});

describe('independent QR decode', () => {
  for (const style of ['classic', 'peers'] as const) for (const ratio of [1, 2, 3]) {
    it(`${style} ${ratio}x preserves ASCII and UTF-8 bytes`, async () => {
      for (const payload of ['https://example.org/scan?q=abc', 'https://example.org/你好?q=☀️']) {
        const artifact = await prepareQr({ kind: 'url', value: payload }, { style, pixelRatio: ratio });
        try {
          const bytes = await artifact.export('svg');
          const { data, info } = await sharp(Buffer.from(await bytes.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
          expect(decoded?.binaryData).toEqual([...new TextEncoder().encode(payload)]);
          expect(artifact.diagnostics.modulePixels).toBeGreaterThanOrEqual(3);
          expect(artifact.diagnostics.quietZoneModules).toBeGreaterThanOrEqual(4);
          expect(info.width).toBe(320 * ratio);
          if (style === 'peers') {
            const svg = await artifact.element();
            const expected = protectedModules(artifact.diagnostics.version).flat().filter(Boolean).length;
            expect(svg.querySelector('[data-schema-functions]')?.querySelectorAll('rect').length).toBe(expected);
          }
        } finally { artifact.dispose(); }
      }
    });
  }
  it('keeps compact Device Link Base32 references independently decodable at 280px', async () => {
    const reference = create(DeviceLinkLocatorSchema, {
      protocolVersion: 1,
      offerDigest: new Uint8Array(32).fill(1),
      expiresAtUnixMs: BigInt(Date.now() + 300_000),
      stationRootEd25519: new Uint8Array(32).fill(2),
      bootstrapSecret: new Uint8Array(32).fill(3),
      canonicalDiscoveryOrigin: 'https://station.example',
      endpointRole: 1,
    });
    const content = { kind: 'action' as const, value: create(SchemaActionSchema, {
      protocolVersion: 1, action: { case: 'deviceLinkLocator' as const, value: reference },
    }) };
    const payload = encode(content);
    expect(payload).toContain('#B32:');
    const artifact = await prepareQr(content, {
      size: 280, style: 'peers', maxVersion: 17, minModulePixels: 3
    });
    try {
      const svg = await artifact.export('svg');
      const { data, info } = await sharp(Buffer.from(await svg.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
      expect(decoded?.binaryData).toEqual([...new TextEncoder().encode(payload)]);
      expect(artifact.diagnostics.version).toBeLessThanOrEqual(17);
      expect(artifact.diagnostics.modulePixels).toBe(3);
      expect(artifact.diagnostics.errorCorrection).toBe('Q');
    } finally { artifact.dispose(); }
  });
  it('retains safety-number and provider payload bytes as presentation only', async () => {
    for (const [owner, value] of [
      ['identity.safety-number.v1', 'peers-touch:safety/v1?l_fp=aa&p_fp=bb'],
      ['channels.provider-provisioning', 'external://provider/原始载荷?token=abc'],
    ] as const) {
      const artifact = await prepareQr({ kind: 'external-protocol', owner, value });
      const blob = await artifact.export('svg');
      const { data, info } = await sharp(Buffer.from(await blob.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.binaryData).toEqual([...new TextEncoder().encode(value)]);
      artifact.dispose();
    }
  });
  it('rejects density, low contrast, missing quiet zone and expired render access', async () => {
    const content = { kind: 'url' as const, value: `https://example.org/${'x'.repeat(500)}` };
    await expect(prepareQr(content, { size: 120 })).rejects.toMatchObject({ code: 'PAYLOAD_TOO_DENSE' });
    await expect(prepareQr(content, { foreground: '#999999' })).rejects.toMatchObject({ code: 'UNSAFE_STYLE' });
    await expect(prepareQr(content, { quietZoneModules: 0 })).rejects.toMatchObject({ code: 'UNSAFE_STYLE' });
    const artifact = await prepareQr({ kind: 'url', value: 'https://example.org/' });
    artifact.dispose();
    await expect(artifact.export('svg')).rejects.toMatchObject({ code: 'ABORTED' });
  });
  it('falls back from an unsafe avatar without changing payload or lowering ECC', async () => {
    const artifact = await prepareQr({ kind: 'url', value: 'https://example.org/' }, {
      avatar: { asset: new Blob(['<svg/>'], { type: 'image/svg+xml' }) },
    });
    expect(artifact.diagnostics).toMatchObject({ avatar: false, fallback: 'AVATAR_UNAVAILABLE', errorCorrection: 'H' });
    artifact.dispose();
  });
});
