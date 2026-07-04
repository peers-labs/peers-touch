// Desktop PlatformAdapter — the only layer that knows about Tauri WebView / DOM.
//
// Authoritative contract: packages/applet-contract/src/platform-adapter.ts.
// Execution plan: docs/architecture/applet-runtime/execution-plans/2026-07-02-applet-runtime-lifecycle-buildout.md §6.2/§6.3.
//
// Responsibilities (never makes lifecycle policy decisions — that is the Kernel):
//   1. applySurfaceCommand → routes to the SurfaceManager (the DOM owner).
//   2. onLifecycleEvent → a subscription bus. The Lifecycle Adapter (appletsRuntime)
//      subscribes and forwards every event to AppletKernel.dispatch; platform
//      signal sources call `emit` to publish translated events.
//   3. estimateMemory → best-effort JS heap reading from performance.memory.

import type {
  AppletLifecycleEvent,
  PlatformAdapter,
  SurfaceCommand,
  SurfaceTarget,
} from '@peers-touch/applet-contract';
import { SurfaceManager } from './SurfaceManager';

// performance.memory is a non-standard Chromium extension (present in the
// Desktop WebView). Typed locally since lib.dom does not declare it.
interface ChromiumMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export class DesktopPlatformAdapter implements PlatformAdapter {
  readonly platform = 'desktop' as const;

  readonly surfaces = new SurfaceManager();

  private readonly handlers = new Set<(event: AppletLifecycleEvent) => void>();

  onLifecycleEvent(handler: (event: AppletLifecycleEvent) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Publish a translated platform signal to all subscribers. */
  emit(event: AppletLifecycleEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  applySurfaceCommand(command: SurfaceCommand, target: SurfaceTarget): Promise<void> {
    return this.surfaces.applySurfaceCommand(command, target);
  }

  estimateMemory(_target: SurfaceTarget): number | undefined {
    const memory = (performance as Performance & { memory?: ChromiumMemory }).memory;
    if (!memory) return undefined;
    // Per-instance attribution is unavailable in a shared WebView; report the
    // process JS-heap usage as a coarse pressure signal for the scheduler.
    return memory.usedJSHeapSize;
  }
}
