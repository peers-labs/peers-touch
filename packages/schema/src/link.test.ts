import { describe, expect, it } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { readFileSync } from 'node:fs';
import { parse, encode } from './link';
import { SchemaActionSchema } from './gen/domain/schema/schema_pb';

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
});
