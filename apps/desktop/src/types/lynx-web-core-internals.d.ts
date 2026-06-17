declare module '@lynx-js/web-core/dist/client/mainthread/TemplateManager.js' {
  export const templateManager: {
    getBundle(url: string): { lepusCode?: Record<string, string> } | undefined
    fetchBundle(
      url: string,
      lynxViewInstancePromise: Promise<{
        onMTSScriptsLoaded(currentUrl: string, isLazy: boolean): Promise<void>
      }>,
      transformVW: boolean,
      transformVH: boolean,
      transformREM: boolean,
      overrideConfig?: Record<string, string>,
    ): Promise<void>
  }
}
