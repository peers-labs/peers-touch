// Source-contract: the contacts pane mirrors the north-star ChatRail grammar
// (.sk-contact-section / .sk-request-card / .sk-conv-row): collapsible peers
// Button sections, hairline-separated request cards with hover-revealed icon
// decisions, and the pinned Saved Messages self entry. Acceptance data hooks
// on friend requests must stay intact.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');
const contactsSource = readFileSync(new URL('./ChatContactsPanel.tsx', import.meta.url), 'utf8');

function ruleFor(selector: string): string {
  const stripped = chatCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const blockRe = /(?:^|\})([^{}]*)\{([^}]*)\}/gm;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(stripped))) {
    const selectors = match[1].split(',').map((part) => part.trim());
    if (selectors.includes(selector)) return `${selector} {${match[2]}}`;
  }
  return '';
}

describe('collapsible contact sections (north-star .sk-contact-section parity)', () => {
  it('drives sections with a peers quiet full-width Button and rotates the chevron when collapsed', () => {
    expect(contactsSource).toMatch(/<Button[\s\S]*?className="sc-contact-section__toggle"[\s\S]*?fullWidth/);
    expect(contactsSource).toContain('data-contact-section={key}');
    expect(contactsSource).toContain('iconId="chevron-down"');
    const toggleRule = chatCss.match(
      /\.sc-contact-section \.sc-contact-section__toggle\s*\{[^}]*\}/,
    )?.[0] ?? '';
    expect(toggleRule).toContain('margin: 6px 2px 2px');
    expect(chatCss).toContain(
      ".sc-contact-section[data-collapsed='true'] .sc-contact-section__chevron",
    );
    expect(chatCss).toContain('transform: rotate(-90deg)');
  });
});

describe('friend request cards (north-star .sk-request-card parity)', () => {
  it('keeps the 9px 8px card geometry with 7% hairline separators', () => {
    const cardRule = ruleFor('.sc-request-card');
    expect(cardRule).toContain('padding: 9px 8px');
    expect(cardRule).toContain('margin: 0 2px');
    expect(chatCss).toContain(
      'border-top: 1px solid color-mix(in srgb, var(--pt-text) 7%, transparent)',
    );
    expect(ruleFor('.sc-request-card:hover')).toContain(
      'background: color-mix(in srgb, var(--pt-text) 4%, transparent)',
    );
  });

  it('reveals icon decisions only on hover/focus with the 0.12s quiet protocol', () => {
    const decideRule = ruleFor('.sc-request-card__decide');
    expect(decideRule).toContain('opacity: 0');
    expect(decideRule).toContain('transition: opacity 0.12s ease');
    expect(chatCss).toContain(
      '.sc-request-card:hover .sc-request-card__decide',
    );
    expect(chatCss).toContain(
      '.sc-request-card:focus-within .sc-request-card__decide',
    );
    expect(chatCss).toMatch(
      /\.sc-request-card \.sc-decide\.is-accept:hover\s*\{[^}]*color-mix\(in srgb, var\(--pt-accent\) 12%, transparent\)/,
    );
    expect(chatCss).toMatch(
      /\.sc-request-card \.sc-decide\.is-reject:hover\s*\{[^}]*color-mix\(in srgb, var\(--pt-danger\) 10%, transparent\)/,
    );
  });

  it('keeps the outgoing wash, history dim and greeting type scale', () => {
    expect(ruleFor('.sc-request-card.is-outgoing')).toContain(
      'background: color-mix(in srgb, var(--pt-primary) 5%, transparent)',
    );
    expect(ruleFor('.sc-request-card.is-history')).toContain('opacity: 0.72');
    const greetingRule = ruleFor('.sc-request-card__greeting');
    expect(greetingRule).toContain('font-size: 11.5px');
    expect(greetingRule).toContain('line-height: 1.5');
  });

  it('builds accept/reject from peers IconButton while keeping the acceptance hooks', () => {
    expect(contactsSource).toMatch(/<IconButton[\s\S]*?data-chat-friend-request-action="accept"/);
    expect(contactsSource).toMatch(/<IconButton[\s\S]*?data-chat-friend-request-action="reject"/);
    expect(contactsSource).toContain('className="sc-decide is-accept"');
    expect(contactsSource).toContain('className="sc-decide is-reject"');
  });
});

