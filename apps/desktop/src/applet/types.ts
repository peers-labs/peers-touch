// Applet system type definitions — aligned with @peers-touch/applet-contract.
// No V2 suffix; this is the canonical version.

export const APPLET_BRIDGE_PROTOCOL = 'peers-touch.applet.bridge' as const

// ── Load types per platform ──

export type DesktopLoadType = 'lynx-web'
export type MobileLoadType = 'lynx-native'
export type StandaloneLoadType = 'web-spa'

export interface PlatformLoadConfig {
  type: DesktopLoadType | MobileLoadType | StandaloneLoadType
  entry: string
}

export interface AppletLoadMap {
  desktop?: { type: DesktopLoadType; entry: string }
  android?: { type: MobileLoadType; entry: string }
  ios?: { type: MobileLoadType; entry: string }
  standalone?: { type: StandaloneLoadType; entry: string }
}

// ── Bridge config ──

export interface AppletBridgeConfig {
  protocol: typeof APPLET_BRIDGE_PROTOCOL
  version: string
}

// ── Manifest ──

export type TargetPlatform = 'desktop' | 'android' | 'ios' | 'standalone'

export interface AppletManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  icon?: string
  permissions: string[]
  capabilities?: string[]
  minPlatformVersion?: string
  targetPlatforms: TargetPlatform[]
  load: AppletLoadMap
  bridge: AppletBridgeConfig
}

// ── Runtime info (manifest + resolved path) ──

export interface AppletInfo extends AppletManifest {
  path: string
}

// ── Bridge envelope (for Host → Applet events via sendGlobalEvent) ──

export interface BridgeEvent {
  topic: string
  payload?: unknown
}
