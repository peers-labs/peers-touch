/**
 * register-elements.ts — Initializes Lynx for Web runtime and applet host element.
 *
 * Imports @lynx-js/web-core (which registers <lynx-view> and loads built-in Lynx elements).
 * Also registers our <lynx-host> wrapper Custom Element.
 *
 * Call `registerAppletElements()` once during app bootstrap, before React
 * renders any component that uses <lynx-host>.
 */
import { LynxHostElement } from './lynx-host-element'
import { ensureLynxWebRuntime } from './lynx-web-runtime'

let registered = false

/**
 * Registers Lynx for Web runtime (lynx-view + built-in elements) and <lynx-host>.
 * Safe to call multiple times — re-registration is silently skipped.
 */
export function registerAppletElements(): void {
  if (registered) return
  registered = true

  // Register our <lynx-host> Custom Element (wraps <lynx-view> + Bridge)
  if (!customElements.get('lynx-host')) {
    customElements.define('lynx-host', LynxHostElement)
  }

  void ensureLynxWebRuntime()
}
