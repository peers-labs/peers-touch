// Applet Manifest / Bridge 协议版本定义
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
  icon?: string
  permissions: string[]
  capabilities?: string[]
  minPlatformVersion?: string
  targetPlatforms?: Array<'desktop' | 'mobile' | 'web'>
  load: AppletLoadConfigV2
  bridge: AppletBridgeConfigV2
}

export interface BridgeV2Envelope {
  protocol: typeof APPLET_BRIDGE_PROTOCOL_V2
  appletId: string
}

export interface BridgeV2InitMessage extends BridgeV2Envelope {
  kind: 'init'
  manifest: AppletManifestV2
}

export interface BridgeV2EventMessage extends BridgeV2Envelope {
  kind: 'event'
  event: AppletEvent | string
  payload?: unknown
}

export type BridgeV2Message =
  | BridgeV2InitMessage
  | BridgeV2EventMessage

export interface LynxNativeBridgeModule {
  invoke: (method: string, params?: unknown) => unknown | Promise<unknown>
}

export interface LynxWindow extends Window {
  __PEERS_TOUCH_LYNX_BRIDGE__?: LynxNativeBridgeModule
  LynxNativeBridge?: LynxNativeBridgeModule
  lynx?: {
    nativeBridge?: LynxNativeBridgeModule
    nativeModules?: {
      AppletBridge?: LynxNativeBridgeModule
    }
  }
}

// 系统信息
export interface SystemInfo {
  platform: 'desktop' | 'mobile' | 'web'
  os: 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'harmonyos'
  version: string
  appVersion: string
  appName: string
  screenWidth: number
  screenHeight: number
  statusBarHeight?: number
}

// 存储API
export interface StorageAPI {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<void>
  remove: (key: string) => Promise<void>
  clear: () => Promise<void>
}

// 网络API
export interface NetworkAPI {
  request: (options: RequestOptions) => Promise<ResponseData>
  download: (options: DownloadOptions) => Promise<DownloadResult>
  upload: (options: UploadOptions) => Promise<UploadResult>
}

// 通知API
export interface NotificationAPI {
  show: (options: NotificationOptions) => Promise<void>
  onClick: (callback: (notificationId: string) => void) => void
}

// 请求选项
export interface RequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  headers?: Record<string, string>
  data?: any
  timeout?: number
}

// 响应数据
export interface ResponseData<T = any> {
  data: T
  status: number
  headers: Record<string, string>
}

// 下载选项
export interface DownloadOptions {
  url: string
  headers?: Record<string, string>
  filePath?: string
}

// 下载结果
export interface DownloadResult {
  filePath: string
  statusCode: number
  fileSize: number
}

// 上传选项
export interface UploadOptions {
  url: string
  filePath: string
  name: string
  headers?: Record<string, string>
  formData?: Record<string, string>
}

// 上传结果
export interface UploadResult {
  data: any
  statusCode: number
}

// 通知选项
export interface NotificationOptions {
  title: string
  content?: string
  icon?: string
  sound?: boolean
  duration?: number
}

// Applet元信息（兼容旧命名，语义为 Manifest V2）
export type AppletMeta = AppletManifestV2

// Applet生命周期事件
export type AppletEvent = 
  | 'launch' 
  | 'show' 
  | 'hide' 
  | 'destroy'
  | 'page-show'
  | 'page-hide'

// 通用事件回调
export type EventCallback<T = any> = (data: T) => void

// Frontend Applet registration types (host-rendered applet web bundles)
export interface AppletPageProps {
  onBack: () => void
  onPin?: () => void
  pinned?: boolean
}

export interface AppletSettingsProps {
  appletId: string
}

export interface AppletRegistration {
  id: string
  page?: AppletComponent<AppletPageProps>
  settingsPanel?: AppletComponent<AppletSettingsProps>
  sidebarIcon?: unknown
}

export type AppletComponent<P = Record<string, unknown>> = (props: P) => unknown
