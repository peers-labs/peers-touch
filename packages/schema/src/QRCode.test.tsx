import { create } from '@bufbuild/protobuf';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QRCode } from './QRCode';
import { encode, parse } from './link';
import { SchemaActionSchema } from './gen/domain/schema/schema_pb';

describe('generated Device Link inputs', () => {
  it('renders a parsed locator with lossless protobuf timestamps', () => {
    const value = create(SchemaActionSchema, {
      protocolVersion: 1,
      action: { case: 'deviceLinkLocator', value: { expiresAtUnixMs: 9_007_199_254_740_993n } },
    });
    const parsed = parse(encode({ kind: 'action', value }));
    expect(parsed.status).toBe('recognized');
    if (parsed.status !== 'recognized' || parsed.link.kind !== 'action') throw new Error('Invalid fixture');
    const html = renderToString(<QRCode content={parsed.link} title="Device invitation" />);
    expect(html).toContain('data-schema-qr="preparing"');
    expect(html).toContain('width:320px');
  });
});
