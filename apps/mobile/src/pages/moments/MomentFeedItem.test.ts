// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Moment feed item', () => {
  it('routes every published image through the encrypted media renderer', () => {
    const contentSource = readFileSync(
      new URL('./MomentContent.tsx', import.meta.url),
      'utf8',
    );

    expect(contentSource).toContain('<MomentImage');
    expect(contentSource).toContain('attachment={images[0]}');
    expect(contentSource).toContain('attachment={image}');
    expect(contentSource).not.toContain(
      'src={images[0].thumbnailUrl || images[0].url}',
    );
    expect(contentSource).not.toContain(
      'src={image.thumbnailUrl || image.url}',
    );
  });

  it('delegates comments, author delete, navigation, and media without mounting a composer', () => {
    const source = readFileSync(
      new URL('./MomentFeedItem.tsx', import.meta.url),
      'utf8',
    );
    const contentSource = readFileSync(
      new URL('./MomentContent.tsx', import.meta.url),
      'utf8',
    );
    const actionsSource = readFileSync(
      new URL('./MomentActionsSheet.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('onOpenComments(post.id)');
    expect(source).toContain('onOpenAuthor?.(');
    expect(source).toContain(
      '<MomentContent post={post} onOpenMedia={onOpenMedia}',
    );
    expect(contentSource).toContain('onOpenMedia?.(');
    expect(source).toContain('onDelete(post.id)');
    expect(source).toContain('<MomentActionsSheet');
    expect(actionsSource).toContain('<Trash2');
    expect(actionsSource).toContain('moments-actions-sheet');
    expect(actionsSource).toContain('onPointerDown={onClose}');
    expect(actionsSource).not.toContain('moments-actions-cancel');
    expect(source).toContain('setShowActions(true)');
    expect(source).toContain('<Share2');
    expect(source).toContain(
      'className="moments-action moments-action--share"',
    );
    expect(source).toMatch(/moments-action--share"[\s\S]*?disabled/);
    expect(source).not.toContain('moments-comment-input-row');
    expect(source).not.toContain('onOpenDetail');
  });

  it('keeps reaction and mutation feedback from changing article geometry', () => {
    const source = readFileSync(
      new URL('./MomentFeedItem.tsx', import.meta.url),
      'utf8',
    );
    const styles = readFileSync(
      new URL('./Moments.css', import.meta.url),
      'utf8',
    );

    expect(source).toContain('className="moments-reaction-summary"');
    expect(source).not.toContain('moments-reaction-picker');
    expect(styles).toMatch(
      /\.moments-actions\s*\{[\s\S]*?min-height:\s*44px;/,
    );
    expect(styles).toMatch(
      /\.moments-reaction-status\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?width:\s*1px;/,
    );
  });

  it('uses the prototype action cluster and inline comment control geometry', () => {
    const styles = readFileSync(
      new URL('./Moments.css', import.meta.url),
      'utf8',
    );

    const actionGroup =
      styles.match(/\.moments-action-group\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(actionGroup).not.toContain('width: 100%');
    expect(actionGroup).toContain('justify-content: flex-end');
    expect(actionGroup).toContain('margin-left: auto');
    expect(styles).toMatch(
      /\.moments-reaction-summary\s*\{[\s\S]*?max-width:\s*80%;[\s\S]*?overflow:\s*hidden;/,
    );
    expect(styles).toMatch(
      /\.moments-comments-section--inline[\s\S]*?margin-top:\s*8px;[\s\S]*?padding:\s*6px 0 0;/,
    );
    expect(styles).toMatch(
      /\.moments-comments-section--inline \.moments-comment-input-field > input[\s\S]*?height:\s*38px;[\s\S]*?font-size:\s*13px !important;/,
    );
    expect(styles).toMatch(
      /\.moments-comments-section--inline \.moments-comment-input-field > input[\s\S]*?border-radius:\s*10px;/,
    );
    expect(styles).toMatch(
      /\.moments-comments-section--inline \.moments-comments-input > button[\s\S]*?border-radius:\s*10px;/,
    );
    const inputBlock =
      styles.match(
        /\.moments-comments-section--inline \.moments-comment-input-field > input\s*\{([\s\S]*?)\n\}/,
      )?.[1] ?? '';
    const sendBlock =
      styles.match(
        /\.moments-comments-section--inline \.moments-comments-input > button\s*\{([\s\S]*?)\n\}/,
      )?.[1] ?? '';
    expect(inputBlock).not.toMatch(/border-radius:\s*(?:50%|999px)/);
    expect(sendBlock).not.toMatch(/border-radius:\s*(?:50%|999px)/);
  });

  it('uses one direct heart reaction without an emoji picker', () => {
    const source = readFileSync(
      new URL('./MomentFeedItem.tsx', import.meta.url),
      'utf8',
    );
    const styles = readFileSync(
      new URL('./Moments.css', import.meta.url),
      'utf8',
    );

    expect(source).toContain(
      'const PRIMARY_REACTION_KIND = ReactionKind.REACTION_LOVE',
    );
    expect(source).toContain(
      'onClick={() => onReact(post.id, PRIMARY_REACTION_KIND)}',
    );
    expect(source).toContain('data-reaction-kind={PRIMARY_REACTION_KIND}');
    expect(source).not.toContain('REACTION_LONG_PRESS_MS');
    expect(source).not.toContain('setShowReactionPicker');
    expect(source).not.toContain('useMomentReactionPreferences');
    expect(source).not.toContain('data-can-scroll-left');
    expect(source).not.toContain('onPointerMove=');
    expect(source).toMatch(
      /PRIMARY_REACTION_EMOJI[\s\S]*?heartCount/,
    );
    expect(source).toContain('className="moments-more"');
    expect(source.indexOf('className="moments-more"')).toBeLessThan(
      source.indexOf('className="moments-actions"'),
    );
    expect(source).toContain('className="moments-action-count"');
    expect(styles).toMatch(
      /\.moments-action\s*\{[\s\S]*?width:\s*var\(--moments-action-size\);[\s\S]*?height:\s*var\(--moments-action-size\);[\s\S]*?flex:\s*0 0 var\(--moments-action-size\);/,
    );
    expect(styles).toMatch(
      /\.moments-action-count\s*\{[\s\S]*?position:\s*absolute;/,
    );
    expect(styles).not.toContain('.moments-reaction-picker');
    expect(styles).not.toContain('.moments-reaction-rail');
  });
});
