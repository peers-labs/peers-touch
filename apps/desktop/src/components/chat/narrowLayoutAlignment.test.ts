// Source-contract: the narrow single-pane swap mirrors the north-star
// prototype (sk-narrow-open / WeChat parity): the 60px material rail stays,
// the catalog rail and conversation swap below 720px, and a header back tile
// returns to the catalog. These assertions lock the contract because the
// desktop package has no DOM test environment.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(
  new URL('../../pages/SocialChatPage.tsx', import.meta.url),
  'utf8',
);
const areaSource = readFileSync(
  new URL('./ChatMessageArea.tsx', import.meta.url),
  'utf8',
);
const railSource = readFileSync(
  new URL('./ChatSessionList.tsx', import.meta.url),
  'utf8',
);
const hookSource = readFileSync(
  new URL('../../hooks/useMediaQuery.ts', import.meta.url),
  'utf8',
);
const stylesheet = readFileSync(
  new URL('../../ui/chat.css', import.meta.url),
  'utf8',
);
const tauriConf = JSON.parse(
  readFileSync(
    new URL('../../../src-tauri/tauri.conf.json', import.meta.url),
    'utf8',
  ),
);
const enLocale = JSON.parse(
  readFileSync(new URL('../../../../../packages/locales/en/chat.json', import.meta.url), 'utf8'),
);
const zhLocale = JSON.parse(
  readFileSync(new URL('../../../../../packages/locales/zh-CN/chat.json', import.meta.url), 'utf8'),
);

describe('narrow window constraints', () => {
  it('allows shrinking the window to phone width', () => {
    const main = tauriConf.app.windows[0];
    expect(main.minWidth).toBeLessThanOrEqual(360);
    expect(main.minHeight).toBeLessThanOrEqual(480);
  });
});

describe('useMediaQuery narrow breakpoint', () => {
  it('owns the shared 720px breakpoint and stays SSR-safe', () => {
    expect(hookSource).toContain("(max-width: 720px)");
    expect(hookSource).toContain('export const NARROW_MEDIA_QUERY');
    expect(hookSource).toContain("typeof window === 'undefined'");
    expect(hookSource).toContain("addEventListener('change'");
  });
});

describe('SocialChatPage narrow state machine', () => {
  it('projects narrow and narrow-open state onto the shell root', () => {
    expect(pageSource).toContain('useMediaQuery(NARROW_MEDIA_QUERY)');
    expect(pageSource).toContain('data-narrow={isNarrow');
    expect(pageSource).toContain('data-narrow-open={narrowOpen');
    // A conversation (active session or direct-open intent) opens the pane.
    expect(pageSource).toContain(
      "isNarrow && (!!activeSessionUlid || !!directOpenIntent)",
    );
  });

  it('returns to the catalog by clearing selection and open intent', () => {
    expect(pageSource).toContain('const backToCatalog');
    expect(pageSource).toContain("selectSession('')");
    expect(pageSource).toContain('cancelDirectOpenIntent()');
    expect(pageSource).toContain('onNarrowBack={backToCatalog}');
  });
});

describe('conversation header back control', () => {
  it('renders only in narrow mode with a stable gate hook and locale label', () => {
    expect(areaSource).toContain('narrow = false');
    expect(areaSource).toContain('data-chat-narrow-back');
    expect(areaSource).toContain('actionId="chat-back-to-list"');
    expect(areaSource).toContain("iconId=\"arrow-left\"");
    expect(areaSource).toContain("t('chat.social.messageArea.backToList')");
    expect(enLocale['chat.social.messageArea.backToList']).toBeTruthy();
    expect(zhLocale['chat.social.messageArea.backToList']).toBeTruthy();
  });
});

