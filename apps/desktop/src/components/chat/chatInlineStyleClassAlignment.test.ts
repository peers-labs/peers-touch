// Source-contract: static chat layout (media fills, native audio, spacers,
// sentinels, error glyph tone) is owned by CSS classes, not inline styles.
// Dynamic values (JS-measured widths/heights, runtime color variables) stay
// inline by design.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');
const northstarCss = readFileSync(new URL('../../ui/northstar.css', import.meta.url), 'utf8');
const composer = readFileSync(new URL('./ChatComposer.tsx', import.meta.url), 'utf8');
const detail = readFileSync(new URL('./ChatDetailPanel.tsx', import.meta.url), 'utf8');
const area = readFileSync(new URL('./ChatMessageArea.tsx', import.meta.url), 'utf8');
const list = readFileSync(new URL('./ChatSessionList.tsx', import.meta.url), 'utf8');
const senderCard = readFileSync(
  new URL('./message/MessageSenderProfileCard.tsx', import.meta.url),
  'utf8',
);

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

describe('composer draft media and voice preview', () => {
  it('fills the preview tile via CSS, matching .sk-draft-thumb img', () => {
    expect(composer).toContain('<img src={item.previewUrl} alt="" />');
    expect(composer).toContain('<video src={item.previewUrl} muted />');
    expect(composer).not.toContain("objectFit: 'cover'");
    const fill = chatCss.match(
      /\.sc-composer__draft-preview img,[\s\S]*?\.sc-composer__draft-preview video\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(fill).toContain('width: 100%');
    expect(fill).toContain('height: 100%');
    expect(fill).toContain('object-fit: cover');
  });

  it('stretches the native preview audio via CSS', () => {
    expect(composer).toContain('data-chat-voice-preview');
    expect(composer).not.toContain('height: 34');
    const audio = rule(chatCss, '.sc-composer__voice-draft audio');
    expect(audio).toContain('flex: 1');
    expect(audio).toContain('height: 34px');
  });
});

describe('composer staging grammar (north-star .sk-draft-card / .sk-voice-* parity)', () => {
  it('mounts staging rows above the pill, outside .sc-composer__shell', () => {
    const shellAt = composer.indexOf('className="sc-composer__shell"');
    expect(composer.indexOf('className="sc-composer__recording"')).toBeGreaterThan(0);
    expect(composer.indexOf('className="sc-composer__recording"')).toBeLessThan(shellAt);
    expect(composer.indexOf('className="sc-composer__voice-draft"')).toBeLessThan(shellAt);
    expect(composer.indexOf('className="sc-composer__drafts"')).toBeLessThan(shellAt);
  });

  it('lays draft cards as 148px horizontal grids with a 44px thumb', () => {
    const strip = rule(chatCss, '.sc-composer__drafts');
    expect(strip).toContain('padding: 0 2px');
    const card = rule(chatCss, '.sc-composer__draft');
    expect(card).toContain('flex: 0 0 148px');
    expect(card).toContain('grid-template-columns: 44px minmax(0, 1fr) auto');
    expect(card).toContain('border-radius: 12px');
    const thumb = rule(chatCss, '.sc-composer__draft-preview');
    expect(thumb).toContain('width: 44px');
    expect(thumb).toContain('height: 44px');
    expect(thumb).toContain('border-radius: 9px');
  });

  it('uses the prototype red wash for failed cards', () => {
    const failed = rule(chatCss, '.sc-composer__draft.is-failed');
    expect(failed).toContain('color-mix(in srgb, #b0413a 45%, transparent)');
    expect(failed).toContain('color-mix(in srgb, #b0413a 6%, var(--pt-surface))');
  });

  it('stacks 24px retry/remove ops vertically, retry before remove', () => {
    expect(rule(chatCss, '.sc-composer__draft-actions')).toContain('flex-direction: column');
    const op = rule(chatCss, '.sc-composer__draft-action.pt-button');
    expect(op).toContain('width: 24px');
    expect(op).toContain('border-radius: 6px');
    const cardTemplate = composer.slice(
      composer.indexOf('className="sc-composer__draft-actions"'),
      composer.indexOf('className="sc-composer__shell"'),
    );
    expect(cardTemplate.indexOf('composer-retry-upload-')).toBeGreaterThan(-1);
    expect(cardTemplate.indexOf('composer-retry-upload-')).toBeLessThan(
      cardTemplate.indexOf('composer-remove-attachment-'),
    );
  });

  it('paints an indeterminate 3px overlay progress track, not a native progress', () => {
    expect(composer).not.toContain('<progress');
    expect(composer).toContain('role="progressbar"');
    expect(composer).toContain('sc-composer__draft-progress-bar');
    const track = rule(chatCss, '.sc-composer__draft-progress');
    expect(track).toContain('height: 3px');
    expect(track).toContain('position: absolute');
  });

  it('paints recording and voice-preview rows as self-contained tiles above the pill', () => {
    const recording = rule(chatCss, '.sc-composer__recording');
    expect(recording).toContain('border-radius: 12px');
    expect(recording).toContain('background: var(--pt-subtle)');
    expect(rule(chatCss, '.sc-composer__recording-dot')).toContain('#b0413a');
    const voice = rule(chatCss, '.sc-composer__voice-draft');
    expect(voice).toContain('border-radius: 12px');
    expect(rule(chatCss, '.sc-composer__voice-discard.pt-button')).toContain(
      'border-radius: 50%',
    );
  });
});

describe('composer reply/edit banner (north-star .sk-reply-bar parity)', () => {
  it('is a flat subtle tile without rail/shadow, with a class-driven body', () => {
    const banner = rule(chatCss, '.sc-composer__banner');
    expect(banner).toContain('padding: 8px 12px');
    expect(banner).toContain('border-radius: 12px');
    expect(banner).toContain('background: var(--pt-subtle)');
    expect(banner).not.toContain('border-left');
    expect(banner).not.toContain('box-shadow');
    expect(composer).toContain('className="sc-composer__banner-body"');
    expect(composer).not.toContain('minWidth: 0, flex: 1');
    const label = rule(chatCss, '.sc-composer__banner-label');
    expect(label).toContain('font-size: 10.5px');
    expect(label).toContain('font-weight: 650');
  });

  it('uses a 26px circular quiet cancel with 14px glyph', () => {
    expect(composer).toContain('className="sc-composer__banner-cancel"');
    expect(composer).toContain('<X size={14} />');
    const cancel = chatCss.match(
      /\.sc-composer__banner-cancel\.pt-button\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(cancel).toContain('width: 26px');
    expect(cancel).toContain('border-radius: 50%');
  });
});

describe('detail panel static chrome', () => {
  it('uses a class for the 16px scroll spacer and full-width member select', () => {
    expect(detail).toContain('className="sc-detail__scroll-spacer"');
    expect(detail).not.toContain('style={{ height: 16 }}');
    expect(rule(chatCss, '.sc-detail__scroll-spacer')).toContain('height: 16px');
    expect(detail).toContain('className="sc-detail__member-select"');
    expect(detail).not.toContain("style={{ width: '100%' }}");
    const memberSelect = chatCss.match(/\.sc-detail__member-select\.pt-select\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(memberSelect).toContain('width: 100%');
  });

  it('drives section rhythm from a relaxed modifier, not inline gap numbers', () => {
    expect(detail).not.toContain('style={{ gap }}');
    expect(detail).not.toContain('gap?: number');
    expect(detail).toContain('<DetailSection title={t(\'chat.social.detail.permissionLabel\')} relaxed>');
    expect(detail).not.toContain('<DetailSection gap={10}>');
    expect(rule(chatCss, '.sc-detail-section')).toContain('gap: 8px');
    const relaxed = chatCss.match(
      /\.sc-detail-section--relaxed,\s*\.sc-detail-section--relaxed \.sc-detail-section__card\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(relaxed).toContain('gap: 10px');
  });
});

describe('peer presence chip', () => {
  it('is class/data-state driven with the pine accent for online, never inline', () => {
    expect(area).toContain('className="sc-presence-tag"');
    expect(area).toContain('className="sc-presence-tag__dot"');
    expect(area).toContain("data-online={online ? '1' : '0'}");
    expect(area).not.toContain("'var(--pt-success)'");
    const tag = rule(chatCss, '.sc-presence-tag');
    expect(tag).toContain('font-size: 10px');
    expect(tag).toContain('color: var(--pt-muted)');
    expect(rule(chatCss, ".sc-presence-tag[data-online='1']")).toContain(
      'color: var(--pt-accent)',
    );
    expect(rule(chatCss, ".sc-presence-tag[data-online='1'] .sc-presence-tag__dot")).toContain(
      'background: var(--pt-accent)',
    );
  });
});

describe('message stream and list error chrome', () => {
  it('class-drives the 1px bottom sentinel', () => {
    expect(area).toContain('className="sc-conversation__bottom-sentinel"');
    expect(area).not.toContain("flex: '0 0 1px'");
    const sentinel = rule(chatCss, '.sc-conversation__bottom-sentinel');
    expect(sentinel).toContain('flex: 0 0 1px');
    expect(sentinel).toContain('height: 1px');
  });

  it('drives the list-error glyph tone from the block modifier, not inline color', () => {
    expect(list).toContain('className="sc-list-error__glyph"');
    expect(list).not.toContain("color: compact ? 'var(--pt-warning)'");
    expect(rule(chatCss, '.sc-list-error__glyph')).toContain('color: var(--pt-warning)');
    expect(rule(chatCss, '.sc-list-error--block .sc-list-error__glyph')).toContain(
      'color: var(--pt-danger)',
    );
  });
});

describe('sender profile loading reserve', () => {
  it('uses a class for the 120px loading reserve', () => {
    expect(senderCard).toContain('className="sc-sender-profile__loading"');
    expect(senderCard).not.toContain('height: 120, display');
    const loading = rule(northstarCss, '.sc-sender-profile__loading');
    expect(loading).toContain('height: 120px');
  });
});
