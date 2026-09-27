// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  loadMomentImageObjectUrl,
  revokeMomentImageObjectUrl,
} from './MomentImage';

describe('Moment image resource lifecycle', () => {
  it('creates a renderable URL only from gateway-owned plaintext', async () => {
    const plaintext = new Blob(['plaintext'], { type: 'image/png' });
    const gateway = {
      loadImage: vi.fn(async () => plaintext),
    };
    const createObjectUrl = vi.fn(() => 'blob:moment-image');
    const controller = new AbortController();

    await expect(loadMomentImageObjectUrl(
      gateway,
      { id: 'encrypted-cid' },
      controller.signal,
      createObjectUrl,
    )).resolves.toBe('blob:moment-image');

    expect(gateway.loadImage).toHaveBeenCalledWith(
      { id: 'encrypted-cid' },
      controller.signal,
    );
    expect(createObjectUrl).toHaveBeenCalledExactlyOnceWith(plaintext);
  });

  it('revokes the current object URL on replacement or unmount', () => {
    const revokeObjectUrl = vi.fn();

    revokeMomentImageObjectUrl('blob:moment-image', revokeObjectUrl);
    revokeMomentImageObjectUrl(null, revokeObjectUrl);

    expect(revokeObjectUrl).toHaveBeenCalledExactlyOnceWith('blob:moment-image');
  });

  it('renders only decrypted object URLs and keeps failure retryable', () => {
    const source = readFileSync(
      new URL('./MomentImage.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('<img');
    expect(source).toContain('src={state.src}');
    expect(source).not.toContain('src={attachment.url}');
    expect(source).not.toContain('src={attachment.id}');
    expect(source).toContain('data-moment-image-failure=');
    expect(source).toContain('setAttempt((current) => current + 1)');
    expect(source).toContain('revokeMomentImageObjectUrl(objectUrl)');
  });
});
