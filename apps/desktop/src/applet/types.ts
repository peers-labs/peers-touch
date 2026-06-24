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
  harmony?: { type: MobileLoadType; entry: string }
  web?: { type: DesktopLoadType; entry: string }
  standalone?: { type: StandaloneLoadType; entry: string }
}

// ── Bridge config ──

export interface AppletBridgeConfig {
  protocol: typeof APPLET_BRIDGE_PROTOCOL
  version: string
}

// ── Manifest ──

export type TargetPlatform = 'desktop' | 'android' | 'ios' | 'harmony' | 'web' | 'standalone'

export interface AppletServiceDeclaration {
  id: string
  kind: 'http'
  binding: 'host-resolved' | 'station-resolved' | 'dev-override'
  allowedMethods: string[]
  allowedPaths: string[]
  publicPathPrefix?: string
  stationPathPrefix?: string
  streaming?: boolean
}

export interface AppletSkillDeclaration {
  id: string
  inputSchema: string
  streaming?: boolean
}

export interface AppletIntegrity {
  algorithm: 'sha256'
  files: Record<string, string>
}

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
  targets?: TargetPlatform[]
  entries?: { lynx: string; standalone?: string }
  services?: AppletServiceDeclaration[]
  skills?: AppletSkillDeclaration[]
  integrity?: AppletIntegrity
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
