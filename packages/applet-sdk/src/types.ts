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

// Applet元信息
export interface AppletMeta {
  id: string
  name: string
  version: string
  description: string
  author: string
  permissions: string[]
}

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
