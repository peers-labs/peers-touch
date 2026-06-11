import type { BridgeAdapter } from '../adapter.js';

export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface WindowInfo {
  width: number;
  height: number;
  pixelRatio: number;
}

export interface VibrationOptions {
  durationMs?: number;
}

export interface DeviceAPI {
  getSafeArea(): Promise<SafeArea>;
  getWindowInfo(): Promise<WindowInfo>;
  vibrate(input?: VibrationOptions): Promise<void>;
}

export function createDeviceAPI(adapter: BridgeAdapter): DeviceAPI {
  return {
    getSafeArea(): Promise<SafeArea> {
      return adapter.invoke('device.getSafeArea') as Promise<SafeArea>;
    },
    getWindowInfo(): Promise<WindowInfo> {
      return adapter.invoke('device.getWindowInfo') as Promise<WindowInfo>;
    },
    vibrate(input: VibrationOptions = {}): Promise<void> {
      return adapter.invoke('device.vibrate', input as Record<string, unknown>) as Promise<void>;
    },
  };
}
