// Source-contract: PublicProfileCard is now a thin host adapter over the
// composite IdentityProfileCard. The three north-star grammars (self rail
// popover, author quick popover, sheet hero) live in @peers-touch/ui-composite;
// this file verifies the adapter wiring, geometry mapping, legacy pp-* class
// injection and that the gate data hooks survive inside the composite.
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
// The DOM + gate hooks moved into the composite package.
const compositeSource = readFileSync(
  new URL('../../../../../packages/ui/composite/src/identity/IdentityProfileCard.tsx', import.meta.url),
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

describe('profile card adapter boundary', () => {
  it('delegates rendering to the composite and keeps no antd/lobehub residue', () => {
    expect(cardSource).not.toMatch(/from ['"]antd['"]/);
    expect(cardSource).not.toMatch(/from ['"]@lobehub\/ui['"]/);
    expect(cardSource).not.toMatch(/from ['"]react-layout-kit['"]/);
    expect(cardSource).toContain("from '@peers-touch/ui-composite'");
    expect(cardSource).toContain('<IdentityProfileCard');
    expect(cardSource).toContain("import './profileCard.css'");
  });

  it('routes success/warning feedback through the desktop feedback channel', () => {
    expect(actionSource).toContain("from '../../hooks/useAppFeedback'");
    expect(actionSource).toContain('const feedback = useScopedFeedback()');
    expect(actionSource).not.toContain('message.success');
    expect(actionSource).not.toContain('message.warning');
    expect(actionSource).not.toContain('message.error');
  });

  it('preserves the chat identity data hooks inside the composite component', () => {
    for (const hook of [
      'data-chat-profile-card',
      'data-chat-profile-banner',
      'data-chat-profile-relation',
      'data-chat-profile-technical-details',
      'data-chat-profile-copy',
      'data-profile-identity',
    ]) {
      expect(compositeSource).toContain(hook);
    }
  });
});

describe('adapter keeps the prototype geometry and legacy pp-* bridge', () => {
  it('declares the 64/16, 44/12 and 72/18 avatar geometry', () => {
    expect(cardSource).toMatch(/self:\s*\{\s*size:\s*64,\s*radius:\s*16\s*\}/);
    expect(cardSource).toMatch(/author:\s*\{\s*size:\s*44,\s*radius:\s*12\s*\}/);
    expect(cardSource).toMatch(/sheet:\s*\{\s*size:\s*72,\s*radius:\s*18\s*\}/);
  });

  it('injects pp-* legacy classes through SurfaceHooks so profileCard.css keeps resolving', () => {
    expect(cardSource).toContain('pp-card--${variant}');
    expect(cardSource).toContain("'pp-self-banner'");
    expect(cardSource).toContain("'pp-details'");
  });

  it('retains the north-star pixel rules in the host stylesheet', () => {
    expect(rule(cardCss, '.pp-card--self')).toContain('width: 300px');
    expect(rule(cardCss, '.pp-self-banner')).toContain('height: 92px');
    expect(rule(cardCss, '.pp-card--author')).toContain('width: 264px');
    expect(rule(cardCss, '.pp-details__value')).toMatch(/font-family:[^;]*var\(--pt-mono\)/);
    expect(cardCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe('call sites pick the matching grammar (unchanged consumers)', () => {
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
    // "Maximum update depth exceeded" crash when the popover mounts. The
    // component must not bind it reactively at all — it reads the projection
    // non-reactively via getState() at event-handler time instead.
    expect(actionSource).not.toMatch(
      /useSocialChatStore\(\(state\)\s*=>\s*state\.getIMConversations(\(\))?\)/,
    );
    expect(actionSource).toContain(
      'useSocialChatStore.getState()',
    );
    expect(actionSource).toMatch(
      /useSocialChatStore\.getState\(\)\s*\n?\s*\.getIMConversations\(\)/,
    );
  });
});
