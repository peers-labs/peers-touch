// Source-contract: PublicProfileCard carries the three north-star identity
// grammars — self rail popover (.sk-self-card), author quick popover
// (.sk-author-card) and sheet hero (.sk-profile-hero) — on peers-ui
// primitives and pt tokens, with no antd/lobehub residue.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const cardSource = readFileSync(
  new URL('./PublicProfileCard.tsx', import.meta.url),
  'utf8',
);
const actionSource = readFileSync(
  new URL('./ProfilePrimaryAction.tsx', import.meta.url),
  'utf8',
);
const cardCss = readFileSync(new URL('./profileCard.css', import.meta.url), 'utf8');
const northstarCss = readFileSync(new URL('../../ui/northstar.css', import.meta.url), 'utf8');
const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');
const senderSource = readFileSync(
  new URL('../chat/message/MessageSenderProfileCard.tsx', import.meta.url),
  'utf8',
);
const selfPopoverSource = readFileSync(new URL('../UserProfilePopover.tsx', import.meta.url), 'utf8');
const detailPanelSource = readFileSync(
  new URL('../chat/ChatDetailPanel.tsx', import.meta.url),
  'utf8',
);
const messageRowSource = readFileSync(
  new URL('../chat/message/ChatMessageRow.tsx', import.meta.url),
  'utf8',
);

function rule(css: string, selector: string): string {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blockRe = /(?:^|\})([^{}]*)\{([^}]*)\}/gm;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(source))) {
    const selectors = match[1].split(',').map((part) => part.trim());
    if (selectors.includes(selector)) return match[2];
  }
  return '';
}

