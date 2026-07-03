// Desktop SurfaceManager — owns the imperative `<lynx-host>` mount point for each
// applet instance and executes the surface commands the Applet Kernel issues.
//
// Authoritative contract:
//   - packages/applet-contract/src/platform-adapter.ts (SurfaceCommand semantics)
//   - packages/applet-kernel/src/lifecycle-orchestrator.ts (frozen command mapping)
// Execution plan: docs/architecture/applet-runtime/execution-plans/2026-07-02-applet-runtime-lifecycle-buildout.md §6.1/§6.2.
//
// Kernel-single-authority (§6.1): the Shell keeps the applet page React frame
// resident (keepAlive:'forever'); SurfaceManager is the ONLY place that attaches,
// shows, hides, detaches, or destroys the `<lynx-host>` — always in response to a
// Kernel-issued command. It never decides WHEN to reclaim.
//
// Command mapping (§6.2, strictly aligned with the frozen Orchestrator):
//   show    → mount host into slot if absent + display visible (remount view if detached)
//   hide    → display:none (kept warm; DOM + bundle retained)
//   detach  → drop the <lynx-view> child, keep the host shell + record for instant restore
//   destroy → remove host + <lynx-view> entirely; DOES NOT destroy the session
//             (the Orchestrator already did sessions.destroy + registry.remove)
//
// Note: mount is an internal step of `show`; the Orchestrator never issues a bare
// `mount`. pause/resume carry no surface command; the applet-side freeze is driven
// through signalPause/signalResume after the Kernel accepts the transition.
//
// Host <-> page wiring: the applet page frame (LynxContainer) owns the DOM slot and
// the navigation/ui/device/debug/ready/error/load callbacks, but NOT the host
// element. It publishes both through `bindSlot`; SurfaceManager creates the host and
// wires the handlers live off the record, so the wiring is independent of the order
// in which `show` (first frame) and `bindSlot` (React mount) arrive.

import type { SurfaceCommand, SurfaceTarget } from '@peers-touch/applet-contract';
import AppletManager from '../AppletManager';
import type {
  AppletHostDeviceRequest,
  AppletHostNavigationRequest,
  AppletHostUiRequest,
  LynxHostElement,
} from '../lynx-host-element';
import type { LynxDebugEvent } from '../LynxDebugPanel';
import { log } from '../../utils/logger';

const SURFACE_TAG = 'applet-surface';

/**
 * Page-provided callbacks for a single applet surface. Supplied via `bindSlot`
 * and read live off the record, so late binding still receives host events that
 * fired during mount.
 */
export interface SurfaceHandlers {
  onReady?: () => void;
  onLoad?: () => void;
  onError?: (error: Error) => void;
  onDebugEvent?: (event: LynxDebugEvent) => void;
  navigationHandler?: (request: AppletHostNavigationRequest) => void;
  uiHandler?: (request: AppletHostUiRequest) => unknown | Promise<unknown>;
  deviceHandler?: (request: AppletHostDeviceRequest) => unknown | Promise<unknown>;
}

interface HostRecord {
  /** Page-provided container the host lives in (bound by the applet page frame). */
  slot: HTMLElement | null;
  /** The live `<lynx-host>` element, created lazily on first show. */
  host: LynxHostElement | null;
  /** Live page callbacks; the host wiring reads these on every event. */
  handlers: SurfaceHandlers | null;
  /** Whether the surface should currently be visible. */
  visible: boolean;
  /** Whether the `<lynx-view>` child has been detached (suspended). */
  detached: boolean;
}

export class SurfaceManager {
  private readonly records = new Map<string, HostRecord>();

  /**
   * Bind the DOM container + page callbacks the applet page frame provides for
   * `target`. Because the page frame is `keepAlive:'forever'`, the slot outlives
   * hide/detach; the host is (re)mounted into it when the Kernel shows the
   * instance. Rebinding refreshes the live handlers used by an existing host.
   */
  bindSlot(target: SurfaceTarget, slot: HTMLElement, handlers?: SurfaceHandlers): void {
    const record = this.ensureRecord(target);
    record.slot = slot;
    if (handlers) record.handlers = handlers;
    if (record.visible && record.host && record.host.parentElement !== slot) {
      slot.appendChild(record.host);
    }
  }

  /** Release the container binding (frame torn down). Detaches the host from DOM. */
  unbindSlot(target: SurfaceTarget): void {
    const record = this.records.get(target.instanceId);
    if (!record) return;
    if (record.host && record.host.parentElement) {
      record.host.parentElement.removeChild(record.host);
    }
    record.slot = null;
    record.handlers = null;
  }

