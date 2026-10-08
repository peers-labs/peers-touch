// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Moment feed item', () => {
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

  it('delegates comments, author delete, navigation, and media without mounting a composer', () => {
    const source = readFileSync(
      new URL('./MomentFeedItem.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('onOpenComments(post.id)');
    expect(source).toContain('onOpenAuthor?.(');
    expect(source).toContain('onOpenMedia?.(');
    expect(source).toContain('onDelete(post.id)');
    expect(source).toContain('<Trash2');
    expect(source).toContain('moments-post-action-sheet');
    expect(source).toContain('setShowActions(true)');
    expect(source).toContain('<Share2');
    expect(source).toContain('className="moments-action moments-action--share"');
    expect(source).toMatch(/moments-action--share"[\s\S]*?disabled/);
    expect(source).not.toContain('moments-comment-input-row');
    expect(source).not.toContain('onOpenDetail');
  });
});
