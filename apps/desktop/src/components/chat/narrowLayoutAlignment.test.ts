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
});

describe('480px phone compact contract', () => {
  it('tightens insets and retires secondary header actions', () => {
    expect(stylesheet).toContain('@media (max-width: 480px)');
    expect(stylesheet).toContain("[data-action-id='chat-call-video']");
    expect(stylesheet).toContain("[data-action-id='chat-open-detail']");
  });
});
