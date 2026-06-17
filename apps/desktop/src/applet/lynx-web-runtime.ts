let runtimeReady: Promise<void> | null = null;

const MTS_PRELOAD_PATCH = Symbol.for('peers-touch.lynx-web-runtime.mts-preload-patch');
const MTS_PRELOAD_TIMEOUT_MS = 2000;
const MTS_PRELOAD_RETRY_DELAY_MS = 10;

type LynxTemplateManager = {
  fetchBundle(
    url: string,
    lynxViewInstancePromise: Promise<LynxViewInstanceLike>,
    transformVW: boolean,
    transformVH: boolean,
    transformREM: boolean,
    overrideConfig?: Record<string, string>,
  ): Promise<void>;
};

type LynxViewInstanceLike = {
  onMTSScriptsLoaded(currentUrl: string, isLazy: boolean): Promise<void>;
  mainThreadGlobalThis?: Record<string, unknown>;
  [MTS_PRELOAD_PATCH]?: boolean;
};

type LynxTemplateManagerModule = {
  templateManager: LynxTemplateManager;
};

export function ensureLynxWebRuntime(): Promise<void> {
  if (runtimeReady) {
    return runtimeReady;
  }

  runtimeReady = (import.meta.env.PROD ? loadPackagedRuntime() : loadBundledRuntime())
    .then(() => customElements.whenDefined('lynx-view'))
    .then(() => undefined);
  return runtimeReady;
}

async function loadBundledRuntime(): Promise<void> {
  if (!customElements.get('lynx-view')) {
    await import('@lynx-js/web-core/client');
  }
  await preloadBundledRuntimeMainThread();
}

async function preloadBundledRuntimeMainThread(): Promise<void> {
  const templateManagerModule = await import('@lynx-js/web-core/dist/client/mainthread/TemplateManager.js') as LynxTemplateManagerModule;
  installMTSScriptPreloadPatch(templateManagerModule.templateManager);
}

function installMTSScriptPreloadPatch(templateManager: LynxTemplateManager): void {
  if ((templateManager as unknown as LynxViewInstanceLike)[MTS_PRELOAD_PATCH]) return;

  const originalFetchBundle = templateManager.fetchBundle.bind(templateManager);
  templateManager.fetchBundle = (url, lynxViewInstancePromise, transformVW, transformVH, transformREM, overrideConfig) => {
    const patchedInstancePromise = lynxViewInstancePromise.then((instance) => {
      installInstanceMTSScriptPreloadPatch(instance);
      return instance;
    });
    return originalFetchBundle(url, patchedInstancePromise, transformVW, transformVH, transformREM, overrideConfig);
  };
  (templateManager as unknown as LynxViewInstanceLike)[MTS_PRELOAD_PATCH] = true;
}

function installInstanceMTSScriptPreloadPatch(instance: LynxViewInstanceLike): void {
  if (instance[MTS_PRELOAD_PATCH]) return;

  const originalOnMTSScriptsLoaded = instance.onMTSScriptsLoaded.bind(instance);
  instance.onMTSScriptsLoaded = async (currentUrl, isLazy) => {
    installMainThreadLynxCompat(instance);
    return runWhenMTSScriptsReady(originalOnMTSScriptsLoaded, currentUrl, isLazy);
  };
  instance[MTS_PRELOAD_PATCH] = true;
}

function installMainThreadLynxCompat(instance: LynxViewInstanceLike): void {
  if (!instance.mainThreadGlobalThis) return;
  if (typeof instance.mainThreadGlobalThis.getJSModule === 'function') return;
  instance.mainThreadGlobalThis.getJSModule = () => undefined;
}

async function runWhenMTSScriptsReady(
  loadScripts: (currentUrl: string, isLazy: boolean) => Promise<void>,
  currentUrl: string,
  isLazy: boolean,
): Promise<void> {
  if (isLazy) {
    return loadScripts(currentUrl, isLazy);
  }

  const deadline = Date.now() + MTS_PRELOAD_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await loadScripts(currentUrl, isLazy);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, MTS_PRELOAD_RETRY_DELAY_MS));
  }

  if (lastError instanceof Error) {
    throw new Error(`Lynx Web runtime did not expose a main-thread root script for ${currentUrl}: ${lastError.message}`);
  }
  throw new Error(`Lynx Web runtime did not expose a main-thread root script for ${currentUrl}`);
}

function loadPackagedRuntime(): Promise<void> {
  ensureStylesheet('./lynx-web-core/static/css/client.css');
  return ensureModuleScript('./lynx-web-core/static/js/client.js');
}

function ensureStylesheet(href: string): void {
  const url = new URL(href, window.location.href).toString();
  const existing = document.querySelector(`link[data-peers-lynx-runtime="css"][href="${url}"]`);
  if (existing) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  link.dataset.peersLynxRuntime = 'css';
  document.head.appendChild(link);
}

function ensureModuleScript(src: string): Promise<void> {
  const url = new URL(src, window.location.href).toString();
  const existing = document.querySelector(`script[data-peers-lynx-runtime="js"][src="${url}"]`);
  if (existing) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = url;
    script.dataset.peersLynxRuntime = 'js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load Lynx Web runtime asset: ${url}`));
    document.head.appendChild(script);
  });
}
