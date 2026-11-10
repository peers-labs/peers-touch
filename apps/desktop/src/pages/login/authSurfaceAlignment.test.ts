// Source-contract: the auth surface has two layout grammars. Wide windows keep
// a centered floating card with a light pine tint; at the 480px phone floor the
// card itself becomes the surface and fills the window edge to edge. A centered
// brand hero carries the horizontal wordmark (height-only sizing preserves its
// aspect), and the back control shares the header row with the language
// switcher. The desktop package has no DOM test environment, so these
// assertions pin the stylesheet and component-source contract.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  new URL('../../index.css', import.meta.url),
  'utf8',
);
const brandingSource = readFileSync(
  new URL('../../branding.ts', import.meta.url),
  'utf8',
);
const pageSource = readFileSync(
  new URL('./LoginPage.tsx', import.meta.url),
  'utf8',
);
const formSource = readFileSync(
  new URL('./views/LoginFormView.tsx', import.meta.url),
  'utf8',
);
const pickerSource = readFileSync(
  new URL('./views/AccountPickerView.tsx', import.meta.url),
  'utf8',
);
const switcherSource = readFileSync(
  new URL('./StationSwitcher.tsx', import.meta.url),
  'utf8',
);

// Narrow block only: slice from the phone media query so base rules above it
// cannot satisfy the fill assertions by accident.
const narrowBlock = stylesheet.slice(stylesheet.lastIndexOf('@media (max-width: 480px)'));

