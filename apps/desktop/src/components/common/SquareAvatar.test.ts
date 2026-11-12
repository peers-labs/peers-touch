import { describe, expect, it } from 'vitest';

import {
  downloadableAvatarSource,
  inlineAvatarSource,
  isAuthoritativeAvatarAbsent,
} from './SquareAvatar';

describe('inlineAvatarSource', () => {
  it('keeps bundled image data local', () => {
    const preset = 'data:image/svg+xml;base64,PHN2Zz4=';

    expect(inlineAvatarSource(preset)).toBe(preset);
  });

  it('leaves remote and empty avatar sources to their existing paths', () => {
    expect(inlineAvatarSource('https://example.test/avatar.png')).toBeNull();
    expect(inlineAvatarSource('')).toBeNull();
    expect(inlineAvatarSource(undefined)).toBeNull();
  });
});

describe('downloadableAvatarSource', () => {
  it('rejects the retired demo image generator', () => {
    expect(downloadableAvatarSource(
      'https://internal.example.invalid/api/ide/v1/text_to_image?prompt=Alice',
    )).toBeNull();
  });

  it('keeps ordinary remote profile images on the cache path', () => {
    expect(downloadableAvatarSource('https://example.test/avatar.png'))
      .toBe('https://example.test/avatar.png');
  });
});

describe('isAuthoritativeAvatarAbsent', () => {
  it('paints initials for a known actor that simply has no avatar URL', () => {
    // Regression: avatar-less real users (e.g. a freshly registered peer) all
    // collapsed into the neutral bot glyph because an empty identity stays
    // "unresolved". A known PTID makes the absent state authoritative.
    expect(isAuthoritativeAvatarAbsent({
      identity: '',
      actorPtid: 'ptid:peer:bob',
      phase: 'unresolved',
    })).toBe(true);
  });

  it('treats an explicit asset-owner absent verdict as authoritative', () => {
    expect(isAuthoritativeAvatarAbsent({
      identity: 'https://example.test/avatar.png',
      actorPtid: 'ptid:peer:bob',
      phase: 'absent',
    })).toBe(true);
  });

  it('keeps the neutral placeholder for an unresolved actor without identity', () => {
    // r3.1 guarantee: never paint a letter when the actor itself is unknown or
    // the profile is still loading.
    expect(isAuthoritativeAvatarAbsent({
      identity: '',
      actorPtid: null,
      phase: 'unresolved',
    })).toBe(false);
    expect(isAuthoritativeAvatarAbsent({
      identity: '',
      actorPtid: '   ',
      phase: 'unresolved',
    })).toBe(false);
  });

  it('does not treat a resolving known-actor image as absent', () => {
    expect(isAuthoritativeAvatarAbsent({
      identity: 'https://example.test/avatar.png',
      actorPtid: 'ptid:peer:bob',
      phase: 'resolving',
    })).toBe(false);
  });
});
