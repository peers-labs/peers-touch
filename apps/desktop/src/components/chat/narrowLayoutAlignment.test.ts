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
  it('keeps the catalog width in CSS via a custom property with a 300px fallback', () => {
    // The rail itself never carries an inline width; the page only sets the
    // --pt-chat-rail-width custom property, and CSS keeps the 300px default.
    expect(railSource).not.toContain('CHAT_RAIL_WIDTH');
    expect(railSource).not.toMatch(/style=\{\{[^}]*width/);
    expect(stylesheet).toMatch(
      /\.sc-sessions\s*\{[^}]*width: var\(--pt-chat-rail-width, 300px\)/,
    );
    expect(stylesheet).toContain(
      '.sc-chat[data-narrow=\'true\'] .sc-chat-rail-resizer { display: none; }',
    );
  });

  it('keeps the resize handle as an overlay, never a layout column', () => {
    // A flex-sized transparent handle exposes the canvas background as a
    // visible grey band; it must be absolutely positioned over the hairline.
    const resizerRule = stylesheet.match(
      /\.sc-chat-rail-resizer\s*\{[^}]*\}/,
    )?.[0] ?? '';
    expect(resizerRule).toContain('position: absolute');
    expect(resizerRule).not.toMatch(/flex\s*:/);
  });
});

describe('720px single-pane slide stylesheet contract', () => {
  it('mounts both panes and drives a WeChat push via data-narrow-open', () => {
    expect(stylesheet).toContain('@media (max-width: 720px)');
    expect(stylesheet).toContain('.sc-chat-head__back { display: none; }');
    // The catalog is never display:none — it stays mounted as the base layer
    // so sliding back reveals it instead of re-mounting a fresh list.
    expect(stylesheet).not.toContain(
      ".sc-chat[data-narrow='true'][data-narrow-open='true'] .sc-sessions { display: none; }",
    );
    // The conversation is a persistent absolute overlay covering the stage,
    // not a display:none→flex flip.
    const narrow = mediaBlockBodies(720, stylesheet);
    expect(narrow).toMatch(
      /\[data-narrow='true'\] \.sc-conversation\s*\{[^}]*position: absolute/,
    );
    // Side panels become full-stage overlays rather than squeezed columns.
    expect(stylesheet).toMatch(
      /\.sc-chat\[data-narrow='true'\] \.sc-detail,[\s\S]*?\.sc-thread \{[\s\S]*?position: absolute/,
    );
  });

  it('slides the conversation symmetrically with a transform transition, not a keyframe', () => {
    const narrow = mediaBlockBodies(720, stylesheet);
    // Parked off the right edge by default, translated to rest when open.
    expect(narrow).toContain('translateX(100%)');
    expect(narrow).toMatch(
      /\[data-narrow-open='true'\] \.sc-conversation\s*\{[^}]*transform: translateX\(0\)/,
    );
    // A transition (not an enter-only keyframe) drives both directions, which
    // is what makes back a real slide-out instead of a hard cut.
    expect(narrow).toMatch(
      /\[data-narrow='true'\] \.sc-conversation\s*\{[^}]*transition:/,
    );
    expect(stylesheet).not.toContain('sc-conversation-slide-in');
    expect(narrow).not.toMatch(
      /data-narrow-open='true'\] \.sc-conversation\s*\{[^}]*animation:/,
    );
    expect(stylesheet).not.toMatch(/@keyframes sc-conversation-slide-in/);
    // Parked pane is removed from input/assistive tech until it slides in.
    expect(narrow).toMatch(
      /\[data-narrow='true'\] \.sc-conversation\s*\{[^}]*visibility: hidden/,
    );
  });

  it('keeps in-rail search reveal to a pure fade, never a geometric shift', () => {
    // Inline surface reveal may fade but must not translate (no layout shift).
    expect(stylesheet).toMatch(
      /@keyframes sc-rail-search-in\s*\{\s*from\s*\{\s*opacity:\s*0;\s*\}\s*to\s*\{\s*opacity:\s*1;\s*\}\s*\}/,
    );
    const railSearchBlock = stylesheet.slice(
      stylesheet.indexOf('@keyframes sc-rail-search-in'),
      stylesheet.indexOf('@keyframes sc-rail-search-in') + 200,
    );
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
