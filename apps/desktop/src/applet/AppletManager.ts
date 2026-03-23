interface AppletInfo {
  id: string
  name: string
  version: string
  description: string
  author: string
  icon: string
  main: string
  permissions: string[]
  path: string
}

class AppletManager {
  private static instance: AppletManager
  private applets: Map<string, AppletInfo> = new Map()
  private appletInstances: Map<string, any> = new Map()
  private appletDir: string = '/applets-dist'

  private constructor() {
    // 监听来自Applet的消息
    window.addEventListener('message', this.handleMessage.bind(this))
  }

  public static getInstance(): AppletManager {
    if (!AppletManager.instance) {
      AppletManager.instance = new AppletManager()
    }
    return AppletManager.instance
  }

  /**
   * 扫描本地Applet目录，获取所有可用Applet
   */
  public async scanApplets(): Promise<AppletInfo[]> {
    try {
      // 开发环境从applets-dist目录加载
      const response = await fetch(`${this.appletDir}/index.json`)
      if (response.ok) {
        const applets = await response.json()
        applets.forEach((applet: AppletInfo) => {
          this.applets.set(applet.id, applet)
        })
        return applets
      }
    } catch (error) {
      console.warn('Failed to scan applets from index.json, falling back to manual scan')
    }

    // 手动扫描已知Applet
    const knownApplets = ['agent-pilot', 'remote-cli', 'web-search']
    const applets: AppletInfo[] = []

    for (const appletId of knownApplets) {
      try {
        const response = await fetch(`${this.appletDir}/${appletId}/applet.json`)
        if (response.ok) {
          const appletInfo = await response.json()
          appletInfo.path = `${this.appletDir}/${appletId}`
          this.applets.set(appletId, appletInfo)
          applets.push(appletInfo)
        }
      } catch (error) {
        console.debug(`Applet ${appletId} not found`)
      }
    }

    return applets
  }

  /**
   * 获取Applet信息
   */
  public getAppletInfo(appletId: string): AppletInfo | undefined {
    return this.applets.get(appletId)
  }

  /**
   * 获取所有可用Applet
   */
  public getAvailableApplets(): AppletInfo[] {
    return Array.from(this.applets.values())
  }

  /**
   * 加载Applet
   */
  public async loadApplet(appletId: string): Promise<AppletInfo> {
    const appletInfo = this.applets.get(appletId)
    if (!appletInfo) {
      throw new Error(`Applet ${appletId} not found`)
    }

    if (this.appletInstances.has(appletId)) {
      return appletInfo
    }

    // 记录Applet实例
    this.appletInstances.set(appletId, {
      info: appletInfo,
      loadedAt: Date.now(),
      status: 'loaded',
    })

    return appletInfo
  }

  /**
   * 卸载Applet
   */
  public unloadApplet(appletId: string): void {
    this.appletInstances.delete(appletId)
  }

  /**
   * 向Applet发送消息
   */
  public sendMessage(appletId: string, message: any): void {
    // 找到对应的Applet iframe并发送消息
    const iframe = document.querySelector(`iframe[data-applet-id="${appletId}"]`) as HTMLIFrameElement
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(message, '*')
    }
  }

  /**
   * 处理来自Applet的消息
   */
  private handleMessage(event: MessageEvent): void {
    const { type, api, params, callbackId, appletId } = event.data

    // 只处理Applet的API调用请求
    if (type !== 'api-call' || !callbackId) {
      return
    }

    this.handleApiCall(appletId, api, params, callbackId, event.source as Window)
  }

  /**
   * 处理Applet的API调用请求
   */
  private async handleApiCall(
    appletId: string, 
    api: string, 
    params: any, 
    callbackId: number,
    sourceWindow: Window
  ): Promise<void> {
    try {
      // 检查Applet权限
      const appletInfo = this.applets.get(appletId)
      if (!appletInfo) {
        throw new Error('Applet not found')
      }

      // 调用对应的JSAPI实现
      const result = await this.invokeApi(api, params, appletInfo)
      
      // 返回调用结果
      sourceWindow.postMessage({
        type: 'api-response',
        callbackId,
        success: true,
        data: result,
      }, '*')
    } catch (error) {
      // 返回错误信息
      sourceWindow.postMessage({
        type: 'api-response',
        callbackId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }, '*')
    }
  }

  /**
   * 调用具体的API实现
   */
  private async invokeApi(api: string, params: any, appletInfo: AppletInfo): Promise<any> {
    // 这里实现具体的JSAPI，和applet-sdk的API定义完全对齐
    switch (api) {
      case 'system.getInfo':
        return {
          platform: 'desktop',
          os: navigator.platform.toLowerCase().includes('mac') ? 'macos' : 
              navigator.platform.toLowerCase().includes('win') ? 'windows' : 'linux',
          version: '0.1.0',
          appVersion: '0.1.0',
          appName: 'Peers Touch Desktop',
          screenWidth: window.screen.width,
          screenHeight: window.screen.height,
        }

      case 'storage.get':
        // Applet独立存储，使用appletId作为前缀
        return localStorage.getItem(`applet:${appletInfo.id}:${params.key}`)

      case 'storage.set':
        localStorage.setItem(`applet:${appletInfo.id}:${params.key}`, params.value)
        return true

      case 'storage.remove':
        localStorage.removeItem(`applet:${appletInfo.id}:${params.key}`)
        return true

      case 'storage.clear':
        // 只清理当前Applet的存储
        const prefix = `applet:${appletInfo.id}:`
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith(prefix)) {
            localStorage.removeItem(key)
          }
        })
        return true

      case 'network.request':
        // 网络请求代理，支持跨域
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), params.timeout || 30000)
        const response = await fetch(params.url, {
          method: params.method || 'GET',
          headers: params.headers,
          body: params.data ? JSON.stringify(params.data) : undefined,
          signal: controller.signal,
        })
        clearTimeout(timeout)

        const headers: Record<string, string> = {}
        response.headers.forEach((value, key) => {
          headers[key] = value
        })

        return {
          data: await response.json(),
          status: response.status,
          headers,
        }

      case 'notification.show':
        if (!('Notification' in window)) {
          throw new Error('Notifications not supported')
        }

        if (Notification.permission !== 'granted') {
          const permission = await Notification.requestPermission()
          if (permission !== 'granted') {
            throw new Error('Notification permission denied')
          }
        }

        new Notification(params.title, {
          body: params.content,
          icon: params.icon,
          silent: !params.sound,
        })

        return true

      case 'applet.getInfo':
        return appletInfo

      case 'applet.close':
        // 通知上层关闭Applet
        window.dispatchEvent(new CustomEvent('applet-close', { detail: appletInfo.id }))
        return true

      case 'device.getClipboardContent':
        return navigator.clipboard.readText()

      case 'device.setClipboardContent':
        await navigator.clipboard.writeText(params.content)
        return true

      case 'ui.showToast':
        // 这里可以集成全局Toast组件
        console.log(`Toast: ${params.content} (${params.type})`)
        return true

      default:
        throw new Error(`API ${api} not implemented`)
    }
  }

  /**
   * 获取所有已加载的Applet
   */
  public getLoadedApplets(): string[] {
    return Array.from(this.appletInstances.keys())
  }

  /**
   * 清空所有Applet
   */
  public clear(): void {
    this.appletInstances.clear()
  }
}

export default AppletManager
