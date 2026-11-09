// Source-contract: the conversation detail sheet header follows the north-star
// .sk-side-head grammar — message search and chat background are header glyph
// actions alongside close, not full setting rows in the sheet body.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const detail = readFileSync(
  new URL('./ChatDetailPanel.tsx', import.meta.url),
  'utf8',
);
const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');

const headerSlice = detail.slice(
  detail.indexOf('<header className="sc-detail__header"'),
  detail.indexOf('</header>'),
);

describe('detail sheet header actions (north-star .sk-side-head parity)', () => {
  it('renders search, background and close as three quiet header icon buttons', () => {
    expect(headerSlice).toContain('className="sc-detail__header-actions"');
    ['chat-detail-search', 'chat-detail-background', 'chat-detail-close'].forEach((id) => {
      expect(headerSlice).toContain(`actionId="${id}"`);
    });
    expect(headerSlice).toContain('iconId="search"');
    expect(headerSlice).toContain('iconId="image"');
    expect(headerSlice).toContain('iconId="close"');
    expect(headerSlice).toContain('peers-chat:open-search');
  });

  it('keeps the acceptance background hook on the header button', () => {
    expect(headerSlice).toContain('data-chat-conversation-action="background"');
  });

  it('does not keep background/search as full setting link rows', () => {
    const body = detail.slice(detail.indexOf('</header>'));
    expect(body).not.toContain('data-chat-conversation-action="background"');
    expect(body).not.toContain('sc-detail__setting-row--link');
  });

  it('pins the action group to the header right edge with 30px glyph tiles', () => {
    const group = chatCss.match(/\.sc-detail__header-actions\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(group).toContain('right: 6px');
    expect(group).toContain('position: absolute');
    const buttons = chatCss.match(
      /\.sc-detail__header-action\.pt-icon-button,[\s\S]*?\.sc-detail__close\.pt-icon-button\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(buttons).toContain('width: 30px');
    expect(buttons).toContain('height: 30px');
    expect(buttons).toContain('border-radius: 8px');
  });

  it('uses the prototype 52px side-head band with 8px/12px padding', () => {
    expect(detail).toContain('const DETAIL_HEADER_HEIGHT = 52');
    const header = chatCss.match(/\.sc-detail__header\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(header).toContain('padding: 8px 12px 0');
  });
});
