import { describe, expect, it } from 'vitest';

import {
  downloadableAvatarSource,
  inlineAvatarSource,
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
