import { resolvePage } from './page';
import {
  acquireRuntimePage,
  releaseRuntimePage,
  type RuntimePageAcquireReason,
  type RuntimePageReleaseReason,
} from './runtime';

export function acquirePageRuntimeLease(pageId: string, reason: RuntimePageAcquireReason): void {
  const resolution = resolvePage(pageId);
  if (!resolution) return;
  for (const runtimeId of resolution.descriptor.runtimes) {
    acquireRuntimePage(runtimeId, pageId, reason);
  }
}

export function releasePageRuntimeLease(pageId: string, reason: RuntimePageReleaseReason): void {
  const resolution = resolvePage(pageId);
  if (!resolution) return;
  for (const runtimeId of resolution.descriptor.runtimes) {
    releaseRuntimePage(runtimeId, pageId, reason);
  }
}

export function requestPageRuntimeRelease(pageId: string, reason: Extract<RuntimePageReleaseReason, 'explicit-close'>): void {
  const run = () => releasePageRuntimeLease(pageId, reason);
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(run);
    return;
  }
  setTimeout(run, 0);
}