describe('auth tinted card grammar', () => {
  it('tints the card with pine and keeps a wider centered floating card', () => {
    expect(stylesheet).toContain('width: var(--pt-auth-card-width, 384px);');
    expect(stylesheet).toContain(
      'color-mix(in srgb, var(--pt-accent) 8%, var(--pt-surface))',
    );
    // Mid-range windows (481-760px) still center the card vertically.
    expect(stylesheet).toMatch(/@media \(max-width: 760px\)[\s\S]*?margin-block: auto/);
  });

  it('keeps the card as a content-sized block above the phone breakpoint', () => {
    // No flex stretching at base level — wide cards hug content and center.
    const baseCard = stylesheet.slice(
      0,
      stylesheet.indexOf('@media (max-width: 760px)'),
    );
    expect(baseCard).not.toMatch(/\.pt-auth-card\s*\{[^}]*display: flex/);
  });

  it('never stretches the card to fill the window above 480px', () => {
    // The 481-760 band must not override the fixed width; only the <=480
    // full-bleed block is allowed to set width:100% on the card.
    const midBlock = stylesheet.slice(
      stylesheet.indexOf('@media (max-width: 760px)'),
      stylesheet.lastIndexOf('@media (max-width: 480px)'),
    );
    expect(midBlock).not.toMatch(/\.pt-auth-card\s*\{[^}]*width:\s*100%/);
    expect(stylesheet).toContain('width: var(--pt-auth-card-width, 384px);');
    expect(narrowBlock).toMatch(/\.pt-auth-card\s*\{[\s\S]*?width: 100%/);
  });

  it('softens the card hairline against the tinted surface', () => {
    // Derive a lighter hairline from the shared border token, not a new color.
    expect(stylesheet).toContain(
      'border-color: color-mix(in srgb, var(--pt-border) 55%, transparent)',
    );
  });
});

describe('auth re-authentication identity tile', () => {
  it('renders the expired account as an interactive button, not a static div', () => {
    // The tile must be a real control with a stable action + data hook.
    expect(formSource).toContain('actionId="auth.reauth.identity"');
    expect(formSource).toContain('data-login-reauth-account={expiredAccount.accountId}');
    expect(formSource).toMatch(/onActivate=\{\(\) => \{[\s\S]*?onReauthIdentity\?\.\(\);/);
    // The old non-interactive strip must be gone.
    expect(formSource).not.toMatch(/<div className="pt-auth-reauth">/);
    // Its own border/background moved to button chrome; the class is layout-only.
    expect(stylesheet).toMatch(/\.pt-auth-reauth\.pt-button\s*\{/);
    expect(stylesheet).not.toMatch(/\.pt-auth-reauth\s*\{[^}]*background: var\(--pt-subtle\)/);
  });

  it('pre-fills the stored login identifier when the tile is clicked', () => {
    // Clicking the account pushes its stored email into the visible field so
    // the user does not retype it, then routes through the provider sign-in.
    expect(formSource).toMatch(
      /if \(expiredAccount\.email\) setEmail\(expiredAccount\.email\);/,
    );
  });

  it('routes the tile click to the provider sign-in method in LoginPage', () => {
    expect(pageSource).toContain('const handleReauthIdentity = useCallback');
    expect(pageSource).toContain("provider === 'password' || provider === '' || provider === 'email'");
    // Password accounts route to the email tab and focus the password field.
    expect(pageSource).toMatch(/setTab\('email'\)[\s\S]*?setReauthFocusPassword\(true\)/);
    // OAuth accounts route to the quick tab.
    expect(pageSource).toMatch(/setTab\('quick'\)[\s\S]*?setReauthFocusPassword\(false\)/);
    expect(formSource).toContain('autoFocus={reauthFocusPassword}');
    // Wired on both LoginFormView instances.
    const wiredCount = pageSource.split('onReauthIdentity={handleReauthIdentity}').length - 1;
    expect(wiredCount).toBeGreaterThanOrEqual(2);
  });

  it('localizes the tile accessibility label in both shipped languages', () => {
    const en = readFileSync(
      new URL('../../../../../packages/locales/en/auth.json', import.meta.url),
      'utf8',
    );
    const zh = readFileSync(
      new URL('../../../../../packages/locales/zh-CN/auth.json', import.meta.url),
      'utf8',
    );
    expect(en).toContain('"auth.login.reauthIdentity"');
    expect(zh).toContain('"auth.login.reauthIdentity"');
    expect(formSource).toContain("t('auth.login.reauthIdentity', { name: expiredAccount.name })");
  });
});

describe('auth account-selection continuity', () => {
  it('continues a live session directly instead of parking on welcome_back', () => {
    // The shared continuation is the single post-switch path.
    expect(pageSource).toContain('const continueWithSwitchedAccount = useCallback');
    expect(pageSource).toContain("setLoginState('pin_entry')");
    expect(pageSource).toContain("setLoginState('set_pin')");
    // handleSelectAccount drives a live session through the continuation.
    const selectBlock = pageSource.slice(
      pageSource.indexOf('const handleSelectAccount'),
      pageSource.indexOf('// ── PIN entry ──'),
    );
    expect(selectBlock).toContain('await continueWithSwitchedAccount()');
    // A picked live account must not land on the intermediate welcome screen.
    expect(selectBlock).not.toContain("setLoginState('welcome_back')");
    // The welcome-back Continue button reuses the same continuation (no dup logic).
    expect(pageSource).toContain('() => continueWithSwitchedAccount()');
  });

  it('routes an expired/sessionless account to re-login with the revoked notice signal', () => {
    const selectBlock = pageSource.slice(
      pageSource.indexOf('const handleSelectAccount'),
      pageSource.indexOf('// ── PIN entry ──'),
    );
    // Both the no-session branch and a failed switch route as expired (true),
    // which sets reauthReason "revoked" inside routeToProviderLogin.
    const expiredRoutes = selectBlock.match(/routeToProviderLogin\(account, true\)/g) ?? [];
    expect(expiredRoutes.length).toBeGreaterThanOrEqual(2);
    // The old silent no-context route must be gone.
    expect(selectBlock).not.toContain('routeToProviderLogin(account, false)');
  });

  it('surfaces the expired-session reason as a glass overlay on the identity tile', () => {
    // reauthReason is consumed to gate the revoked treatment (not a dead prop).
    expect(formSource).toContain('reauthReason,');
    expect(formSource).toContain(
      "const isRevokedSession = !!expiredAccount && reauthReason === 'revoked' && !gateState;",
    );
    // The old standalone alert strip and its hook are gone — the reason reuses
    // the tile footprint instead of a separate row wasting vertical space.
    expect(formSource).not.toContain('data-login-reauth-notice');
    expect(formSource).toContain("'pt-auth-reauth pt-auth-reauth--expired'");
    expect(formSource).toContain('pt-auth-reauth__expired');
    expect(formSource).toContain("t('auth.login.expiredAlertTitle')");
    // The overlay floats over the tile, never intercepts the tile's click, and
    // derives its glass/warning look from design tokens (no hardcoded colors).
    expect(stylesheet).toMatch(
      /\.pt-auth-reauth__expired\s*\{[\s\S]*?position:\s*absolute/,
    );
    expect(stylesheet).toMatch(
      /\.pt-auth-reauth__expired\s*\{[\s\S]*?pointer-events:\s*none/,
    );
    expect(stylesheet).toMatch(/\.pt-auth-reauth__expired\s*\{[\s\S]*?backdrop-filter/);
    expect(stylesheet).toContain('var(--pt-warningSubtle)');
    expect(stylesheet).toContain('var(--pt-warning)');
    // The identity pieces dim individually so the warning label stays crisp.
    expect(stylesheet).toContain(
      '.pt-auth-reauth--expired .pt-button-content > :not(.pt-auth-reauth__expired)',
    );
    // The title copy exists in both shipped languages.
    const en = readFileSync(
      new URL('../../../../../packages/locales/en/auth.json', import.meta.url),
      'utf8',
    );
    const zh = readFileSync(
      new URL('../../../../../packages/locales/zh-CN/auth.json', import.meta.url),
      'utf8',
    );
    expect(en).toContain('"auth.login.expiredAlertTitle"');
    expect(zh).toContain('"auth.login.expiredAlertTitle"');
  });
});

describe('auth phone-narrow fill grammar', () => {
  it('lets the card fill the window without an outer canvas band at <=480px', () => {
    expect(narrowBlock).toContain('@media (max-width: 480px)');
    expect(narrowBlock).toMatch(/\.pt-auth-shell\s*\{[\s\S]*?padding: 0/);
    expect(narrowBlock).toMatch(/\.pt-auth-card\s*\{[\s\S]*?min-height: 100%/);
    expect(narrowBlock).toMatch(/\.pt-auth-card\s*\{[\s\S]*?border-radius: 0/);
    expect(narrowBlock).toMatch(/\.pt-auth-card\s*\{[\s\S]*?box-shadow: none/);
  });

  it('turns the full-height card into a flex column and pins the Station footer', () => {
    expect(narrowBlock).toMatch(/\.pt-auth-card\s*\{[\s\S]*?display: flex/);
    expect(narrowBlock).toMatch(/\.pt-auth-card\s*\{[\s\S]*?flex-direction: column/);
    expect(narrowBlock).toMatch(/\.pt-auth-card \.pt-card-body\s*\{[\s\S]*?flex: 1 1 auto/);
    expect(narrowBlock).toMatch(/\.pt-auth-card > footer\s*\{[\s\S]*?margin-top: auto/);
  });
});

describe('auth centered brand hero', () => {
  it('uses the square app icon tile centered with equal width and height', () => {
    expect(pageSource).toContain('className="pt-auth-brand-hero"');
    expect(pageSource).toContain('className="pt-auth-brand-logo"');
    expect(pageSource).toContain('src={BRANDING.logos.appIcon}');
    // The hero consumes the app-icon asset registered in branding, never the
    // horizontal wordmark or a fabricated graphic.
    expect(brandingSource).toContain("import peersAppIcon from './assets/peers-app-icon.png'");
    expect(brandingSource).toContain('appIcon: peersAppIcon');
    expect(pageSource).not.toContain('BRANDING.logos.wordmark');
    expect(stylesheet).toMatch(/\.pt-auth-brand-logo\s*\{[\s\S]*?width: 96px/);
    expect(stylesheet).toMatch(/\.pt-auth-brand-logo\s*\{[\s\S]*?height: 96px/);
    // The app icon is its own white rounded tile; no extra border frame or
    // drop shadow surrounds it (the former 2mm frame read as a clunky box).
    expect(stylesheet).not.toMatch(/\.pt-auth-brand-logo\s*\{[^}]*border:/);
    expect(stylesheet).not.toMatch(/\.pt-auth-brand-logo\s*\{[^}]*box-shadow/);
    // The old corner wordmark slot must not linger.
    expect(pageSource).not.toContain('pt-auth-brand-wordmark');
    expect(stylesheet).not.toContain('.pt-auth-brand ');
  });
});

describe('auth surface polish', () => {
  it('never shows a visible scrollbar on the auth shell while keeping it scrollable', () => {
    expect(stylesheet).toMatch(/\.pt-auth-shell\s*\{[\s\S]*?scrollbar-width: none/);
    expect(stylesheet).toContain('.pt-auth-shell::-webkit-scrollbar');
    expect(stylesheet).toMatch(/\.pt-auth-shell::-webkit-scrollbar\s*\{[\s\S]*?display: none/);
  });

  it('pins the reauth tile chevron to the far-right edge', () => {
    // The button content wrapper must span the full row so meta can grow.
    expect(stylesheet).toMatch(
      /\.pt-auth-reauth \.pt-button-content\s*\{[\s\S]*?width: 100%/,
    );
    expect(stylesheet).toMatch(/\.pt-auth-reauth-meta\s*\{[\s\S]*?flex: 1 1 auto/);
  });

  it('repositions the macOS traffic-light cluster toward the left edge', () => {
    const mainRs = readFileSync(
      new URL('../../../src-tauri/src/main.rs', import.meta.url),
      'utf8',
    );
    expect(mainRs).toContain('fn configure_window_traffic_lights');
    expect(mainRs).toContain('NSWindowButton::CloseButton');
    expect(mainRs).toContain('NSWindowButton::MiniaturizeButton');
    expect(mainRs).toContain('TRAFFIC_LIGHT_LEFT_SHIFT');
    expect(mainRs).toContain('setFrame(CGRect::new(');
    // The zoom light stays removed in the same routine.
    expect(mainRs).toContain('NSWindowButton::ZoomButton');
  });
});

describe('auth symmetric header back control', () => {
  it('places back in the head lead slot, symmetric with the language switcher', () => {
    expect(stylesheet).toContain('.pt-auth-head__lead');
    expect(pageSource).toContain('actionId="auth.back"');
    expect(pageSource).toContain('<LanguageSwitcher />');
    // The form suppresses its inline back once promoted to the header.
    expect(formSource).toContain('backInHeader = false');
    expect(formSource).toContain('hasBackButton && !backInHeader');
    expect(pageSource).toContain('backInHeader={showHeaderBack}');
  });
});

describe('auth surface structural hooks', () => {
  it('keeps the login card marker and footer Station switcher', () => {
    expect(pageSource).toContain('data-pt-login-card');
    expect(pageSource).toContain('<StationSwitcher />');
    // The switcher stays a popover trigger; the redesign is structural/CSS only.
    expect(switcherSource).toContain('actionId="auth.station.switch"');
    expect(switcherSource).toContain('className="pt-auth-station-trigger"');
  });
});

describe('account picker row trailing alignment', () => {
  it('mounts fixed badge / PIN / chevron slots on every row', () => {
    expect(pickerSource).toContain('className="pt-auth-account-trailing"');
    expect(pickerSource).toContain('className="pt-auth-account-trailing__badge"');
    expect(pickerSource).toContain('className="pt-auth-account-trailing__pin"');
    expect(pickerSource).toContain('className="pt-auth-account-trailing__chevron"');
    // The PIN slot is always present; the shield itself renders conditionally
    // inside it, so a missing shield cannot change the row geometry.
    expect(pickerSource).toMatch(/__pin"[\s\S]*?\{account\.hasPin &&/);
  });

  it('gives the PIN and chevron slots a fixed icon box in the stylesheet', () => {
    expect(stylesheet).toMatch(
      /\.pt-auth-account-trailing__pin,[\s\S]*?\.pt-auth-account-trailing__chevron\s*\{[\s\S]*?flex: 0 0 15px/,
    );
  });

  it('does not lay the trailing cluster out with an inline flex style', () => {
    expect(pickerSource).not.toMatch(/style=\{\{[^}]*display:\s*'inline-flex'/);
  });
});
