// Adapter auto-detection based on runtime environment.

import type { BridgeAdapter } from './adapter.js';
import { LynxBridgeAdapter, isLynxEnvironment } from './adapters/lynx.js';
import { StandaloneBridgeAdapter } from './adapters/standalone.js';

export function detectAdapter(): BridgeAdapter {
  if (isLynxEnvironment()) {
    return new LynxBridgeAdapter();
  }
  return new StandaloneBridgeAdapter();
}
