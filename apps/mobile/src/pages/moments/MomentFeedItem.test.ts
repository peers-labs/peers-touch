// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { submitInlineMomentComment } from './MomentFeedItem';

describe('inline Moment comments', () => {
  it('submits trimmed text and clears only after the gateway accepts it', async () => {
    const submit = vi.fn(async () => true);

    const result = await submitInlineMomentComment('  useful reply  ', submit);

    expect(submit).toHaveBeenCalledWith('useful reply');
    expect(result).toEqual({ submitted: true, nextText: '' });
  });

  it('preserves the exact typed text when submission fails', async () => {
    const submit = vi.fn(async () => false);

    const result = await submitInlineMomentComment('  keep my spacing  ', submit);

    expect(submit).toHaveBeenCalledWith('keep my spacing');
    expect(result).toEqual({
      submitted: false,
      nextText: '  keep my spacing  ',
    });
  });

  it('preserves typed text when the submit callback rejects', async () => {
    const submit = vi.fn(async () => {
      throw new Error('offline');
    });

    await expect(submitInlineMomentComment('still here', submit)).resolves.toEqual({
      submitted: false,
      nextText: 'still here',
    });
  });

  it('routes every published image through the encrypted media renderer', () => {
    const source = readFileSync(
      new URL('./MomentFeedItem.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('<MomentImage');
    expect(source).toContain('attachment={images[0]}');
    expect(source).toContain('attachment={img}');
    expect(source).not.toContain('src={images[0].thumbnailUrl || images[0].url}');
    expect(source).not.toContain('src={img.thumbnailUrl || img.url}');
  });
});
