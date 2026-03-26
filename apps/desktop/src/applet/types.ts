export const APPLET_MANIFEST_VERSION_V2 = 2 as const
export const APPLET_BRIDGE_PROTOCOL_V2 = 'peers-touch.applet.bridge.v2' as const

export type AppletLoadType = 'lynx'

export interface AppletLoadConfigV2 {
  type: AppletLoadType
  entry: string
}

export interface AppletBridgeConfigV2 {
  version: typeof APPLET_MANIFEST_VERSION_V2
  protocol: typeof APPLET_BRIDGE_PROTOCOL_V2
}

export interface AppletManifestV2 {
  manifestVersion: typeof APPLET_MANIFEST_VERSION_V2
  id: string
  name: string
  version: string
  description: string
  author: string
  icon: string
  permissions: string[]
  capabilities?: string[]
  minPlatformVersion?: string
  targetPlatforms?: Array<'desktop' | 'mobile' | 'web'>
  load: AppletLoadConfigV2
  bridge: AppletBridgeConfigV2
}

export interface AppletInfo extends AppletManifestV2 {
  main: string
  path: string
}

interface BridgeV2Envelope {
  protocol: typeof APPLET_BRIDGE_PROTOCOL_V2
  appletId: string
}

export interface BridgeV2InitMessage extends BridgeV2Envelope {
  kind: 'init'
  manifest: AppletManifestV2
}

export interface BridgeV2EventMessage extends BridgeV2Envelope {
  kind: 'event'
  event: string
  payload?: unknown
}

export type BridgeV2Message =
  | BridgeV2InitMessage
  | BridgeV2EventMessage
