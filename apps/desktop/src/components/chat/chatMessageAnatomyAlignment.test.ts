// Source-contract: in-bubble message anatomy vs the north-star prototype —
// reply quote, date separator pill, and the link preview card.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CHAT_MESSAGE_SPACING } from './chatGeometry';
import {
  desktopChatLayoutForSurface,
  desktopChatMessageRowMaxWidth,
} from './chatPresentationPolicy';

const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');
const rowSource = readFileSync(
  new URL('./message/ChatMessageRow.tsx', import.meta.url),
  'utf8',
);
const verdictSource = readFileSync(
  new URL('./message/DeliveryVerdictMeta.tsx', import.meta.url),
  'utf8',
);

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return chatCss.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] ?? '';
}

describe('in-bubble reply quote (north-star .sk-reply-quote parity)', () => {
  it('uses the 3px / 35% currentColor bar with 8px inset and 6px bottom gap', () => {
    const quote = rule('.sc-reply-quote');
    expect(quote).toContain(
      'border-left: 3px solid color-mix(in srgb, currentColor 35%, transparent)',
    );
    expect(quote).toContain('padding: 0 0 0 8px');
    expect(quote).toContain('margin-bottom: 6px');
    expect(quote).toContain('text-align: left');
  });

  it('sets the quoted text to 11.5px / 1.4 at 80% opacity', () => {
    const text = rule('.sc-reply-quote__text');
    expect(text).toContain('font-size: 11.5px');
    expect(text).toContain('line-height: 1.4');
    expect(text).toContain('opacity: 0.8');
  });
});

describe('date separator (north-star .sk-msg-date parity)', () => {
  it('centers a 11px pill with a 6% ink wash and 3/12 padding', () => {
    const wrap = rule('.sc-msg-date');
    expect(wrap).toContain('justify-content: center');
    expect(wrap).toContain('margin: 10px 0 6px');
    const pill = rule('.sc-msg-date span');
    expect(pill).toContain('font-size: 11px');
    expect(pill).toContain('font-weight: 500');
    expect(pill).toContain('padding: 3px 12px');
    expect(pill).toContain('border-radius: 999px');
    expect(pill).toContain(
      'background: color-mix(in srgb, var(--pt-text) 6%, transparent)',
    );
  });
});

describe('link preview card (north-star .sk-link-card parity)', () => {
  it('uses the 9/11 r12 card with 7% currentColor wash and 280px cap', () => {
    const card = rule('.sc-msg-link');
    expect(card).toContain('gap: 9px');
    expect(card).toContain('margin-top: 8px');
    expect(card).toContain('padding: 9px 11px');
    expect(card).toContain('border-radius: 12px');
    expect(card).toContain(
      'background: color-mix(in srgb, currentColor 7%, transparent)',
    );
    expect(card).toContain('max-width: 280px');
  });

  it('uses 12px title and 11px url with the prototype opacity rhythm', () => {
    expect(rule('.sc-msg-link__domain')).toContain('font-size: 12px');
    const url = rule('.sc-msg-link__url');
    expect(url).toContain('font-size: 11px');
    expect(url).toContain('opacity: 0.72');
  });
});

describe('delivery receipt ticks (north-star .sk-msg-status parity)', () => {
  it('renders 11px ticks with state owned by the wrapper class, not inline color', () => {
    expect(rowSource).toContain('<CheckCheck size={11} />');
    expect(rowSource).toContain('<Check size={11} />');
    expect(rowSource).not.toContain("style={{ color: 'var(--pt-primary)' }}");
    expect(rowSource).toContain('className={`sc-msg-status is-${receiptEvidenceStatus');
    expect(rowSource).toContain('data-message-receipt=');
  });

  it('paints the ticks muted by default and pine for the read state', () => {
    const status = rule('.sc-msg-status');
    expect(status).toContain('gap: 3px');
    expect(status).toContain('color: var(--pt-muted)');
    expect(rule('.sc-msg-status.is-read')).toContain('color: var(--pt-primary)');
  });
});

describe('message stream rhythm (north-star .sk-msg-stream / .sk-msg parity)', () => {
  it('gives the main surface the prototype 78% row cap with 32/9 avatar geometry', () => {
    const main = desktopChatLayoutForSurface('desktop-main');
    expect(desktopChatMessageRowMaxWidth(main, { own: true })).toBe('min(78%, 740px)');
    expect(desktopChatMessageRowMaxWidth(main, { own: false })).toBe('min(78%, 740px)');
    expect(main.avatarSize).toBe(32);
    expect(main.avatarGap).toBe(9);
    expect(main.bubblePadding).toBe('10px 14px');
  });

  it('separates main-surface rows with the prototype 14px stream gap', () => {
    expect(CHAT_MESSAGE_SPACING.item).toBe(14);
    expect(CHAT_MESSAGE_SPACING.compactItem).toBe(6);
    expect(rowSource).toContain('CHAT_MESSAGE_SPACING.item');
  });

  it('shares a tight 12px column inset between the stream and the composer', () => {
    expect(rule('.sc-conversation__stream')).toContain('padding: 12px 12px 6px');
    const main = desktopChatLayoutForSurface('desktop-main');
    // One 12px horizontal frame for the whole column so the composer shell
    // edges align with the message bubbles (WeChat parity); the 4px/10px
    // vertical inset keeps the composer sitting high.
    expect(main.composerOuterPadding).toBe('4px 12px 10px');
  });

  it('sets bubble→meta 6px with 6px meta item gap (.sk-msg-under)', () => {
    const meta = rule('.sc-msg-meta');
    expect(meta).toContain('margin-top: 6px');
    expect(meta).toContain('gap: 6px');
  });

  it('renders group sender labels as regular 11px with the 3px col gap', () => {
    const sender = rule('.sc-msg-sender');
    expect(sender).toContain('font-size: 11px');
    expect(sender).toContain('margin-bottom: 3px');
    expect(sender).not.toContain('font-weight');
  });
});

describe('delivery verdict meta (north-star .sk-msg-status.is-failed parity)', () => {
  it('drives tone from the evidence state attribute with a compact modifier, not inline color', () => {
    expect(verdictSource).toContain(
      "className={compact ? 'sc-verdict sc-verdict--compact' : 'sc-verdict'}",
    );
    expect(verdictSource).toContain('data-message-delivery-state={verdict.kind}');
    expect(verdictSource).not.toContain('style=');
    expect(rule('.sc-verdict')).toContain('font-size: 11px');
    expect(rule('.sc-verdict--compact')).toContain('font-size: 10px');
  });

  it('uses the prototype fixed failure red with warning/secondary state tones', () => {
    expect(chatCss).toContain(
      ".sc-verdict[data-message-delivery-state='failed_terminal'] { color: #b0413a; }",
    );
    expect(chatCss).toContain(
      ".sc-verdict[data-message-delivery-state='fully_delivered'] { color: var(--pt-secondary); }",
    );
    expect(chatCss).toContain(
      ".sc-verdict[data-message-delivery-state='undeliverable_suspected'] { color: var(--pt-warning); }",
    );
  });
});