describe('profile card primitive layer', () => {
  it('composes peers primitives only — no antd, lobehub or layout-kit imports', () => {
    for (const source of [cardSource, actionSource]) {
      expect(source).not.toMatch(/from ['"]antd['"]/);
      expect(source).not.toMatch(/from ['"]@lobehub\/ui['"]/);
      expect(source).not.toMatch(/from ['"]react-layout-kit['"]/);
    }
    expect(cardSource).toMatch(/from ['"]@peers-touch\/ui['"]/);
    expect(actionSource).toMatch(/from ['"]@peers-touch\/ui['"]/);
    expect(cardSource).toContain("import './profileCard.css'");
  });

  it('routes success/warning feedback through the desktop feedback channel', () => {
    expect(actionSource).toContain("from '../../ui/feedback'");
    expect(actionSource).not.toContain('message.success');
    expect(actionSource).not.toContain('message.warning');
    expect(actionSource).not.toContain('message.error');
  });
});

describe('self variant (prototype .sk-self-card)', () => {
  it('uses the 300px card, 92px primary-wash banner and overlapping 64/16 avatar', () => {
    expect(rule(cardCss, '.pp-card--self')).toContain('width: 300px');
    const banner = rule(cardCss, '.pp-self-banner');
    expect(banner).toContain('height: 92px');
    expect(banner).toContain('var(--pt-primary) 42%, transparent');
    expect(banner).toContain('var(--pt-primary) 10%, transparent');
    const body = rule(cardCss, '.pp-self-body');
    expect(body).toContain('position: relative');
    expect(body).toContain('padding: 44px 16px 14px');
    const avatar = rule(cardCss, '.pp-self-avatar');
    expect(avatar).toContain('top: -28px');
    expect(avatar).toContain('width: 64px');
    expect(avatar).toContain('height: 64px');
    expect(avatar).toContain('border-radius: 16px');
    expect(avatar).toContain('0 0 0 4px var(--pt-surface)');
  });

  it('uses the prototype name/handle/stat/joined/action scale', () => {
    expect(rule(cardCss, '.pp-self-name')).toContain('font-size: 17px');
    expect(rule(cardCss, '.pp-self-name')).toContain('font-weight: 650');
    expect(rule(cardCss, '.pp-self-handle')).toContain('font-size: 12px');
    expect(rule(cardCss, '.pp-stats--self')).toContain('gap: 20px');
    expect(rule(cardCss, '.pp-stats--self .pp-stat strong')).toContain('font-size: 16px');
    expect(rule(cardCss, '.pp-self-joined')).toContain('margin-top: 9px');
    expect(rule(cardCss, '.pp-self-body .pp-actions')).toContain('margin-top: 13px');
  });

  it('declares the 64/16 avatar geometry and self variant in source', () => {
    expect(cardSource).toMatch(/self:\s*\{\s*size:\s*64,\s*radius:\s*16\s*\}/);
  });
});

describe('author variant (prototype .sk-author-card)', () => {
  it('uses the 264px flush card with 14px padding and 10px section rhythm', () => {
    const card = rule(cardCss, '.pp-card--author');
    expect(card).toContain('width: 264px');
    expect(card).toContain('padding: 14px');
    expect(card).toContain('gap: 10px');
    expect(rule(cardCss, '.pp-author-head')).toContain('gap: 10px');
  });

  it('uses the 44/12 head avatar with 14.5/650 name and 11.5 station line', () => {
    expect(cardSource).toMatch(/author:\s*\{\s*size:\s*44,\s*radius:\s*12\s*\}/);
    expect(rule(cardCss, '.pp-author-name')).toContain('font-size: 14.5px');
    expect(rule(cardCss, '.pp-author-name')).toContain('font-weight: 650');
    expect(rule(cardCss, '.pp-author-station')).toContain('font-size: 11.5px');
  });

  it('uses the prototype 12.5/1.55 bio and inline 12px stats', () => {
    const bio = rule(cardCss, '.pp-bio');
    expect(bio).toContain('font-size: 12.5px');
    expect(bio).toContain('line-height: 1.55');
    expect(rule(cardCss, '.pp-stats--author')).toContain('gap: 12px');
    expect(rule(cardCss, '.pp-stat strong')).toContain('font-size: 13px');
  });
});

describe('sheet variant (prototype .sk-profile-hero)', () => {
  it('centers the 72/18 avatar with 15/650 name and 11.5 sub line', () => {
    expect(cardSource).toMatch(/sheet:\s*\{\s*size:\s*72,\s*radius:\s*18\s*\}/);
    const hero = rule(cardCss, '.pp-sheet-hero');
    expect(hero).toContain('align-items: center');
    expect(hero).toContain('gap: 6px');
    expect(rule(cardCss, '.pp-sheet-name')).toContain('font-size: 15px');
    expect(rule(cardCss, '.pp-sheet-name')).toContain('font-weight: 650');
    expect(rule(cardCss, '.pp-sheet-sub')).toContain('font-size: 11.5px');
  });
});

describe('shared card sections', () => {
  it('renders tone pills, wrapped actions and mono technical rows on tokens', () => {
    expect(rule(cardCss, '.pp-actions')).toContain('gap: 8px');
    expect(rule(cardCss, ".pp-pill[data-tone='success']")).toContain('var(--pt-success)');
    expect(rule(cardCss, ".pp-pill[data-tone='warning']")).toContain('var(--pt-warning)');
    expect(rule(cardCss, '.pp-details__value')).toMatch(/font-family:[^;]*var\(--pt-mono\)/);
    expect(cardCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('preserves the chat identity data hooks', () => {
    expect(cardSource).toContain('data-chat-profile-card');
    expect(cardSource).toContain('data-chat-profile-banner');
    expect(cardSource).toContain('data-chat-profile-relation');
    expect(cardSource).toContain('data-chat-profile-technical-details');
    expect(cardSource).toContain('data-chat-profile-copy');
  });
});

describe('call sites pick the matching grammar', () => {
  it('sender popover → author, rail popover → self, detail sheet → sheet', () => {
    expect(senderSource).toContain('variant="author"');
    expect(selfPopoverSource).toContain('variant="self"');
    expect(detailPanelSource).toContain('variant="sheet"');
    expect(messageRowSource).toContain('className="ds-author-popover"');
  });

  it('popover shells flush padding at prototype widths; sheet wrapper yields padding', () => {
    const selfShell = rule(northstarCss, '.pt-overlay.ds-self-popover');
    expect(selfShell).toContain('padding: 0');
    expect(selfShell).toContain('border-radius: 16px');
    expect(rule(northstarCss, '.pt-overlay.ds-author-popover')).toContain('width: 264px');
    expect(rule(chatCss, '.sc-detail__profile')).toContain('padding: 0');
  });

  it('primary actions are full-width peers buttons carrying the chat hooks', () => {
    expect(actionSource).toContain('fullWidth');
    for (const hook of [
      'data-chat-profile-manage',
      'data-chat-profile-requested',
      'data-chat-profile-accept',
      'data-chat-contact-message',
      'data-chat-profile-add-friend',
    ]) {
      expect(actionSource).toContain(hook);
    }
  });

  it('never invokes an unstable projection getter inside a reactive selector', () => {
    // getIMConversations() rebuilds the projection array per call; calling it
    // inside a zustand selector makes useSyncExternalStore loop to the
    // "Maximum update depth exceeded" crash when the popover mounts.
    expect(actionSource).not.toMatch(
      /useSocialChatStore\(\(state\)\s*=>\s*state\.getIMConversations\(\)\)/,
    );
    expect(actionSource).toContain(
      'useSocialChatStore((state) => state.getIMConversations)',
    );
  });
});
