// Adapter auto-detection based on runtime environment.

import type { BridgeAdapter } from './adapter.js';
import { LynxBridgeAdapter, isLynxEnvironment } from './adapters/lynx.js';
import { WebHostBridgeAdapter, isWebHostEnvironment } from './adapters/web-host.js';
import { StandaloneBridgeAdapter } from './adapters/standalone.js';
import { AppletError, AppletErrorCode } from './errors.js';

declare global {
  var __PEERS_TOUCH_APPLET_STANDALONE__: boolean | undefined;
}

export class HostUnavailableBridgeAdapter implements BridgeAdapter {
  readonly name = 'unavailable';

  invoke(): Promise<unknown> {
    return Promise.reject(new AppletError(
      AppletErrorCode.BridgeUnavailable,
      'Peers-Touch Applet SDK requires a Lynx or Web Host bridge; standalone mode must be explicitly enabled.',
      { expectedHosts: ['lynx', 'web-host'], standaloneOptIn: '__PEERS_TOUCH_APPLET_STANDALONE__' },
    ));
  }

  onEvent(): () => void {
    return () => {};
  }
}

export function detectAdapter(): BridgeAdapter {
  if (isLynxEnvironment()) {
    return new LynxBridgeAdapter();
  }
  if (isWebHostEnvironment()) {
    return new WebHostBridgeAdapter();
  }
  if (globalThis.__PEERS_TOUCH_APPLET_STANDALONE__ === true) {
    return new StandaloneBridgeAdapter();
  }
  return new HostUnavailableBridgeAdapter();
}
