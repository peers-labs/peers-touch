// Session Manager — thin lifecycle wrapper over the capability SessionBackend.
//
// Authoritative source: docs/architecture/applet-runtime/applet-lifecycle-architecture.md
//   §6 分层架构 (Session Manager 职责: create/renew/destroy Gateway sessions).
//
// The manager owns no business data; it delegates to the injected backend
// (Rust Gateway in production) and adds structured, secret-safe logging.

import type { KernelLogger, SessionBackend, SessionManager } from './ports.js';

export class DefaultSessionManager implements SessionManager {
  constructor(
    private readonly backend: SessionBackend,
    private readonly logger: KernelLogger,
  ) {}

  async create(appletId: string, instanceId: string): Promise<string> {
    try {
      const sessionId = await this.backend.createSession(appletId, instanceId);
      // The sessionId is a capability secret and is never logged; only the
      // identity context is safe to record.
      this.logger.info('session created', { appletId, instanceId });
      return sessionId;
    } catch (error) {
      this.logger.error('session create failed', { appletId, instanceId, error });
      throw error;
    }
  }

  async renew(sessionId: string): Promise<void> {
    try {
      await this.backend.renewSession(sessionId);
      this.logger.debug('session renewed');
    } catch (error) {
      this.logger.error('session renew failed', { error });
      throw error;
    }
  }

  async destroy(sessionId: string): Promise<void> {
    try {
      await this.backend.destroySession(sessionId);
      this.logger.debug('session destroyed');
    } catch (error) {
      this.logger.error('session destroy failed', { error });
      throw error;
    }
  }
}
