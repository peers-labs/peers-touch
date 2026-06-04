/**
 * register-elements.ts — Initializes Lynx for Web runtime and applet host element.
 *
 * Imports @lynx-js/web-core (which registers the <lynx-view> Custom Element)
 * and @lynx-js/web-elements (which registers built-in Lynx component elements).
 * Also registers our <lynx-host> wrapper Custom Element.
 *
 * Call `registerAppletElements()` once during app bootstrap, before React
 * renders any component that uses <lynx-host>.
 */
import { LynxHostElement } from './lynx-host-element'

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

  // Dynamic imports to avoid blocking initial bundle parse.
  // @lynx-js/web-core/client registers <lynx-view> Custom Element.
  // @lynx-js/web-elements registers Lynx built-in elements (view, text, image, etc.).
  import('@lynx-js/web-core/client')
  import('@lynx-js/web-elements/all')
}
