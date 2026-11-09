// Source-contract: chat modals and overlay hosts must express every
// interactive element with peers-ui primitives. Bespoke raw buttons only
// survive where the north-star prototype itself renders raw button tiles
// (reaction chips, call controls, selectable rows), which are covered by the
// other chat alignment suites.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const findPeopleSource = readFileSync(
  new URL('./FindPeopleModal.tsx', import.meta.url),
  'utf8',
);
const searchMessagesSource = readFileSync(
  new URL('./SearchMessagesModal.tsx', import.meta.url),
  'utf8',
);
const attachmentDetailSource = readFileSync(
  new URL('./AttachmentDetailHost.tsx', import.meta.url),
  'utf8',
);
const createGroupSource = readFileSync(
  new URL('./CreateGroupModal.tsx', import.meta.url),
  'utf8',
);
const chatCss = readFileSync(
  new URL('../../ui/chat.css', import.meta.url),
  'utf8',
);

describe('find-people modal primitive alignment', () => {
  it('models scope filters as peers Toggle chips, not native buttons', () => {
    expect(findPeopleSource).toMatch(/Toggle as PtToggle/);
    expect(findPeopleSource).not.toMatch(/<button\b/);
    expect(findPeopleSource).toContain('data-chat-find-people-scope="all"');
    expect(findPeopleSource).toContain('data-chat-find-people-scope="federation"');
    expect(findPeopleSource).toMatch(/<PtToggle[\s\S]*?selected=\{searchScope === 'all'\}/);
    // Active styling keys off the primitive's aria-pressed state.
    expect(chatCss).toMatch(/\.sc-scope-chip\[aria-pressed='true'\]/);
  });
});

describe('message search modal primitive alignment', () => {
  it('renders the clear affordance as a peers IconButton while keeping the acceptance hook', () => {
    expect(searchMessagesSource).toMatch(/\bIconButton\b/);
    expect(searchMessagesSource).toContain('data-chat-message-search-clear');
    expect(searchMessagesSource).toContain('iconId="close"');
    expect(searchMessagesSource).not.toContain('<X ');
  });

  it('renders result rows as native reset buttons (prototype .sk-search-row) with a decorative jump glyph', () => {
    expect(searchMessagesSource).toMatch(
      /<button[\s\S]*?type="button"[\s\S]*?className="sc-search__result"/,
    );
    expect(searchMessagesSource).toContain('className="sc-search__result-jump"');
    // The old nested peers jump button is gone (whole row activates).
    expect(searchMessagesSource).not.toContain('search-jump-');
    expect(searchMessagesSource).not.toContain('role="button"');
    const rowRule = chatCss.match(/\.sc-search__result\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rowRule).toContain('border: 0');
    expect(rowRule).toContain('background: transparent');
  });

  it('ships no local debug telemetry endpoint in the search surface', () => {
    // A prior geometry investigation left a fetch to a localhost debug
    // collector on every keystroke; production chat UI must never phone home
    // to such an endpoint.
    expect(searchMessagesSource).not.toContain('127.0.0.1:7778');
    expect(searchMessagesSource).not.toContain('debug-point');
    expect(searchMessagesSource).not.toContain('chat-experience-failures');
  });
});

describe('create-group member picker primitive alignment', () => {
  it('renders member rows as labels wrapping the peers Checkbox (prototype .sk-group-member)', () => {
    expect(createGroupSource).toMatch(
      /<label[\s\S]*?className=\{`sc-create-group__contact/,
    );
    expect(createGroupSource).toMatch(/<PtCheckbox[\s\S]*?onCheckedChange=\{\(\) => toggleSelect/);
    expect(createGroupSource).not.toContain('role="button"');
    // The acceptance identity hooks stay on the row.
    expect(createGroupSource).toContain('data-chat-create-group-contact={contact.actorPtid}');
  });

  it('spaces the creation error via class, not an inline margin', () => {
    expect(createGroupSource).toContain(
      '<div className="sc-create-group__error" data-chat-create-group-error>',
    );
    expect(createGroupSource).not.toContain('marginBottom: 16');
    expect(chatCss).toMatch(/\.sc-create-group__error\s*\{[^}]*margin-bottom: 16px/);
  });
});

describe('attachment detail host primitive alignment', () => {
  it('builds every header action from peers IconButton, never a native button', () => {
    expect(attachmentDetailSource).toMatch(/\bIconButton\b/);
    expect(attachmentDetailSource).not.toMatch(/<button\b/);
    // All five header actions keep their transfer-action data hooks.
    for (const action of ['cancel', 'retry', 'preview', 'open-external', 'save-copy']) {
      expect(attachmentDetailSource).toContain(`action="${action}"`);
    }
    // The save-copy action is the single primary ink tile.
    expect(attachmentDetailSource).toMatch(/emphasis=\{primary \? 'primary' : 'quiet'\}/);
  });
});
