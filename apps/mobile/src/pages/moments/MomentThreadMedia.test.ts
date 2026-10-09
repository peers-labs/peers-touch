// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('mobile Moment thread and media ownership', () => {
  it('keeps ordinary comment interaction inside the feed with one selected thread', () => {
    const page = source('../MomentsPage.tsx');

    expect(page).toContain('selectedThreadPostId');
    expect(page).toContain('current === postId ? null : postId');
    expect(page).toContain('selectedThreadPostId === post.id');
    expect(page).not.toContain('if (activePostId)');
    expect(page).not.toContain('mobile-detail-page');
    expect(page).not.toContain('onOpenMoment(postId)');
  });

  it('routes private comments through the private runtime projection without public fallback', () => {
    const comments = source('./MomentCommentsSection.tsx');

    expect(comments).toContain('privateRoute ? null : (facade?.feed ?? null)');
    expect(comments).toMatch(/intents\s*\.\s*readPrivateComments/);
    expect(comments).toMatch(/intents\s*\.\s*submitPrivateComment/);
  });

  it('uses temporary media sources and releases public object URLs on close', () => {
    const overlay = source('./MomentMediaOverlay.tsx');

    expect(overlay).toContain("selection.route === 'PUBLIC'");
    expect(overlay).toContain('gateway.loadMedia');
    expect(overlay).toContain('intents.openPrivateMedia');
    expect(overlay).toContain("media?.state !== 'MEDIA_READY'");
    expect(overlay).toContain('URL.revokeObjectURL');
    expect(overlay).toContain('selection.returnFocus?.focus()');
  });
});