  async applySurfaceCommand(command: SurfaceCommand, target: SurfaceTarget): Promise<void> {
    switch (command) {
      case 'mount':
      case 'show':
        this.show(target);
        return;
      case 'hide':
        this.hide(target);
        return;
      case 'detach':
        this.detach(target);
        return;
      case 'destroy':
        this.destroy(target);
        return;
      default:
        return;
    }
  }

  /**
   * Forward a pause freeze to the running applet. pause/resume produce no surface
   * command in the frozen Orchestrator, so the applet-visible freeze/unfreeze is
   * delivered here after the Kernel accepts the transition (§6.3).
   */
  signalPause(target: SurfaceTarget): void {
    this.records.get(target.instanceId)?.host?.surfacePause();
  }

  signalResume(target: SurfaceTarget): void {
    this.records.get(target.instanceId)?.host?.surfaceResume();
  }

  private show(target: SurfaceTarget): void {
    const record = this.ensureRecord(target);
    record.visible = true;

    if (!record.host) {
      record.host = this.createHost(target, record);
    }
    if (record.slot && record.host.parentElement !== record.slot) {
      record.slot.appendChild(record.host);
    }
    if (record.detached) {
      record.host.surfaceRemount();
      record.detached = false;
    }
    record.host.style.display = 'block';
  }

  private hide(target: SurfaceTarget): void {
    const record = this.records.get(target.instanceId);
    if (!record) return;
    record.visible = false;
    if (record.host) {
      record.host.style.display = 'none';
    }
  }

  private detach(target: SurfaceTarget): void {
    const record = this.records.get(target.instanceId);
    if (!record) return;
    record.visible = false;
    record.detached = true;
    if (record.host) {
      record.host.style.display = 'none';
      record.host.surfaceDetach();
    }
  }

  private destroy(target: SurfaceTarget): void {
    const record = this.records.get(target.instanceId);
    if (!record) return;
    if (record.host) {
      record.host.surfaceDestroy();
      record.host.parentElement?.removeChild(record.host);
    }
    this.records.delete(target.instanceId);
  }

  private createHost(target: SurfaceTarget, record: HostRecord): LynxHostElement {
    const manager = AppletManager.getInstance();
    const info = manager.getAppletInfo(target.appletId);
    const sessionId = manager.getSessionId(target.appletId);
    const entry = info?.load.desktop?.entry;
    if (!info || !sessionId || !entry) {
      log.error(SURFACE_TAG, 'cannot create host: applet not resolvable', {
        appletId: target.appletId,
        instanceId: target.instanceId,
        hasInfo: Boolean(info),
        hasSession: Boolean(sessionId),
      });
      throw new Error(`applet surface unavailable for ${target.appletId}`);
    }

    const host = document.createElement('lynx-host') as LynxHostElement;
    host.style.width = '100%';
    host.style.height = '100%';
    host.setAttribute('applet-id', target.appletId);
    host.setAttribute('session-id', sessionId);
    host.setAttribute('url', `${info.path}/${entry}`);
    this.wireHost(host, record);
    return host;
  }

  /**
   * Wire host events + imperative bridge handlers to the record's live page
   * callbacks. Reading `record.handlers` inside each closure means handlers bound
   * after the host was created (bindSlot arriving late) still take effect, and
   * events dispatched during bundle mount are forwarded to whatever the page has
   * registered by then.
   */
  private wireHost(host: LynxHostElement, record: HostRecord): void {
    host.navigationHandler = (request) => record.handlers?.navigationHandler?.(request);
    host.uiHandler = (request) => record.handlers?.uiHandler?.(request);
    host.deviceHandler = (request) => record.handlers?.deviceHandler?.(request);

    host.addEventListener('ready', () => record.handlers?.onReady?.());
    host.addEventListener('load', () => record.handlers?.onLoad?.());
    host.addEventListener('error', (event) => {
      const detail = (event as unknown as CustomEvent<{ message?: string }>).detail;
      record.handlers?.onError?.(new Error(detail?.message || 'applet host error'));
    });
    host.addEventListener('applet-debug', (event) => {
      const detail = (event as CustomEvent<LynxDebugEvent>).detail;
      if (detail) record.handlers?.onDebugEvent?.(detail);
    });
  }

  private ensureRecord(target: SurfaceTarget): HostRecord {
    let record = this.records.get(target.instanceId);
    if (!record) {
      record = { slot: null, host: null, handlers: null, visible: false, detached: false };
      this.records.set(target.instanceId, record);
    }
    return record;
  }
}
