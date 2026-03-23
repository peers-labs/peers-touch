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
  EventCallback
} from './types'

class AppletSDK extends EventEmitter {
  private static instance: AppletSDK
  private appletMeta: AppletMeta | null = null
  private callbackId = 0
  private callbacks: Map<number, { resolve: Function; reject: Function }> = new Map()

  private constructor() {
    super()
    this.initMessageListener()
  }

  public static getInstance(): AppletSDK {
    if (!AppletSDK.instance) {
      AppletSDK.instance = new AppletSDK()
    }
    return AppletSDK.instance
  }

  /**
   * 初始化消息监听器，接收来自宿主的消息
   */
  private initMessageListener(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.handleMessage.bind(this))
    }
  }

  /**
   * 处理来自宿主的消息
   */
  private handleMessage(event: MessageEvent): void {
    const { type, callbackId, success, data, error, eventName, eventData } = event.data

    // 处理API调用响应
    if (type === 'api-response' && callbackId !== undefined) {
      const callback = this.callbacks.get(callbackId)
      if (callback) {
        if (success) {
          callback.resolve(data)
        } else {
          callback.reject(new Error(error || 'Unknown error'))
        }
        this.callbacks.delete(callbackId)
      }
    }

    // 处理事件通知
    if (type === 'event' && eventName) {
      this.emit(eventName, eventData)
    }
  }

  /**
   * 调用宿主API
   */
  private invokeAPI(api: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.callbackId++
      this.callbacks.set(id, { resolve, reject })

      // 发送消息到宿主
      if (window.parent !== window) {
        window.parent.postMessage({
          type: 'api-call',
          api,
          params,
          callbackId: id,
        }, '*')
      } else {
        // 开发环境模拟
        reject(new Error('Not running in applet environment'))
      }
    })
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
    return this.invokeAPI('applet.getInfo').then(meta => {
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

// 导出所有类型
export * from './types'

// 默认导出
export default AppletSDK
