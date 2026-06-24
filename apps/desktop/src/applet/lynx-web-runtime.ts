let runtimeReady: Promise<void> | null = null;

export function ensureLynxWebRuntime(): Promise<void> {
  if (runtimeReady) {
    return runtimeReady;
  }

  runtimeReady = (import.meta.env.PROD ? loadPackagedRuntime() : loadBundledRuntime())
    .then(() => customElements.whenDefined('lynx-view'))
    .then(() => undefined);
  return runtimeReady;
}

// Dev and prod both consume web-core through its public contract only: register
// the runtime and let the <lynx-view url> element drive the dual-thread bundle
// loading. We must NOT deep-import singleton-carrying modules like TemplateManager.js
// from a different specifier — that creates duplicate module-level instances.
//
// However, we DO pre-import LynxViewInstance.js (a class export, no singleton) to
// work around a race condition in web-core's TemplateManager:
//
// TemplateManager dispatches section messages via async #handleSection (which awaits
// an instancePromise depending on dynamic import('./LynxViewInstance.js')). The 'done'
// message handler runs synchronously and moves the bundle from #loadingBundles to
// #bundles. In Vite dev mode, web-core is excluded from optimizeDeps (Worker/WASM
// paths require it), so each internal module is served individually via HTTP. If the
// decode worker finishes before LynxViewInstance.js loads, 'done' preempts pending
// section handlers — #setLepusCode writes to a deleted map entry, and lepusCode
// ends up undefined at runtime.
//
// Pre-importing LynxViewInstance.js here warms Vite's module cache, ensuring the
// instancePromise in #handleSection resolves near-instantly (microtask) before any
// 'done' message arrives.
async function loadBundledRuntime(): Promise<void> {
  if (!customElements.get('lynx-view')) {
    await import('@lynx-js/web-core/client');
  }
  // Pre-warm the LynxViewInstance chunk to eliminate TemplateManager race window.
  // LynxView.js starts a prefetch import('./LynxViewInstance.js') at the top level,
  // but we need it fully loaded before any <lynx-view url=...> triggers #render().
  // We re-import the same module using a root-relative path that Vite can resolve
  // without going through package exports (web-core only exports ./client).
  // @ts-expect-error — Vite resolves this at runtime; tsc has no declaration for the path.
  await import(/* @vite-ignore */ '/node_modules/@lynx-js/web-core/dist/client/mainthread/LynxViewInstance.js');
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
