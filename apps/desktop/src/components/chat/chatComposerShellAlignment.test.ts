// Source-contract: the main composer follows WeChat grammar — a vertical
// shell with the textarea filling the full top region (the large editable
// area) and a separate footer row holding borderless tool glyphs left and the
// expand/send controls right. 13.5px / 1.55 type, instant auto-grow, 34px
// circular quiet tools, and a borderless paper-plane send (no black chip).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const composerSource = readFileSync(
  new URL('./ChatComposer.tsx', import.meta.url),
  'utf8',
);
const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const stripped = chatCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const blockRe = /(?:^|\})([^{}]*)\{([^}]*)\}/gm;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(stripped))) {
    const selectors = match[1].split(',').map((part) => part.trim());
    if (selectors.includes(selector)) return match[2];
  }
  return '';
}

describe('composer vertical shell (WeChat grammar)', () => {
  it('lays the textarea above a footer row instead of one bottom-aligned row', () => {
    expect(composerSource).toContain('sc-composer__input-wrap');
    expect(composerSource).toContain('sc-composer__footer');
    const footer = rule('.sc-composer__footer');
    expect(footer).toContain('display: flex');
    expect(footer).toContain('justify-content: space-between');
    expect(footer).toContain('align-items: center');
  });

  it('uses the 13.5px / 1.55 textarea that fills the full shell width', () => {
    const input = rule('.sc-composer__input');
    expect(input).toContain('width: 100%');
    expect(input).toContain('font-size: 13.5px');
    expect(input).toContain('line-height: 1.55');
    expect(input).toContain('min-height: var(--sc-composer-input-min-height, 34px)');
    const wrap = rule('.sc-composer__input-wrap');
    expect(wrap).toContain('flex: 1 1 auto');
  });

  it('does not animate auto-grow heights (prototype grows instantly)', () => {
    expect(composerSource).not.toContain('0.18s ease');
  });

  it('renders tool glyphs and send as a matched set of 34px squircle tiles', () => {
    // UI identity: icon tiles are rounded squares (r8), never pure circles.
    expect(rule('.sc-composer__tool.pt-button')).toContain('border-radius: 8px');
    const send = rule('.sc-composer__send.pt-icon-button');
    expect(send).toContain('width: 34px');
    expect(send).toContain('height: 34px');
    expect(send).toContain('border-radius: 8px');
  });

  it('keeps the send control borderless in every state (no black filled chip)', () => {
    // WeChat parity: the paper-plane is a quiet glyph — transparent fill/ring
    // at rest, accent ink only when a draft is sendable.
    const send = rule('.sc-composer__send.pt-icon-button');
    expect(send).toContain('background: transparent');
    expect(send).toContain('border-color: transparent');
    expect(rule(".sc-composer__send.pt-icon-button[aria-disabled='true']")).toContain(
      'background: transparent',
    );
    expect(rule('.sc-composer__send.pt-icon-button:not([aria-disabled])')).toContain(
      'color: var(--pt-accent)',
    );
    // The send button must not use the primary filled emphasis — its IconButton
    // is quiet so the paper-plane stays a borderless glyph in both states.
    expect(composerSource).toContain('actionId="chat-send-message"');
    const sendButtonBlock =
      composerSource.match(
        /<IconButton\s+actionId="chat-send-message"[\s\S]*?\/>/,
      )?.[0] ?? '';
    expect(sendButtonBlock).toContain('emphasis="quiet"');
    expect(sendButtonBlock).not.toContain('emphasis="primary"');
  });
});

describe('composer expand toggle and frame inset', () => {
  it('renders the expand/collapse control wired to the input size state', () => {
    expect(composerSource).toContain('actionId="composer-expand"');
    expect(composerSource).toContain('handleToggleInputExpanded');
    expect(composerSource).toContain('inputExpanded');
  });

  it('emits expanded min()/max() CSS lengths without appending an invalid px suffix', () => {
    // Regression guard: expanded policy values are strings like
    // 'min(120px, 22vh)'. Template-appending px produced an invalid declaration
    // that silently disabled min/max-height. Numbers still get px via cssLength.
    expect(composerSource).toContain('const cssLength = (length: number | string): string =>');
    expect(composerSource).toContain("typeof length === 'number' ? `${length}px` : length");
    expect(composerSource).toContain("'--sc-composer-input-min-height': cssLength(inputMinHeight)");
    expect(composerSource).toContain("'--sc-composer-input-max-height': cssLength(inputMaxHeight)");
    expect(composerSource).not.toContain('`${inputMinHeight}px`');
    expect(composerSource).not.toContain('`${inputMaxHeight}px`');
  });

  it('frames the main composer with the tight 12px WeChat column inset', () => {
    const policySource = readFileSync(
      new URL('./chatPresentationPolicy.ts', import.meta.url),
      'utf8',
    );
    expect(policySource).toContain("composerOuterPadding: '4px 12px 10px'");
  });

  it('makes the whole input region click-to-focus, not only the textarea itself', () => {
    // IM parity: tapping empty pill area must focus the textarea. A plain
    // FieldFrame div would otherwise swallow the click with no focus change.
    expect(composerSource).toContain('className="sc-composer__input-wrap"');
    expect(composerSource).toContain('onMouseDown');
    expect(composerSource).toContain('textareaRef.current?.focus()');
    // Native textarea clicks keep their own caret placement (early return).
    expect(composerSource).toContain(
      'if (event.target === textareaRef.current) return;',
    );
  });

  it('notifies the parent only when the textarea height actually changes', () => {
    // The parent re-anchors the stream tail on this signal so a growing
    // composer pushes the last message up instead of covering it.
    expect(composerSource).toContain('onComposerGeometryChange?: () => void');
    expect(composerSource).toContain('dataset.composerHeight');
    expect(composerSource).toContain('onGeometryChangeRef.current?.()');
  });

  it('keeps the main composer frame transparent so no solid white band is painted', () => {
    // The grey shell is the only visible surface. The outer composer zone must
    // default to transparent, letting the conversation surface show through.
    expect(composerSource).toContain(
      "background: surfaceBackground ?? 'transparent'",
    );
    expect(composerSource).not.toContain(
      "background: surfaceBackground ?? 'var(--pt-canvas)'",
    );
  });
});

describe('composer emoji panel (WeChat-parity legible grid)', () => {
  it('is a 400px / 12px-inset popover with a 10-column cell grid', () => {
    const panel = rule('.sc-emoji-panel');
    expect(panel).toContain('width: 400px');
    expect(panel).toContain('padding: 12px');
    expect(panel).toContain('gap: 12px');
    const grid = rule('.sc-emoji-panel__grid');
    expect(grid).toContain('grid-template-columns: repeat(10, 1fr)');
    expect(grid).toContain('gap: 4px');
  });

  it('renders cells as 28px text on 8px-radius hover tiles', () => {
    const item = rule('.sc-emoji-panel__item');
    expect(item).toContain('font-size: 28px');
    expect(item).toContain('border-radius: 8px');
    expect(item).toContain('padding: 6px 0');
  });
});
