export type DesktopHostKind = 'native-tauri' | 'browser';
export type DesktopPlatform = 'macos' | 'windows' | 'linux' | 'unknown';

export interface DesktopHostPolicy {
  readonly kind: DesktopHostKind;
  readonly platform: DesktopPlatform;
  readonly nativeSocialEnabled: boolean;
}

let bootPolicy: DesktopHostPolicy | null = null;

function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

// Synchronous platform probe. The native overlay title bar (Tauri
// `titleBarStyle: Overlay`) is macOS-only, so the web layer needs a
// pre-paint platform flag to apply the top title-bar inset and drag region
// without a flash. WKWebView/macOS user agents contain "Macintosh".
function detectPlatform(target: object | undefined): DesktopPlatform {
  const userAgent =
    target && hasOwn(target, 'navigator')
      ? ((target as Window).navigator?.userAgent ?? '')
      : '';
  if (/Mac OS X|Macintosh/i.test(userAgent)) return 'macos';
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Linux|X11/i.test(userAgent)) return 'linux';
  return 'unknown';
}

export function initializeDesktopHostPolicy(
  target: object | undefined = typeof window === 'undefined' ? undefined : window,
): DesktopHostPolicy {
  if (bootPolicy) return bootPolicy;

  const nativeTauri = Boolean(
    target
    && hasOwn(target, '__TAURI_INTERNALS__'),
  );
  const platform = detectPlatform(target);
  if (
    typeof document !== 'undefined'
    && document.documentElement
    && platform !== 'unknown'
  ) {
    document.documentElement.dataset.platform = platform;
  }
  bootPolicy = Object.freeze({
    kind: nativeTauri ? 'native-tauri' : 'browser',
    platform,
    nativeSocialEnabled: nativeTauri,
  });
  return bootPolicy;
}

export function getDesktopHostPolicy(): DesktopHostPolicy {
  return initializeDesktopHostPolicy();
}
