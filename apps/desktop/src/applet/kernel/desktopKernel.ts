// Desktop Applet Kernel composition root — a process-wide singleton that wires
// the cross-platform AppletKernel with Desktop-specific collaborators.
//
// Authoritative contract: packages/applet-kernel/src/index.ts (AppletKernelDeps).
// Execution plan: docs/architecture/platform/applet-runtime/execution-plans/2026-07-02-applet-runtime-lifecycle-buildout.md §6.2.
//
// Kernel-single-authority (§6.1): this kernel is the ONLY LRU / TTL / memory-
// pressure authority on Desktop. The Shell keeps applet page frames resident and
// never evicts; all surface work flows through the injected DesktopPlatformAdapter.

import {
  AppletKernel,
  DESKTOP_RESOURCE_POLICY,
  type Clock,
  type KernelLogger,
} from '@peers-touch/applet-kernel';
import { DesktopPlatformAdapter } from './DesktopPlatformAdapter';
import { DesktopSessionBackend } from './DesktopSessionBackend';
import { DesktopAuditSink } from './DesktopAuditSink';
import { log } from '../../utils/logger';

const KERNEL_LOG_TAG = 'applet-kernel';

// KernelLogger uses (message, context?) whereas the desktop logger uses
// (tag, msg, data?). Adapt by pinning the tag.
const kernelLogger: KernelLogger = {
  debug: (message, context) => log.debug(KERNEL_LOG_TAG, message, context),
  info: (message, context) => log.info(KERNEL_LOG_TAG, message, context),
  warn: (message, context) => log.warn(KERNEL_LOG_TAG, message, context),
  error: (message, context) => log.error(KERNEL_LOG_TAG, message, context),
};

const clock: Clock = { now: () => Date.now() };

let adapterSingleton: DesktopPlatformAdapter | null = null;
let kernelSingleton: AppletKernel | null = null;

export function getDesktopAppletAdapter(): DesktopPlatformAdapter {
  if (!adapterSingleton) {
    adapterSingleton = new DesktopPlatformAdapter();
  }
  return adapterSingleton;
}

export function getDesktopAppletKernel(): AppletKernel {
  if (!kernelSingleton) {
    kernelSingleton = new AppletKernel({
      clock,
      logger: kernelLogger,
      adapter: getDesktopAppletAdapter(),
      policy: DESKTOP_RESOURCE_POLICY,
      sessionBackend: new DesktopSessionBackend(),
      auditSink: new DesktopAuditSink(),
    });
  }
  return kernelSingleton;
}
