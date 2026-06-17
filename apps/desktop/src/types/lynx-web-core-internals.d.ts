declare module '@lynx-js/web-core/dist/client/mainthread/TemplateManager.js' {
  export const templateManager: {
    getBundle(url: string): { lepusCode?: Record<string, string> } | undefined
  }
}

declare module '@lynx-js/web-core/dist/client/mainthread/LynxViewInstance.js' {
  export class LynxViewInstance {
    onMTSScriptsLoaded(currentUrl: string, isLazy: boolean): Promise<void>
  }
}