describe('settled history card compression (single-line archive rows)', () => {
  it('keeps the compact history card at 4px vertical padding and centered on the avatar', () => {
    // Two .sc-request-card.is-history blocks exist; the compact block is the
    // one carrying align-items/padding, distinct from the opacity block.
    const compactRule = chatCss.match(
      /\.sc-request-card\.is-history\s*\{[^}]*align-items: center;[^}]*\}/,
    )?.[0] ?? '';
    expect(compactRule).toContain('align-items: center');
    expect(compactRule).toContain('padding: 4px 8px');
    const nameRowRule = chatCss.match(
      /\.sc-request-card\.is-history \.sc-request-card__name-row\s*\{[^}]*\}/,
    )?.[0] ?? '';
    expect(nameRowRule).toContain('flex-wrap: nowrap');
    const tagsRule = chatCss.match(
      /\.sc-request-card\.is-history \.sc-request-card__tags\s*\{[^}]*\}/,
    )?.[0] ?? '';
    expect(tagsRule).toContain('flex-wrap: nowrap');
    expect(tagsRule).toContain('overflow: hidden');
  });

  it('renders the repeated-attempt tag only on pending cards and moves it to the tooltip on history', () => {
    // Inline attempts tag is gated to non-settled cards.
    expect(contactsSource).toContain('!isSettled && attemptsLabel');
    // History rows surface the count through the native title tooltip instead.
    expect(contactsSource).toContain('chat.social.contacts.historyRowTitle');
    // Greeting lines are pending-only so settled rows stay one line tall.
    expect(contactsSource).toContain('!isSettled && isOutgoing && request.status === 1');
    expect(contactsSource).toContain('!isSettled && request.message');
  });

  it('keeps hairline separators working across the ContextMenu wrappers', () => {
    expect(chatCss).toContain(
      '.pt-context-menu + .pt-context-menu .sc-request-card',
    );
    expect(chatCss).toContain(
      '.sc-contacts__requests .pt-context-menu { display: block; width: 100%; }',
    );
  });
});

describe('settled history right-click dismissal', () => {
  it('wraps only settled cards in a ContextMenu wired to local dismissal', () => {
    expect(contactsSource).toContain('ContextMenu');
    expect(contactsSource).toContain('data-chat-friend-request-history-card');
    expect(contactsSource).toContain('friend-request-history-delete-');
    expect(contactsSource).toContain("iconId: 'delete'");
    expect(contactsSource).toContain("t('chat.social.contacts.deleteHistory')");
    expect(contactsSource).toContain("t('chat.social.contacts.historyContextMenu')");
    // Pending cards return the raw card before any ContextMenu wrapper.
    expect(contactsSource).toContain('if (!isSettled) {');
    expect(contactsSource).toContain('dismissFriendRequestPeer(peerPtid)');
  });

  it('filters dismissed peers out of the history section via the actor-scoped store', () => {
    expect(contactsSource).toContain(
      "from '../../store/dismissedFriendRequests'",
    );
    expect(contactsSource).toMatch(
      /peer\.request\.status !== 1 && !dismissedPeers\.includes\(peer\.peerPtid\)/,
    );
    expect(contactsSource).toContain('loadDismissedForActor(myDid)');
  });

  it('persists dismissals in an actor-scoped localStorage store without server calls', () => {
    const storeSource = readFileSync(
      new URL('../../store/dismissedFriendRequests.ts', import.meta.url),
      'utf8',
    );
    expect(storeSource).toContain("'peers-dismissed-friend-requests'");
    expect(storeSource).toContain('localStorage.setItem');
    expect(storeSource).toContain('dismissPeer');
    expect(storeSource).toContain('loadForActor');
    // Local-only archive dismissal must never invoke a Station/API delete.
    expect(storeSource).not.toContain('api.');
    expect(storeSource).not.toContain('invoke');
  });

  it('ships the dismissal copy in both locale bundles', () => {
    const en = readFileSync(
      new URL('../../../../../packages/locales/en/chat.json', import.meta.url),
      'utf8',
    );
    const zh = readFileSync(
      new URL('../../../../../packages/locales/zh-CN/chat.json', import.meta.url),
      'utf8',
    );
    for (const key of [
      'chat.social.contacts.deleteHistory',
      'chat.social.contacts.historyContextMenu',
      'chat.social.contacts.historyRowTitle',
    ]) {
      expect(en).toContain(`"${key}"`);
      expect(zh).toContain(`"${key}"`);
    }
  });
});

