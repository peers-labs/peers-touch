import EventEmitter from 'eventemitter3'
import { 
  SystemInfo,
  StorageAPI,
  NetworkAPI,
  NotificationAPI,
  RequestOptions,
  ResponseData,
  DownloadOptions,
  DownloadResult,
  UploadOptions,
  UploadResult,
  NotificationOptions,
  AppletMeta,
  AppletEvent,
  AppletRegistration,
  EventCallback,
  LynxNativeBridgeModule,
  LynxWindow
} from './types'

class AppletSDK extends EventEmitter {
  private static instance: AppletSDK
  private appletMeta: AppletMeta | null = null

  private constructor() {
    super()
  }

  public static getInstance(): AppletSDK {
    if (!AppletSDK.instance) {
      AppletSDK.instance = new AppletSDK()
    }
    return AppletSDK.instance
  }

  private getBridge(): LynxNativeBridgeModule | null {
    if (typeof window === 'undefined') {
      return null
    }
    const hostWindow = window as LynxWindow
    return (
      hostWindow.__PEERS_TOUCH_LYNX_BRIDGE__
      || hostWindow.lynx?.nativeBridge
      || hostWindow.lynx?.nativeModules?.AppletBridge
      || hostWindow.LynxNativeBridge
      || null
    )
  }

  private normalizeResult(raw: unknown): unknown {
    if (typeof raw === 'object' && raw !== null && 'ok' in raw) {
      const bridgeResponse = raw as { ok?: boolean; result?: unknown; error?: { message?: string } }
      if (bridgeResponse.ok === false) {
        throw new Error(bridgeResponse.error?.message || 'Native bridge call failed')
      }
      if (bridgeResponse.ok === true && 'result' in bridgeResponse) {
        return bridgeResponse.result
      }
    }
    return raw
  }

  /**
   * 调用宿主API
   */
  private invokeAPI(api: string, params: any = {}): Promise<any> {
    const bridge = this.getBridge()
    if (!bridge || typeof bridge.invoke !== 'function') {
      return Promise.reject(new Error('Lynx Native Bridge is unavailable'))
    }
    return Promise.resolve(bridge.invoke(api, params)).then((raw) => this.normalizeResult(raw))
  }

  /**
   * 通用调用入口（供高阶封装使用）
   */
  public invoke<T = unknown>(api: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.invokeAPI(api, params)
  }

  /**
   * 获取系统信息
   */
  public getSystemInfo(): Promise<SystemInfo> {
    return this.invokeAPI('system.getInfo')
  }

  /**
   * 存储API
   */
  public storage: StorageAPI = {
    get: (key: string) => this.invokeAPI('storage.get', { key }),
    set: (key: string, value: string) => this.invokeAPI('storage.set', { key, value }),
    remove: (key: string) => this.invokeAPI('storage.remove', { key }),
    clear: () => this.invokeAPI('storage.clear'),
  }

  /**
   * 网络API
   */
  public network: NetworkAPI = {
    request: (options: RequestOptions) => this.invokeAPI('network.request', options),
    download: (options: DownloadOptions) => this.invokeAPI('network.download', options),
    upload: (options: UploadOptions) => this.invokeAPI('network.upload', options),
  }

  /**
   * 通知API
   */
  public notification: NotificationAPI = {
    show: (options: NotificationOptions) => this.invokeAPI('notification.show', options),
    onClick: (callback: (notificationId: string) => void) => {
      this.on('notification-click', callback)
    },
  }

  /**
   * 获取当前Applet的元信息
   */
  public getCurrentApplet(): Promise<AppletMeta> {
    if (this.appletMeta) {
      return Promise.resolve(this.appletMeta)
    }
    return this.invokeAPI('applet.getManifest').then(meta => {
      this.appletMeta = meta
      return meta
    })
  }

  /**
   * 监听Applet生命周期事件
   */
  public onEvent(event: AppletEvent, callback: EventCallback): void {
    this.on(event, callback)
  }

  /**
   * 取消监听Applet生命周期事件
   */
  public offEvent(event: AppletEvent, callback: EventCallback): void {
    this.off(event, callback)
  }

  /**
   * 关闭当前Applet
   */
  public close(): Promise<void> {
    return this.invokeAPI('applet.close')
  }

  /**
   * 获取设备剪贴板内容
   */
  public getClipboardContent(): Promise<string> {
    return this.invokeAPI('device.getClipboardContent')
  }

  /**
   * 设置设备剪贴板内容
   */
  public setClipboardContent(content: string): Promise<void> {
    return this.invokeAPI('device.setClipboardContent', { content })
  }

  /**
   * 显示Toast提示
   */
  public showToast(options: { 
    content: string
    duration?: number
    type?: 'success' | 'error' | 'info' | 'warning'
  }): Promise<void> {
    return this.invokeAPI('ui.showToast', options)
  }
}

// 导出单例
export const sdk = AppletSDK.getInstance()

declare global {
  interface Window {
    __PEERS_TOUCH_APPLET_FRONTEND__?: AppletRegistration
  }
}

/**
 * 前端 Applet 自注册（由宿主读取）
 */
export function registerApplet(definition: AppletRegistration): AppletRegistration {
  if (typeof window !== 'undefined') {
    window.__PEERS_TOUCH_APPLET_FRONTEND__ = definition
  }
  return definition
}

// 导出所有类型
export * from './types'

// 默认导出
export default AppletSDK
