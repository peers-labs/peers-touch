// Source-contract: the auth surface is a single full-bleed grammar. The card
// itself is the window content at every size (no outer app canvas band or
// floating box), while its inner content keeps a fixed reading measure and
// centers. A centered brand hero carries the horizontal wordmark (height-only
// sizing preserves its aspect), and the back control shares the header row
// with the language switcher. The desktop package has no DOM test
// environment, so these assertions pin the stylesheet and component-source
// contract.
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
const gateStageSource = readFileSync(
  new URL('./resolveAuthGateStage.ts', import.meta.url),
  'utf8',
);
const registrySource = readFileSync(
  new URL('./useStationRegistry.ts', import.meta.url),
  'utf8',
);
const setupPanelSource = readFileSync(
  new URL('./StationSetupPanel.tsx', import.meta.url),
  'utf8',
);
const tauriConf = JSON.parse(
  readFileSync(
    new URL('../../../src-tauri/tauri.conf.json', import.meta.url),
    'utf8',
  ),
) as {
  app: {
    windows: Array<{
      width: number;
      height: number;
      minWidth: number;
      minHeight: number;
      decorations: boolean;
      titleBarStyle?: string;
      hiddenTitle?: boolean;
      maximizable?: boolean;
    }>;
  };
};
const windowSizingRs = readFileSync(
  new URL('../../../src-tauri/src/application/window_sizing.rs', import.meta.url),
  'utf8',
);
const mainRs = readFileSync(
  new URL('../../../src-tauri/src/main.rs', import.meta.url),
  'utf8',
);
const nativeSurfaceRs = readFileSync(
  new URL('../../../src-tauri/src/interface/tauri_commands/native_surface.rs', import.meta.url),
  'utf8',
);
const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
const desktopApiSource = readFileSync(
  new URL('../../services/desktop_api.ts', import.meta.url),
  'utf8',
);
const windowSurfaceHook = readFileSync(
  new URL('../../hooks/useWindowSurface.ts', import.meta.url),
  'utf8',
);