describe('contact rows and self entry (north-star .sk-conv-row / .sk-contact-self parity)', () => {
  it('uses the shared 8px row geometry, 4% hover and inset accent selection', () => {
    const rowRule = ruleFor('.sc-contact-row');
    expect(rowRule).toContain('padding: 8px');
    expect(ruleFor('.sc-contact-row:hover')).toContain(
      'background: color-mix(in srgb, var(--pt-text) 4%, transparent)',
    );
    const selectedRule = ruleFor('.sc-contact-row.is-selected');
    expect(selectedRule).toContain('box-shadow: inset 2.5px 0 0 var(--pt-accent)');
  });

  it('composes self/group rows as peers quiet Buttons and friend rows as native reset buttons', () => {
    // Self entry: peers Button with the prototype action id.
    expect(contactsSource).toMatch(
      /<Button[\s\S]*?actionId="contact\.open-self"[\s\S]*?className=\{`sc-contact-row/,
    );
    // Group rows: peers Button with per-group action ids.
    expect(contactsSource).toMatch(
      /<Button[\s\S]*?actionId=\{`contact\.open-group\.\$\{conversation\.id\}`\}[\s\S]*?className=\{`sc-contact-row/,
    );
    // Friend rows: native button (prototype .sk-conv-row friend grammar).
    expect(contactsSource).toMatch(
      /<button[\s\S]*?type="button"[\s\S]*?className=\{`sc-contact-row/,
    );
    // The clickable identity rows never fake button semantics with a div.
    // (The friend-request CARD keeps role="button" by acceptance contract:
    // lifecycle_onboarding probes its role/tabindex and nested decide icons.)
    expect(contactsSource).not.toMatch(/sc-contact-row[\s\S]{0,200}role="button"/);
    // The peers button chrome is neutralized to the row class on the
    // compound selector (must outrank .pt-button's own padding/border).
    const resetRule = chatCss.match(/\.pt-button\.sc-contact-row,[\s\S]*?data-emphasis='quiet'\]\s*\{[^}]*\}/)?.[0] ?? '';
    expect(resetRule).toContain('padding: 8px');
    expect(resetRule).toContain('border: 0');
    expect(resetRule).toContain('background: transparent');
    expect(resetRule).toContain('justify-content: flex-start');
  });

  it('pins Saved Messages with the prototype 4/2/2 margin and 7% hairline', () => {
    const selfRule = ruleFor('.sc-contacts__self');
    expect(selfRule).toContain('margin: 4px 2px 2px');
    expect(selfRule).toContain('padding-bottom: 6px');
    expect(selfRule).toContain(
      'border-bottom: 1px solid color-mix(in srgb, var(--pt-text) 7%, transparent)',
    );
  });

  it('keeps the selected friend name ink — selection is card + inset bar only', () => {
    // Prototype .sk-conv-row.is-selected paints the wash and pine inset bar;
    // the <strong> never changes color. No inline accent name and no
    // nameColor prop may drive a tinted selected name.
    expect(contactsSource).not.toContain('nameColor=');
    const identitySource = readFileSync(
      new URL('./ChatActorIdentityRow.tsx', import.meta.url),
      'utf8',
    );
    expect(identitySource).not.toContain('nameColor');
    expect(identitySource).not.toContain("style={nameColor");
  });

  it('renders friend-row metadata at the prototype 11.5px muted scale with 2px column gap', () => {
    const body = ruleFor('.sc-contact-row .sc-identity-row__body');
    expect(body).toContain('gap: 2px');
    const meta = ruleFor('.sc-contact-row .sc-identity-row__metadata span');
    expect(meta).toContain('font-size: 11.5px');
    expect(meta).toContain('color: var(--pt-muted)');
  });
});

describe('silent background reconcile (no refresh flash)', () => {
  it('shows the spinner only on the first load, not when already-ready data refreshes', () => {
    // The gate must require BOTH "never loaded" (!friendshipReady) AND an active
    // load. After the first load, friendshipReady stays true forever, so a
    // background reconcile flipping friendRequestsLoading must never swap the
    // mounted list for a spinner.
    expect(contactsSource).toContain('!friendshipReady && friendRequestsLoading');
    expect(contactsSource).not.toContain(
      '!friendshipReady || friendRequestsLoading',
    );
  });

  it('applies the same first-load-only gate in the create-group contact picker', () => {
    const createGroupSource = readFileSync(
      new URL('./CreateGroupModal.tsx', import.meta.url),
      'utf8',
    );
    expect(createGroupSource).toContain('!friendshipReady && friendRequestsLoading');
    expect(createGroupSource).not.toContain(
      '!friendshipReady || friendRequestsLoading',
    );
  });
});