describe('rail width ownership', () => {
  it('keeps the 300px catalog width in CSS, never in inline styles', () => {
    expect(railSource).not.toContain('CHAT_RAIL_WIDTH');
    expect(railSource).not.toMatch(/style=\{\{[^}]*width/);
    expect(stylesheet).toMatch(/\.sc-sessions\s*\{[^}]*width: 300px/);
  });
});

describe('720px single-pane swap stylesheet contract', () => {
  it('hides one pane at a time and swaps via data-narrow-open', () => {
    expect(stylesheet).toContain('@media (max-width: 720px)');
    expect(stylesheet).toContain('.sc-chat-head__back { display: none; }');
    expect(stylesheet).toContain(
      ".sc-chat[data-narrow='true'][data-narrow-open='true'] .sc-sessions { display: none; }",
    );
    expect(stylesheet).toMatch(
      /\[data-narrow-open='true'\] \.sc-conversation \{[^}]*display: flex/,
    );
    // Side panels become full-stage overlays rather than squeezed columns.
    expect(stylesheet).toMatch(
      /\.sc-chat\[data-narrow='true'\] \.sc-detail,[\s\S]*?\.sc-thread \{[\s\S]*?position: absolute/,
    );
  });

  it('swaps panes instantly without a full-pane slide (native, not H5 reload)', () => {
    const narrow = mediaBlockBodies(720, stylesheet);
    // The conversation pane must NOT carry an enter animation: a mounted
    // keepAlive surface flips visibility, so a translateX sweep would read as
    // a web full-page reload and jitter the header/scroll/composer.
    expect(stylesheet).not.toContain('sc-conversation-slide-in');
    expect(narrow).not.toMatch(
      /data-narrow-open='true'\] \.sc-conversation\s*\{[^}]*animation:/,
    );
    expect(stylesheet).not.toMatch(/@keyframes sc-conversation-slide-in/);
    // No full-pane horizontal travel anywhere in the narrow swap block.
    expect(narrow).not.toContain('translateX(100%)');
  });

  it('keeps in-rail search reveal to a pure fade, never a geometric shift', () => {
    // Inline surface reveal may fade but must not translate (no layout shift).
    const shared = readFileSync(new URL('../../../../../packages/ui/web/src/styles.css', import.meta.url), 'utf8');
    expect(shared).toMatch(/@keyframes pt-search-reveal\{from\{opacity:0\}to\{opacity:1\}\}/);
    const railSearchBlock = shared.match(/@keyframes pt-search-reveal\{[^\n]+/)?.[0] ?? '';
    expect(railSearchBlock).not.toContain('translateX');
    expect(railSearchBlock).not.toContain('translateY');
  });
});

describe('480px phone compact contract', () => {
  it('tightens insets and retires secondary header actions', () => {
    expect(stylesheet).toContain('@media (max-width: 480px)');
    expect(stylesheet).toContain("[data-action-id='chat-call-video']");
    expect(stylesheet).toContain("[data-action-id='chat-open-detail']");
  });
});

// Concatenate the bodies of every `@media (max-width: Npx)` block. Brace
// matching is required because each media block nests several rule braces, so
// a flat selector regex cannot tell an in-media rule from a base rule.
function mediaBlockBodies(maxWidth: number, source: string): string {
  const marker = `@media (max-width: ${maxWidth}px)`;
  const bodies: string[] = [];
  let from = 0;
  let idx = source.indexOf(marker, from);
  while (idx !== -1) {
    const open = source.indexOf('{', idx);
    let depth = 0;
    let close = open;
    for (; close < source.length; close += 1) {
      if (source[close] === '{') depth += 1;
      else if (source[close] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    bodies.push(source.slice(open + 1, close));
    from = close + 1;
    idx = source.indexOf(marker, from);
  }
  return bodies.join('\n');
}

// Extract the declaration body of a top-level (non-media) selector.
function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\})[^}]*?${escaped}\\s*\\{([^}]*)\\}`, 'm');
  return source.match(re)?.[1] ?? '';
}

describe('composer vertical layout (narrow-safe by construction)', () => {
  it('stacks the full-width input above the tool/send footer without a row wrap', () => {
    // The WeChat-style shell is vertical at every width: the textarea fills
    // the top region and the controls sit in a footer row, so no 480px
    // single-row wrapping override is needed.
    expect(stylesheet).not.toContain('.sc-composer__row');
    expect(stylesheet).toContain('.sc-composer__footer');
    expect(stylesheet).toMatch(
      /\.sc-composer__input-wrap\s*\{[^}]*flex: 1 1 auto/,
    );
  });

  it('keeps every composer control mounted in the footer (no display:none)', () => {
    const footer = ruleBody(stylesheet, '.sc-composer__footer');
    expect(footer).toContain('display: flex');
    expect(footer).toContain('justify-content: space-between');
    const composerRules = stylesheet.match(/\.sc-composer[^{]*\{[^}]*\}/g) ?? [];
    expect(composerRules.some((rule) => rule.includes('display: none'))).toBe(false);
  });
});
