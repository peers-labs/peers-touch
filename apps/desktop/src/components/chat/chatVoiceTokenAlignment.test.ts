// Source-contract: voice notes paint NO bubble chrome of their own. The
// prototype .sk-voice is a paintless flex row inside .sk-msg-bubble — the
// parent bubble (in desktop, the presentation-policy inline style on
// .msg-bubble) owns ownBubble/peerBubble/onPrimary. This guards against the
// earlier double-bubble / bespoke lime regressions returning.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');
const rowSource = readFileSync(
  new URL('./message/ChatMessageRow.tsx', import.meta.url),
  'utf8',
);

const voiceBlock = chatCss.slice(
  chatCss.indexOf('.sc-attachment--voice audio'),
  chatCss.indexOf('.sc-attachment__file'),
);

describe('voice note north-star token alignment', () => {
  it('lets the parent message bubble own the ownBubble/peerBubble tokens', () => {
    // The tokens are applied by the presentation policy on .msg-bubble...
    expect(rowSource).toContain("'var(--pt-ownBubble)'");
    expect(rowSource).toContain("'var(--pt-peerBubble)'");
    // ...never re-painted on the voice row.
    expect(voiceBlock).not.toContain('var(--pt-ownBubble)');
    expect(voiceBlock).not.toContain('var(--pt-peerBubble)');
    expect(voiceBlock).not.toContain('var(--pt-onPrimary)');
  });

  it('contains no legacy lime voice palette or hardcoded slate ink', () => {
    expect(chatCss).not.toContain('#95ec97');
    expect(chatCss).not.toContain('#8dea90');
    expect(voiceBlock).not.toContain('#111827');
  });

  it('uses the currentColor-mix toggle like the prototype', () => {
    expect(voiceBlock).toMatch(/\.sc-voice__toggle\s*\{[^}]*color-mix\(in srgb, currentColor 12%/);
  });
});
