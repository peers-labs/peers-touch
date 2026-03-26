import { parseAppletIndexV2, parseAppletInfoV2, type AppletDiagnostic } from './schema'
import { type AppletInfo } from './types'

export type { AppletInfo } from './types'

class AppletManager {
  private static instance: AppletManager
  private applets: Map<string, AppletInfo> = new Map()
  private appletInstances: Map<string, any> = new Map()
  private rejectedDiagnostics: Map<string, string[]> = new Map()
  private indexDiagnostics: string[] = []
  private appletDir: string = '/applets-dist'
  private platformVersion = '0.1.0'

  private constructor() {}

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
    this.rejectedDiagnostics.clear()
    this.indexDiagnostics = []
    try {
      const response = await fetch(`${this.appletDir}/index.json`)
      if (response.ok) {
        const indexData = await response.json() as unknown
        const indexCheck = parseAppletIndexV2(indexData)
        if (!indexCheck.ok) {
          this.indexDiagnostics = indexCheck.issues
          this.printDiagnostics('Invalid applet index', this.indexDiagnostics)
          this.applets.clear()
          return []
        }

        const normalized: AppletInfo[] = []
        indexCheck.value.applets.forEach((rawApplet, index) => {
          const source = `index.applets[${index}]`
          const parsed = parseAppletInfoV2(rawApplet, source)
          if (!parsed.ok) {
            const rejectedId = this.extractAppletId(rawApplet, index)
            this.rejectedDiagnostics.set(rejectedId, parsed.issues)
            return
          }
          if (normalized.some((item) => item.id === parsed.value.id)) {
            this.rejectedDiagnostics.set(parsed.value.id, [`${source}.id 重复，无法加载同 ID applet`])
            return
          }
          normalized.push(parsed.value)
        })

        if (this.rejectedDiagnostics.size > 0) {
          this.rejectedDiagnostics.forEach((issues, appletId) => {
            this.printDiagnostics(`Rejected applet "${appletId}"`, issues)
          })
        }

        this.applets.clear()
        normalized.forEach((applet) => {
          this.applets.set(applet.id, applet)
        })
        return normalized
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.indexDiagnostics = [message]
      this.printDiagnostics('Failed to scan applets from index.json', this.indexDiagnostics)
    }
    this.applets.clear()
    return []
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
      const rejectedIssues = this.rejectedDiagnostics.get(appletId)
      if (rejectedIssues && rejectedIssues.length > 0) {
        this.printDiagnostics(`Refused to load invalid applet "${appletId}"`, rejectedIssues)
        throw new Error(`Applet ${appletId} is invalid:\n${rejectedIssues.join('\n')}`)
      }
      throw new Error(`Applet ${appletId} not found`)
    }

    const runtimeCheck = parseAppletInfoV2(appletInfo, `runtime[${appletId}]`)
    if (!runtimeCheck.ok) {
      this.printDiagnostics(`Refused to load invalid applet "${appletId}"`, runtimeCheck.issues)
      throw new Error(`Applet ${appletId} failed runtime validation:\n${runtimeCheck.issues.join('\n')}`)
    }

    if (appletInfo.minPlatformVersion && this.compareSemver(appletInfo.minPlatformVersion, this.platformVersion) > 0) {
      const issues = [`要求平台版本 ${appletInfo.minPlatformVersion}，当前仅 ${this.platformVersion}`]
      this.printDiagnostics(`Refused to load incompatible applet "${appletId}"`, issues)
      throw new Error(`Applet ${appletId} requires higher platform version: ${appletInfo.minPlatformVersion}`)
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
   * 获取所有已加载的Applet
   */
  public getLoadedApplets(): string[] {
    return Array.from(this.appletInstances.keys())
  }

  public getDiagnostics(): AppletDiagnostic[] {
    const diagnostics: AppletDiagnostic[] = []
    if (this.indexDiagnostics.length > 0) {
      diagnostics.push({
        source: 'index.json',
        issues: [...this.indexDiagnostics],
      })
    }
    this.rejectedDiagnostics.forEach((issues, appletId) => {
      diagnostics.push({
        source: appletId,
        issues: [...issues],
      })
    })
    return diagnostics
  }

  /**
   * 清空所有Applet
   */
  public clear(): void {
    this.appletInstances.clear()
  }

  private extractAppletId(rawApplet: unknown, index: number): string {
    if (typeof rawApplet === 'object' && rawApplet !== null && 'id' in rawApplet) {
      const id = (rawApplet as { id?: unknown }).id
      if (typeof id === 'string' && id.length > 0) {
        return id
      }
    }
    return `invalid-${index}`
  }

  private printDiagnostics(scope: string, issues: string[]): void {
    if (issues.length === 0) return
    console.error(`[AppletManager] ${scope}`)
    issues.forEach((issue) => {
      console.error(`[AppletManager]   - ${issue}`)
    })
  }

  private compareSemver(left: string, right: string): number {
    const normalize = (value: string): [number, number, number] => {
      const version = value.split('-')[0]
      const [major, minor, patch] = version.split('.').map((item) => Number(item))
      return [major || 0, minor || 0, patch || 0]
    }
    const l = normalize(left)
    const r = normalize(right)
    if (l[0] !== r[0]) return l[0] - r[0]
    if (l[1] !== r[1]) return l[1] - r[1]
    return l[2] - r[2]
  }
}

export default AppletManager
