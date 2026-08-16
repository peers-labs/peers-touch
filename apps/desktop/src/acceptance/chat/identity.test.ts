import { describe, expect, it } from 'vitest';
import { requireCanonicalAcceptancePtid } from './identity';

describe('requireCanonicalAcceptancePtid', () => {
  it('returns a canonical PTID', () => {
    expect(requireCanonicalAcceptancePtid('  ptid:v1:actor:peers:p:alice:1220abc  '))
      .toBe('ptid:v1:actor:peers:p:alice:1220abc');
  });

  it.each([null, undefined, '', '347818929701257219', 'did:peer:alice'])(
    'rejects non-canonical identity %s',
    (value) => {
      expect(() => requireCanonicalAcceptancePtid(value))
        .toThrow('authenticated actor has no canonical PTID');
    },
  );
});