describe('auth full-bleed surface grammar', () => {
  it('renders the card as the window surface with no outer canvas band', () => {
    // The shell has no padding/canvas band; the card fills it edge to edge.
    expect(stylesheet).toMatch(/\.pt-auth-shell\s*\{[\s\S]*?padding:\s*0/);
    expect(stylesheet).toMatch(
      /\.pt-auth-shell \.pt-auth-card\s*\{[\s\S]*?width:\s*100%[\s\S]*?min-height:\s*100%/,
    );
    // No floating-tile chrome once inside the shell.
    expect(stylesheet).toMatch(
      /\.pt-auth-shell \.pt-auth-card\s*\{[\s\S]*?border:\s*0[\s\S]*?border-radius:\s*0[\s\S]*?box-shadow:\s*none/,
    );
    // Pine tint still defines the surface identity.
    expect(stylesheet).toContain(
      'color-mix(in srgb, var(--pt-accent) 8%, var(--pt-surface))',
    );
  });

  it('keeps inner content on a fixed centered reading measure', () => {
    // The surface is full-bleed but body/footer stay capped at the card width
    // variable and center, so wide windows do not stretch the form.
    expect(stylesheet).toMatch(
      /\.pt-auth-shell \.pt-auth-card \.pt-card-body\s*\{[\s\S]*?max-width:\s*var\(--pt-auth-card-width, 336px\)[\s\S]*?margin-inline:\s*auto/,
    );
    expect(stylesheet).toMatch(
      /\.pt-auth-shell \.pt-auth-card > footer\s*\{[\s\S]*?max-width:\s*var\(--pt-auth-card-width, 336px\)[\s\S]*?margin-inline:\s*auto/,
    );
  });

  it('keeps the card a flex column and compacts the first-run Station gate', () => {
    // The card remains a flex column; the body still flexes to fill the
    // available height whether it hosts the Station gate or a credential view.
    expect(stylesheet).toMatch(
      /\.pt-auth-shell \.pt-auth-card\s*\{[\s\S]*?display:\s*flex[\s\S]*?flex-direction:\s*column/,
    );
    expect(stylesheet).toMatch(
      /\.pt-auth-shell \.pt-auth-card \.pt-card-body\s*\{[\s\S]*?flex:\s*1 1 auto/,
    );
    // The Station gate renders as a compact centered card: it never stretches
    // to the full window height like the credential surface.
    expect(stylesheet).toMatch(
      /\.pt-auth-shell \.pt-auth-card\.pt-auth-card--station\s*\{[\s\S]*?min-height:\s*0[\s\S]*?align-self:\s*center/,
    );
    // Station management is a gear in the card header that opens the dedicated
    // Station setup card through the gate override; it never shares the auth
    // card body or a footer strip.
    expect(pageSource).toContain('actionId="auth.station.open"');
    expect(pageSource).toContain("setGateOverride('station_setup')");
    expect(stylesheet).toContain('.pt-auth-head__actions');
    expect(pageSource).not.toContain('<StationSwitcher />');
  });

  it('is size-independent: no auth width breakpoints remain', () => {
    expect(stylesheet).not.toContain('@media (max-width: 760px)');
    expect(stylesheet).not.toContain('@media (max-width: 480px)');
  });

  it('softens the embedded card hairline against the tinted surface', () => {
    // The non-shell (embedded) render path keeps a soft hairline.
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

  it('switches traffic-light chrome with the auth and ready surfaces', () => {
    const trafficLightRs = readFileSync(
      new URL(
        '../../../src-tauri/src/application/traffic_lights.rs',
        import.meta.url,
      ),
      'utf8',
    );
    // The dedicated module owns both chrome modes instead of a one-shot setup
    // mutation that hid the secondary lights for the whole app lifetime.
    expect(trafficLightRs).toContain('enum TrafficLightMode');
    expect(trafficLightRs).toContain('TrafficLightMode::Auth');
    expect(trafficLightRs).toContain('TrafficLightMode::Ready');
    expect(trafficLightRs).toContain('NSWindowButton::CloseButton');
    // Minimal WeChat-style auth chrome: minimize and zoom are hidden there.
    expect(trafficLightRs).toContain('NSWindowButton::MiniaturizeButton');
    expect(trafficLightRs).toContain('NSWindowButton::ZoomButton');
    // Auth hides the secondary lights; ready unhides the full cluster. The
    // hidden decision is a pure per-mode flag table consumed by one call site.
    expect(trafficLightRs).toContain('fn hidden_flags');
    expect(trafficLightRs).toContain(
      'TrafficLightMode::Auth => [false, true, true]',
    );
    expect(trafficLightRs).toContain(
      'TrafficLightMode::Ready => [false, false, false]',
    );
    expect(trafficLightRs).toContain('button.setHidden(hidden[slot])');
    // Placement stays fully native: the module must never write button frames
    // or subscribe to frame changes, because any programmatic move loses the
    // live-resize layout race and clips the lights against the top corner.
    expect(trafficLightRs).not.toContain('setFrameOrigin');
    expect(trafficLightRs).not.toContain('setFrame(');
    expect(trafficLightRs).not.toContain('NSViewFrameDidChangeNotification');
    // No declarative inset either: with trafficLightPosition absent, AppKit
    // keeps the lights at their native top-left inset through every resize.
    const tauriConf = readFileSync(
      new URL('../../../src-tauri/tauri.conf.json', import.meta.url),
      'utf8',
    );
    const windowConfig = JSON.parse(tauriConf).app.windows[0];
    expect(windowConfig.trafficLightPosition).toBeUndefined();
    expect(trafficLightRs).toContain('DispatchQueue::main().exec_async');

    // main.rs no longer owns a one-shot configurator; it applies the auth
    // mode at setup and lets the surface commands drive later transitions.
    expect(mainRs).not.toContain('fn configure_window_traffic_lights');
    expect(mainRs).toContain('TrafficLightState::default()');
    expect(mainRs).toContain('TrafficLightMode::Auth');
    expect(nativeSurfaceRs).toContain('fn apply_traffic_light_mode');
    expect(nativeSurfaceRs).toContain('TrafficLightMode::Auth');
    expect(nativeSurfaceRs).toContain('TrafficLightMode::Ready');
    // Chrome switching is inert under the acceptance build so harness chrome
    // stays governed by setup and harness window placement.
    expect(nativeSurfaceRs).toMatch(
      /fn apply_traffic_light_mode[\s\S]*?cfg!\(feature = "acceptance-webdriver"\)/,
    );

    // The icon rail keeps its fixed 60px column; the native light cluster sits
    // in the shared overlay title-bar strip above it, so it never collides with
    // the rail's avatar and icon content.
    const northstar = readFileSync(
      new URL('../../ui/northstar.css', import.meta.url),
      'utf8',
    );
    expect(northstar).toMatch(/\.ds-rail\s*\{[^}]*width:\s*60px/);
  });

  it('keeps the rail column hairline below the traffic-light title band', () => {
    const northstar = readFileSync(
      new URL('../../ui/northstar.css', import.meta.url),
      'utf8',
    );
    // A full-height hard seam made the native green light straddle the
    // rail/stage boundary. The base rail rule must no longer paint the 1px
    // inset line (only the soft glow spans the whole column).
    const railRule = northstar.match(/\.ds-rail\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(railRule).not.toContain('inset -1px 0 0');
    // The hairline moves to a pseudo that starts under the title band, so the
    // lights float on one continuous strip (--pt-rail-top is 40px on macOS,
    // 0 elsewhere, where the line correctly runs the full edge again).
    const seam = northstar.match(/\.ds-rail::after\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(seam).toContain('top: var(--pt-rail-top)');
    expect(seam).toContain('width: 1px');
    expect(seam).toContain(
      'background: color-mix(in srgb, var(--pt-text) 5%, transparent)',
    );
  });

  it('lets the frosted rail own the left edge instead of painting a frame on it', () => {
    const northstar = readFileSync(
      new URL('../../ui/northstar.css', import.meta.url),
      'utf8',
    );
    // The rail is a translucent blurred material no solid color can match, so
    // the shell frame is three-sided: zero left border (rail fills to the
    // rounded corner), 3px subtle frame only on the stage edges.
    const shell = northstar.match(/\.ds-shell\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(shell).toContain('border-width: 3px 3px 3px 0');
    expect(shell).toContain('border-color: var(--pt-subtle)');
    expect(shell).not.toContain('border: 3px solid');
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
  it('keeps the login card marker with the gear-driven Station card', () => {
    expect(pageSource).toContain('data-pt-login-card');
    // Zero-config installs get the inline first-run gate card.
    expect(pageSource).toContain('pt-auth-card--station');
    expect(setupPanelSource).toContain('data-pt-station-setup');
    // Already-configured installs re-open Station setup from the header gear,
    // which pins the gate machine to station_setup via an explicit override.
    expect(pageSource).toContain('actionId="auth.station.open"');
    expect(pageSource).toContain('useState<AuthGateOverride>(null)');
    // The gear-opened card gets a back control that releases the override.
    expect(setupPanelSource).toContain('actionId="auth.station.back"');
    expect(pageSource).toContain('setGateOverride(null)');
  });

  it('drives first-run Station setup through an explicit gate stage machine', () => {
    // The outer gate resolves station_setup vs auth from hydration + registry.
    expect(gateStageSource).toContain("export type AuthGateStage = 'station_setup' | 'auth'");
    expect(gateStageSource).toContain('export function resolveAuthGateStage');
    // The card feeds the gate its hydration state plus the gear override.
    expect(pageSource).toContain('resolveAuthGateStage(gateInput)');
    expect(pageSource).toContain('override: gateOverride');
    expect(pageSource).toContain('const showInlineStationSetup = gateStage === \'station_setup\'');
    // First run renders the inline Station card before any credential view.
    expect(pageSource).toContain('<StationSetupPanel');
    // Rule priority: existing accounts and a configured Station both reach
    // auth; first-run proceeds only via the session-only proceeded flag.
    expect(gateStageSource).toContain('input.hasAccounts || input.hasStation || input.proceeded');
    expect(pageSource).toContain('hasAccounts: hasExistingAccount');
    expect(pageSource).toContain('proceeded: firstRunProceeded');
    // The top-left "continue to sign in" action exists and is disabled until
    // a Station is configured, so first-run cannot reach sign-in empty-handed.
    expect(setupPanelSource).toContain('actionId="auth.station.continue-to-login"');
    expect(pageSource).toContain('disabled: !stationRegistry.hasStation');
  });

  it('keeps a single Station registry hook as the shared data source', () => {
    expect(registrySource).toContain('export function useStationRegistry');
    expect(registrySource).toContain('api.stationList()');
    expect(registrySource).toContain('hasStation: entries.length > 0');
    // The setup panel is pure presentation; the registry owns every mutation.
    expect(setupPanelSource).toContain('registry: StationRegistry');
    expect(setupPanelSource).not.toContain('api.stationList');
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

describe('native auth/ready window surface', () => {
  const mainWindow = tauriConf.app.windows[0];

  it('opens in the compact 360x640 auth window with the 320x440 floor', () => {
    expect(mainWindow.width).toBe(360);
    expect(mainWindow.height).toBe(640);
    expect(mainWindow.minWidth).toBe(320);
    expect(mainWindow.minHeight).toBe(440);
  });

  it('uses an overlay, title-hidden chrome without dropping decorations', () => {
    expect(mainWindow.decorations).toBe(true);
    expect(mainWindow.titleBarStyle).toBe('Overlay');
    expect(mainWindow.hiddenTitle).toBe(true);
    // The native maximize capability stays available even though the zoom
    // light itself is hidden for the minimal single-close title bar.
    expect(mainWindow.maximizable).toBe(true);
  });

  it('reserves a slim 40px rail header band so the avatar anchors near the top', () => {
    const northstar = readFileSync(
      new URL('../../ui/northstar.css', import.meta.url),
      'utf8',
    );
    expect(northstar).toContain("--pt-titlebar-inset: 8px");
    // The rail-top matches the 40px chat rail header rhythm: the traffic
    // lights keep their native top position and the avatar rises into the
    // reclaimed 8px instead of sitting under an oversized empty strip.
    expect(northstar).toContain("--pt-rail-top: 40px");
    expect(northstar).toContain('padding: var(--pt-rail-top) 0 14px');
    const chatStyles = readFileSync(
      new URL('../../ui/chat.css', import.meta.url),
      'utf8',
    );
    // The rail header keeps one FIXED height across the idle segmented island
    // (36px content) and the expanded search field (34px content). A min-height
    // let the band shrink 2px on search open and lift the Recent list, so it is
    // a locked height with overflow hidden instead.
    expect(chatStyles).toMatch(/\.sc-rail-header\s*\{[^}]*height: 48px/);
    expect(chatStyles).toMatch(/\.sc-rail-header\s*\{[^}]*overflow: hidden/);
    expect(chatStyles).not.toMatch(/\.sc-rail-header\s*\{[^}]*min-height: 40px/);
  });

  it('defines the auth and ready geometry constants and ready fallback', () => {
    expect(windowSizingRs).toContain('AUTH_WINDOW_WIDTH: f64 = 360.0');
    expect(windowSizingRs).toContain('AUTH_WINDOW_HEIGHT: f64 = 640.0');
    expect(windowSizingRs).toContain('DEFAULT_READY_WIDTH: f64 = 1200.0');
    expect(windowSizingRs).toContain('DEFAULT_READY_HEIGHT: f64 = 800.0');
  });

  it('persists only ready-surface user resizes in config storage', () => {
    expect(windowSizingRs).toContain('"window", "geometry.json"');
    expect(windowSizingRs).toContain('StorageKind::Config');
    // Programmatic resizes are flagged so they never overwrite the memory.
    expect(windowSizingRs).toContain('applying_programmatic');
  });

  it('stays inert under the acceptance-webdriver build', () => {
    expect(windowSizingRs).toContain('cfg!(feature = "acceptance-webdriver")');
  });

  it('registers both surface commands on the native surface module', () => {
    expect(nativeSurfaceRs).toContain('pub fn native_window_apply_auth_surface');
    expect(nativeSurfaceRs).toContain('pub fn native_window_apply_ready_surface');
    expect(mainRs).toContain('native_surface::native_window_apply_auth_surface');
    expect(mainRs).toContain('native_surface::native_window_apply_ready_surface');
    expect(mainRs).toContain('window_sizing::WindowSizingState::default()');
    expect(mainRs).toContain('window_sizing::handle_window_event');
  });

  it('drives the surface from the React lifecycle through typed api wrappers', () => {
    expect(desktopApiSource).toContain('nativeWindowApplyAuthSurface');
    expect(desktopApiSource).toContain('nativeWindowApplyReadySurface');
    expect(desktopApiSource).toContain("'native_window_apply_auth_surface'");
    expect(desktopApiSource).toContain("'native_window_apply_ready_surface'");
    expect(windowSurfaceHook).toContain("viewState === 'ready'");
    expect(windowSurfaceHook).toContain('api.nativeWindowApplyReadySurface()');
    expect(windowSurfaceHook).toContain('api.nativeWindowApplyAuthSurface()');
    expect(appSource).toContain('useWindowSurface(viewState)');
  });

  it('applies the macOS frame atomically instead of two async frame commits', () => {
    // Size + recenter fold into one synchronous main-queue block; AppKit
    // coalesces the flush at run-loop end, so no intermediate frame paints.
    expect(windowSizingRs).toContain('fn apply_window_frame');
    expect(windowSizingRs).toContain('setContentSize');
    expect(windowSizingRs).toContain('.center()');
    expect(windowSizingRs).toContain('DispatchQueue::main().exec_sync');
    // The deprecated no-op screen-update gate must not be relied upon.
    expect(windowSizingRs).not.toContain('disableScreenUpdatesUntilFlush');
  });

  it('hides the resize behind a boot veil with geometry-scoped, epoch-guarded transitions', () => {
    // The hook exposes the veil state and the ready-shell settle gate.
    expect(windowSurfaceHook).toContain('veilVisible');
    expect(windowSurfaceHook).toContain('readySurfaceSettled');
    // Transitions fire only on an actual auth ↔ ready geometry change; views in
    // the same geometry family (onboarding ↔ resuming) never resize or veil.
    expect(windowSurfaceHook).toContain("type WindowSurface = 'auth' | 'ready'");
    expect(windowSurfaceHook).toContain('appliedSurfaceRef');
    expect(windowSurfaceHook).toContain('inFlightRef');
    expect(windowSurfaceHook).toContain('targetSurface === appliedSurfaceRef.current');
    // Interrupted/StrictMode runs re-apply instead of no-opping.
    expect(windowSurfaceHook).toContain('inFlightRef.current = true');
    // Rapid transitions are guarded so a stale transition cannot reveal early.
    expect(windowSurfaceHook).toContain('epochRef');
    // Two frames let the WebView re-lay out at the final bounds, then one more
    // lets the ready shell commit its first paint behind the opaque veil.
    expect(windowSurfaceHook).toContain('await nextFrame()');
    // A failed native command still releases the veil instead of trapping the user.
    expect(windowSurfaceHook).toContain("log.error('app', 'native window surface apply failed'");
    // Hard degradation guard so a stalled chain can never trap the user.
    expect(windowSurfaceHook).toContain('VEIL_FORCE_RELEASE_MS');

    const veilSource = readFileSync(
      new URL('../../components/SurfaceTransitionVeil.tsx', import.meta.url),
      'utf8',
    );
    expect(veilSource).toContain('pt-surface-veil');
    expect(veilSource).toContain('is-leaving');
    // App only mounts the heavy ready shell after geometry settles, and renders
    // the veil as a fixed sibling so it covers both expand and shrink.
    expect(appSource).toContain('mountReadyShell');
    expect(appSource).toContain('surfaceTransition.readySurfaceSettled');
    expect(appSource).toContain('<SurfaceTransitionVeil');

    const northstar = readFileSync(
      new URL('../../ui/northstar.css', import.meta.url),
      'utf8',
    );
    expect(northstar).toMatch(
      /\.pt-surface-veil\s*\{[^}]*position:\s*fixed[^}]*opacity:\s*1/,
    );
    expect(northstar).toContain('transition: opacity 160ms');
    // Overlays cross-fade only; reduced-motion users get an instant switch.
    expect(northstar).toMatch(
      /prefers-reduced-motion: reduce[\s\S]*?\.pt-surface-veil\s*\{\s*transition: none;/,
    );
  });
});
