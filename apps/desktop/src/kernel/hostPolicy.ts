export type DesktopHostKind = 'native-tauri' | 'browser';

export interface DesktopHostPolicy {
  readonly kind: DesktopHostKind;
  readonly nativeSocialEnabled: boolean;
}

let bootPolicy: DesktopHostPolicy | null = null;

function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

export function initializeDesktopHostPolicy(
  target: object | undefined = typeof window === 'undefined' ? undefined : window,
): DesktopHostPolicy {
  if (bootPolicy) return bootPolicy;

  const nativeTauri = Boolean(
    target
    && hasOwn(target, '__TAURI_INTERNALS__')
    && !hasOwn(target, '__PT_GATEWAY_BASE__'),
  );
  bootPolicy = Object.freeze({
    kind: nativeTauri ? 'native-tauri' : 'browser',
    nativeSocialEnabled: nativeTauri,
  });
  return bootPolicy;
}

export function getDesktopHostPolicy(): DesktopHostPolicy {
  return initializeDesktopHostPolicy();
}
