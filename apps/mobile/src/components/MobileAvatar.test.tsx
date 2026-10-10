// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../runtimes/avatarAssetRuntime', () => ({
  useAvatarAsset: () => ({ source: '', src: '' }),
}));

import {
  MobileAvatar,
  mobileUserAvatarFallbackColor,
  mobileUserAvatarRadius,
} from './MobileAvatar';

describe('MobileAvatar', () => {
  it('is the shared rounded-square user identity primitive', () => {
    const markup = renderToStaticMarkup(
      <MobileAvatar identityKey="ptid:bob" name="Bob" size={28} />,
    );

    expect(markup).toContain('ant-avatar-square');
    expect(markup).toContain('mobile-user-avatar');
    expect(markup).toContain('--mobile-user-avatar-radius:8px');
    expect(markup).not.toContain('ant-avatar-circle');
    expect(mobileUserAvatarRadius(28)).toBe(8);
    expect(mobileUserAvatarRadius(42)).toBe(10);
    expect(mobileUserAvatarRadius(72)).toBe(18);
  });

  it('keeps fallback color stable for the same canonical identity', () => {
    expect(mobileUserAvatarFallbackColor('ptid:bob')).toBe(
      mobileUserAvatarFallbackColor('ptid:bob'),
    );
    expect(mobileUserAvatarFallbackColor('ptid:bob')).not.toBe(
      mobileUserAvatarFallbackColor('ptid:alice'),
    );
  });
});
