import type { AppletProductWindowLaunchContext } from '../services/desktop_api';

declare global {
  interface Window {
    __PT_APPLET_PRODUCT_WINDOW_E2E__?: AppletProductWindowLaunchContext;
  }
}

let launchContext: AppletProductWindowLaunchContext | null = null;

export function setAppletProductWindowLaunchContext(context: AppletProductWindowLaunchContext): void {
  launchContext = context;
  window.__PT_APPLET_PRODUCT_WINDOW_E2E__ = context;
}

export function getAppletProductWindowLaunchContext(): AppletProductWindowLaunchContext | null {
  return launchContext ?? window.__PT_APPLET_PRODUCT_WINDOW_E2E__ ?? null;
}
