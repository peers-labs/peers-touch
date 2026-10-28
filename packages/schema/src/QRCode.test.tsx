import { create } from '@bufbuild/protobuf';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QRCode } from './QRCode';
import { encode, parse } from './link';
import { SchemaActionSchema } from './gen/domain/schema/schema_pb';
import { DeviceLinkLocatorSchema } from './gen/domain/auth/device_link_pb';

describe('generated Device Link inputs', () => {
  it('renders a parsed locator with lossless protobuf timestamps', () => {
    const value = create(SchemaActionSchema, {
      protocolVersion: 1,
      action: { case: 'deviceLinkLocator', value: {
        protocolVersion: 1,
        offerDigest: new Uint8Array(32).fill(1),
        expiresAtUnixMs: 9_007_199_254_740_993n,
        stationRootEd25519: new Uint8Array(32).fill(2),
        bootstrapSecret: new Uint8Array(32).fill(3),
        canonicalDiscoveryOrigin: 'https://station.example',
        endpointRole: 1,
      } },
    });
    const parsed = parse(encode({ kind: 'action', value }));
    expect(parsed.status).toBe('recognized');
    if (parsed.status !== 'recognized' || parsed.link.kind !== 'action') throw new Error('Invalid fixture');
    const html = renderToString(<QRCode content={parsed.link} title="Device invitation" />);
    expect(html).toContain('data-schema-qr="preparing"');
    expect(html).toContain('width:320px');
  });

  it('encodes from the transform-immune layout box while an ancestor is scaled', async () => {
    // Production-shaped compact reference: same 368-byte length as the live
    // LAN offer (26-char discovery origin), which encodes at QR v15 and needs
    // the full 280 CSS px layout box for 3px modules.
    const reference = create(DeviceLinkLocatorSchema, {
      protocolVersion: 1,
      offerDigest: new Uint8Array(32).fill(1),
      expiresAtUnixMs: BigInt(Date.now() + 300_000),
      stationRootEd25519: new Uint8Array(32).fill(2),
      bootstrapSecret: new Uint8Array(32).fill(3),
      canonicalDiscoveryOrigin: 'https://10.37.118.48:18081',
      endpointRole: 2,
      relayEd25519: new Uint8Array(32).fill(4),
      endpointTlsTrust: { trust: { case: 'leafSpkiSha256', value: new Uint8Array(32).fill(5) } },
    });
    const encoded = encode({ kind: 'action', value: create(SchemaActionSchema, {
      protocolVersion: 1, action: { case: 'deviceLinkLocator', value: reference } }) });
    expect(encoded).toHaveLength(368);
    const parsed = parse(encoded);
    expect(parsed.status).toBe('recognized');
    if (parsed.status !== 'recognized' || parsed.link.kind !== 'action') throw new Error('Invalid fixture');
    const content = parsed.link;

    const dom = new JSDOM('');
    const globals = globalThis as unknown as { document?: unknown; window?: unknown; ResizeObserver?: unknown };
    const previous = { document: globals.document, window: globals.window, ResizeObserver: globals.ResizeObserver };
    globals.document = dom.window.document;
    globals.window = dom.window;
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    }
    globals.ResizeObserver = ResizeObserverStub;
    // Modal zoom-in (transform: scale(0.7)) shrinks painted rects but never
    // the layout box. jsdom has no layout, so pin both explicitly.
    Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', {
      configurable: true, get() { return 340; },
    });
    const nativeRect = dom.window.Element.prototype.getBoundingClientRect;
    dom.window.Element.prototype.getBoundingClientRect = function () {
      const rect = nativeRect.call(this);
      if (this.hasAttribute?.('data-schema-qr')) {
        return { ...rect, width: 238, height: 238, top: 0, left: 0, right: 238, bottom: 238, x: 0, y: 0 };
      }
      return rect;
    };

    const host = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(<QRCode content={content} title="Device invitation" errorLabel="unreadable"
          constraints={{ size: 340, style: 'peers', maxVersion: 17, minModulePixels: 4 }} />);
      });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
      const frame = host.querySelector('[data-schema-qr]');
      expect(frame?.getAttribute('data-schema-qr')).toBe('ready');
      expect(frame?.querySelector('svg')).toBeTruthy();
      expect(frame?.querySelector('[role="status"]')).toBeNull();
    } finally {
      await act(async () => { root.unmount(); });
      Object.assign(globals, previous);
    }
  });
});
