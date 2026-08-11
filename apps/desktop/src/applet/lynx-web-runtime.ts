let runtimeReady: Promise<void> | null = null;

export function ensureLynxWebRuntime(): Promise<void> {
  if (runtimeReady) {
    return runtimeReady;
  }

  runtimeReady = loadPackagedRuntime()
    .then(() => customElements.whenDefined('lynx-view'))
    .then(() => undefined);
  return runtimeReady;
}

function loadPackagedRuntime(): Promise<void> {
  const runtimeBase = import.meta.env.VITE_LYNX_WEB_RUNTIME_BASE;
  ensureStylesheet(`${runtimeBase}/css/client.css`);
  return ensureModuleScript(`${runtimeBase}/js/client.js`);
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
