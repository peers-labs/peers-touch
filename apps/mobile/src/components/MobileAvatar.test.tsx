// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const avatarProjection = vi.hoisted(() => ({
  current: {
    source: '',
    src: '',
    status: 'empty',
  },
}));
vi.mock('../runtimes/avatarAssetRuntime', () => ({
  useAvatarAsset: () => avatarProjection.current,
}));

import {
  MobileAvatar,
  mobileUserAvatarFallbackColor,
  mobileUserAvatarRadius,
} from './MobileAvatar';

describe('MobileAvatar', () => {
  beforeEach(() => {
    avatarProjection.current = {
      source: '',
      src: '',
      status: 'empty',
    };
  });

  it('uses size-derived rounded-square geometry for people', () => {
    const markup = renderToStaticMarkup(
      <MobileAvatar identityKey="ptid:bob" name="Bob" size={28} />,
    );

    expect(markup).toContain('ant-avatar-square');
    expect(markup).not.toContain('ant-avatar-circle');
    expect(markup).toContain('mobile-user-avatar');
    expect(markup).toContain('mobile-user-avatar-person');
    expect(markup).toContain('data-identity-role="person"');
    expect(markup).toContain('--mobile-user-avatar-radius:8px');
    expect(mobileUserAvatarRadius(28)).toBe(8);
  });

  it('uses rounded-square geometry for groups', () => {
    const markup = renderToStaticMarkup(
      <MobileAvatar identityKey="group:design" identityRole="group" name="Design" size={42} />,
    );

    expect(markup).toContain('ant-avatar-square');
    expect(markup).not.toContain('ant-avatar-circle');
    expect(markup).toContain('mobile-user-avatar-group');
    expect(markup).toContain('data-identity-role="group"');
    expect(markup).toContain('--mobile-user-avatar-radius:10px');
    expect(mobileUserAvatarRadius(42)).toBe(10);
    expect(mobileUserAvatarRadius(72)).toBe(18);
  });

  it('reserves avatar geometry while the source is loading', () => {
    avatarProjection.current = {
      source: 'https://station.example/avatar',
      src: '',
      status: 'loading',
    };

    const markup = renderToStaticMarkup(
      <MobileAvatar identityKey="ptid:bob" name="Bob" size={44} />,
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('data-avatar-state="loading"');
    expect(markup).toContain('mobile-user-avatar-loading');
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
