// Desktop SessionBackend — bridges the Applet Kernel SessionManager to the
// AppletManager-owned capability session (keyed by appletId, backed by the Rust
// Capability Gateway via desktop_api).
//
// Authoritative contract: packages/applet-kernel/src/ports.ts (SessionBackend).
// Execution plan: docs/architecture/applet-runtime/execution-plans/2026-07-02-applet-runtime-lifecycle-buildout.md §6.2/§6.4.
//
// §6.4 keeps AppletManager as the single owner of the capability session and
// manifest (keyed by appletId). The Kernel tracks lifecycle state under
// instanceId (= pageId). This backend therefore ADOPTS the AppletManager session
// rather than minting a second one, and records instanceId→appletId so a
// destroy issued by the Orchestrator (which only carries sessionId) can reclaim
// the AppletManager entry.

import type { SessionBackend } from '@peers-touch/applet-kernel';
import AppletManager from '../AppletManager';

export class DesktopSessionBackend implements SessionBackend {
  // sessionId → appletId, so destroySession(sessionId) can reach AppletManager,
  // which is keyed by appletId.
  private readonly appletBySession = new Map<string, string>();

  /**
   * Adopt the capability session AppletManager already created for `appletId`.
   * The runtime materializes + loads the applet (station bundle, validation,
   * integrity, gateway session) before dispatching `launch`; here we only read
   * the resulting session. If it is somehow absent we load on demand so the
   * kernel always receives a real session id.
   */
  async createSession(appletId: string): Promise<string> {
    const manager = AppletManager.getInstance();
    let sessionId = manager.getSessionId(appletId);
    if (!sessionId) {
      await manager.loadApplet(appletId);
      sessionId = manager.getSessionId(appletId);
    }
    if (!sessionId) {
      throw new Error(`applet session unavailable for ${appletId}`);
    }
    this.appletBySession.set(sessionId, appletId);
    return sessionId;
  }

  /** The Gateway has no renew concept; the AppletManager session stays valid. */
  async renewSession(): Promise<void> {
    // no-op
  }

  /**
   * Destroy the Gateway session by delegating to AppletManager (the single
   * session owner). Only the Orchestrator's destroy/error path calls this.
   */
  async destroySession(sessionId: string): Promise<void> {
    const appletId = this.appletBySession.get(sessionId);
    if (!appletId) return;
    this.appletBySession.delete(sessionId);
    await AppletManager.getInstance().unloadApplet(appletId);
  }
}
