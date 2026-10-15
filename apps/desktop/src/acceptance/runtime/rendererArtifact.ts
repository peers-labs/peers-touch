declare const __PT_SOURCE_COMMIT__: string;

let artifactDigest: Promise<string> | null = null;

export function resetRendererArtifactDigest(): void {
  artifactDigest = null;
}

async function sha256(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function rendererArtifactSha256(): Promise<string> {
  if (artifactDigest) return artifactDigest;
  artifactDigest = (async () => {
    const candidates = new Set<string>();
    for (const script of Array.from(document.scripts)) {
      if (script.src) {
        const url = new URL(script.src, window.location.href);
        if (url.origin === window.location.origin) candidates.add(url.href);
      }
    }
    for (const entry of performance.getEntriesByType('resource')) {
      const resource = entry as PerformanceResourceTiming;
      if (resource.initiatorType === 'script' && resource.name) {
        const url = new URL(resource.name, window.location.href);
        if (url.origin === window.location.origin) candidates.add(url.href);
      }
    }
    if (candidates.size === 0) {
      throw new Error('runtime.acceptance.rendererArtifactMissing');
    }
    const artifacts = await Promise.all(
      [...candidates].sort().map(async (url) => {
        const response = await fetch(url, {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!response.ok) {
          throw new Error('runtime.acceptance.rendererArtifactFetchFailed');
        }
        return {
          path: new URL(url).pathname,
          sha256: await sha256(await response.arrayBuffer()),
        };
      }),
    );
    return sha256(JSON.stringify({
      schemaVersion: 1,
      sourceCommit: __PT_SOURCE_COMMIT__,
      artifacts,
    }));
  })();
  return artifactDigest;
}
