export function onWindowPopState(handler: () => void) {
  window.addEventListener('popstate', handler);
  return () => window.removeEventListener('popstate', handler);
}

export function onWindowLocationChange(handler: () => void) {
  window.addEventListener('popstate', handler);
  window.addEventListener('hashchange', handler);
  return () => {
    window.removeEventListener('popstate', handler);
    window.removeEventListener('hashchange', handler);
  };
}

export function onWindowKeydown(handler: (event: KeyboardEvent) => void) {
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}

export function onWindowOnline(handler: () => void) {
  window.addEventListener('online', handler);
  return () => window.removeEventListener('online', handler);
}

export function onWindowOffline(handler: () => void) {
  window.addEventListener('offline', handler);
  return () => window.removeEventListener('offline', handler);
}
