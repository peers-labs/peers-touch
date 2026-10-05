// Platform Adapter contract — translates platform events into standard lifecycle
// events, and executes surface operations on behalf of the Applet Kernel.
//
// Authoritative source: docs/architecture/platform/applet-runtime/applet-lifecycle-architecture.md
//   §4 事件映射标准, §6 分层架构 (Platform Adapter 职责), §9 端侧渲染 runtime 汇总.
//
// The adapter is the ONLY layer that knows about Tauri WebView / LynxView /
// Activity / UIScene. It never decides lifecycle policy (suspend/destroy timing)
// — that is the Kernel's job. It only:
//   1. translates raw platform signals into AppletLifecycleEvent, and
//   2. carries out surface commands (mount/show/hide/detach/destroy) the Kernel
//      issues.

import type { AppletLifecycleEvent } from './lifecycle.js';

/** Platform on which an adapter runs (architecture §10 platform field). */
export type AppletPlatform = 'desktop' | 'android' | 'ios';

/**
 * Surface command the Kernel issues to the adapter (architecture §9 show/hide
 * 机制). Semantics are identical across platforms; the carrier differs:
 *   - Desktop: DOM `display` / attach-detach of `<lynx-view>` host
 *   - Android/iOS: native LynxView attach/detach in the view hierarchy
 */
export type SurfaceCommand = 'mount' | 'show' | 'hide' | 'detach' | 'destroy';

/** Target of a surface command. */
export interface SurfaceTarget {
  appletId: string;
  instanceId: string;
}

/**
 * Platform Adapter interface (architecture §6).
 *
 * Implemented per platform (Desktop TS in WebView, Android Kotlin, iOS Swift).
 * The Kernel depends only on this abstraction, never on concrete render tech.
 */
export interface PlatformAdapter {
  readonly platform: AppletPlatform;

  /**
   * Subscribe to standard lifecycle events translated from platform signals
   * (window focus/blur/minimize/visibility, Activity/Scene lifecycle, memory
   * warnings). Returns an unsubscribe function.
   */
  onLifecycleEvent(handler: (event: AppletLifecycleEvent) => void): () => void;

  /**
   * Execute a surface command. Resolves once the surface reaches the requested
   * state. Must not make lifecycle policy decisions.
   */
  applySurfaceCommand(command: SurfaceCommand, target: SurfaceTarget): Promise<void>;

  /**
   * Best-effort memory estimate (bytes) for an instance, fed to the Kernel's
   * ResourceScheduler (architecture §5.3). Returns `undefined` when the platform
   * cannot measure it.
   */
  estimateMemory(target: SurfaceTarget): number | undefined;
}
