import { parseAppletIndex, parseAppletInfo, type AppletDiagnostic } from './schema'
import { type AppletInfo } from './types'
import { convertFileSrc } from '@tauri-apps/api/core'
import { api } from '../services/desktop_api'
import { readDesktopPreferenceSync, writeDesktopPreferenceSync } from '../storage/desktopClientStorage'
import { log } from '../utils/logger'

export type { AppletInfo } from './types'

interface AppletInstanceRecord {
  info: AppletInfo
  sessionId: string
  loadedAt: number
  status: 'loaded'
}

interface ImportedAppletRecord {
  directory: string
  manifest: unknown
}

const IMPORTED_APPLETS_KEY = 'pt.applets.importedCatalog'

class AppletManager {
  private static instance: AppletManager
  private applets: Map<string, AppletInfo> = new Map()
  private appletInstances: Map<string, AppletInstanceRecord> = new Map()
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
      const response = await fetch(`${this.appletDir}/index.json`, { cache: 'no-store' })
      if (response.ok) {
        const indexData = await response.json() as unknown
        const indexCheck = parseAppletIndex(indexData)
        if (!indexCheck.ok) {
          this.indexDiagnostics = indexCheck.issues
          this.printDiagnostics('Invalid applet index', this.indexDiagnostics)
          this.applets.clear()
          return []
        }

        const normalized: AppletInfo[] = []
        indexCheck.value.applets.forEach((rawApplet, index) => {
          const source = `index.applets[${index}]`
          const parsed = parseAppletInfo(rawApplet, source)
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
        const imported = this.loadImportedApplets()
        imported.forEach((applet) => {
          if (this.applets.has(applet.id)) {
            this.rejectedDiagnostics.set(applet.id, [`imported applet id duplicates an existing applet: ${applet.id}`])
            return
          }
          this.applets.set(applet.id, applet)
        })
        return Array.from(this.applets.values())
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.indexDiagnostics = [message]
      this.printDiagnostics('Failed to scan applets from index.json', this.indexDiagnostics)
    }
    this.applets.clear()
    this.loadImportedApplets().forEach((applet) => {
      this.applets.set(applet.id, applet)
    })
    if (this.applets.size > 0) {
      return Array.from(this.applets.values())
    }
    return []
  }

  public async importAppletDirectory(): Promise<AppletInfo> {
    const imported = await api.pickAppletImportDirectory()
    const applet = this.parseImportedApplet(imported, 'imported.selected')
    const records = this.readImportedAppletRecords()
    const nextRecords = records.filter((record) => this.extractImportedAppletId(record.manifest) !== applet.id)
    nextRecords.push({ directory: imported.directory, manifest: imported.manifest })
    writeDesktopPreferenceSync(IMPORTED_APPLETS_KEY, nextRecords)
    this.applets.set(applet.id, applet)
    return applet
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

  public registerApplet(appletInfo: AppletInfo): void {
    this.applets.set(appletInfo.id, appletInfo)
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

    const runtimeCheck = parseAppletInfo(appletInfo, `runtime[${appletId}]`)
    if (!runtimeCheck.ok) {
      this.printDiagnostics(`Refused to load invalid applet "${appletId}"`, runtimeCheck.issues)
      throw new Error(`Applet ${appletId} failed runtime validation:\n${runtimeCheck.issues.join('\n')}`)
    }

    if (appletInfo.minPlatformVersion && this.compareSemver(appletInfo.minPlatformVersion, this.platformVersion) > 0) {
      const issues = [`要求平台版本 ${appletInfo.minPlatformVersion}，当前仅 ${this.platformVersion}`]
      this.printDiagnostics(`Refused to load incompatible applet "${appletId}"`, issues)
      throw new Error(`Applet ${appletId} requires higher platform version: ${appletInfo.minPlatformVersion}`)
    }

    const integrityIssues = await this.verifyIntegrity(appletInfo)
    if (integrityIssues.length > 0) {
      this.rejectedDiagnostics.set(appletId, integrityIssues)
      this.printDiagnostics(`Refused to load applet with invalid integrity "${appletId}"`, integrityIssues)
      throw new Error(`Applet ${appletId} failed integrity validation:\n${integrityIssues.join('\n')}`)
    }

    if (this.appletInstances.has(appletId)) {
      return appletInfo
    }

    const session = await api.appletCreateSession({
      id: appletInfo.id,
      manifest: this.toGatewayManifest(appletInfo),
    })

    // 记录Applet实例
    this.appletInstances.set(appletId, {
      info: appletInfo,
      sessionId: session.sessionId,
      loadedAt: Date.now(),
      status: 'loaded',
    })

    return appletInfo
  }

  /**
   * 卸载Applet
   */
  public async unloadApplet(appletId: string): Promise<void> {
    const instance = this.appletInstances.get(appletId)
    if (!instance) return

    try {
      await api.appletInvoke({
        id: instance.info.id,
        sessionId: instance.sessionId,
        capability: 'lifecycle',
        action: 'destroy',
        manifest: this.toGatewayManifest(instance.info),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn('AppletManager', 'Failed to destroy applet gateway session', { appletId, error: message })
    } finally {
      this.appletInstances.delete(appletId)
    }
  }

  /**
   * 获取所有已加载的Applet
   */
  public getLoadedApplets(): string[] {
    return Array.from(this.appletInstances.keys())
  }

  public getSessionId(appletId: string): string | undefined {
    return this.appletInstances.get(appletId)?.sessionId
  }

  public getDesktopEntryUrl(appletId: string): string | undefined {
    const appletInfo = this.applets.get(appletId)
    const entry = appletInfo?.load.desktop?.entry
    const integrity = entry ? appletInfo?.integrity?.files[entry] : undefined
    if (!appletInfo || !entry || !integrity?.startsWith('sha256:')) {
      return undefined
    }
    return `${appletInfo.path}/${entry}?integrity=${encodeURIComponent(integrity.slice('sha256:'.length))}`
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
    log.error('AppletManager', scope, issues)
  }

  private loadImportedApplets(): AppletInfo[] {
    const records = this.readImportedAppletRecords()
    const applets: AppletInfo[] = []
    records.forEach((record, index) => {
      try {
        applets.push(this.parseImportedApplet(record, `imported[${index}]`))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const id = this.extractImportedAppletId(record.manifest) || `imported-${index}`
        this.rejectedDiagnostics.set(id, [message])
      }
    })
    return applets
  }

  private readImportedAppletRecords(): ImportedAppletRecord[] {
    const records = readDesktopPreferenceSync<ImportedAppletRecord[]>(IMPORTED_APPLETS_KEY)
    if (!Array.isArray(records)) return []
    return records.filter((record) => (
      record
      && typeof record === 'object'
      && typeof record.directory === 'string'
      && record.directory.length > 0
      && 'manifest' in record
    ))
  }

  private parseImportedApplet(record: ImportedAppletRecord, source: string): AppletInfo {
    const parsed = parseAppletInfo({
      ...(record.manifest as Record<string, unknown>),
      path: convertFileSrc(record.directory),
    }, source)
    if (!parsed.ok) {
      throw new Error(parsed.issues.join('\n'))
    }
    return parsed.value
  }

  private extractImportedAppletId(manifest: unknown): string | undefined {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return undefined
    const id = (manifest as { id?: unknown }).id
    return typeof id === 'string' && id.length > 0 ? id : undefined
  }

  private toGatewayManifest(appletInfo: AppletInfo): {
    id: string
    permissions: string[]
    services?: unknown[]
    skills?: unknown[]
  } {
    return {
      id: appletInfo.id,
      permissions: appletInfo.permissions,
      services: appletInfo.services,
      skills: appletInfo.skills,
    }
  }

  private async verifyIntegrity(appletInfo: AppletInfo): Promise<string[]> {
    const integrity = appletInfo.integrity
    if (!integrity || integrity.algorithm !== 'sha256') {
      return ['integrity.algorithm must be sha256']
    }
    if (!appletInfo.load.desktop?.entry) {
      return ['load.desktop.entry is required for Desktop runtime']
    }
    const requiredFiles = [appletInfo.load.desktop.entry, ...(appletInfo.skills ?? []).map((skill) => skill.inputSchema)]
    const missing = requiredFiles.filter((file) => !integrity.files[file])
    if (missing.length > 0) {
      return missing.map((file) => `integrity.files missing required file: ${file}`)
    }

    const issues: string[] = []
    for (const file of requiredFiles) {
      const expected = integrity.files[file]
      if (!this.isSafeRelativePath(file)) {
        issues.push(`integrity.files contains unsafe file path: ${file}`)
        continue
      }
      if (!expected.startsWith('sha256:') || expected.length !== 71) {
        issues.push(`integrity.files invalid sha256 digest for file: ${file}`)
        continue
      }

      try {
        const response = await fetch(`${appletInfo.path}/${file}`, { cache: 'no-store' })
        if (!response.ok) {
          issues.push(`integrity file fetch failed: ${file}`)
          continue
        }
        const bytes = await response.arrayBuffer()
        const actual = await this.sha256Hex(bytes)
        if (`sha256:${actual}` !== expected.toLowerCase()) {
          issues.push(`integrity mismatch for file: ${file}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        issues.push(`integrity file verification failed for ${file}: ${message}`)
      }
    }
    return issues
  }

  private isSafeRelativePath(file: string): boolean {
    return file.length > 0 && !file.startsWith('/') && !file.includes('..') && !file.includes('\\')
  }

  private async sha256Hex(bytes: ArrayBuffer): Promise<string> {
    if (!globalThis.crypto?.subtle) {
      throw new Error('SubtleCrypto is unavailable')
    }
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
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
