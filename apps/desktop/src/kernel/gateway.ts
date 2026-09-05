import {
  markInvokeCompleted,
  markInvokeFailed,
  markInvokeStarted,
} from './frontendRuntimeProfiler';

declare global {
  interface Window {
    __PT_GATEWAY_BASE__?: string;
  }
}

// #region debug-point A-D:foundation-launch-context
function reportFoundationLaunchContextGatewayDebug(
  stage: string,
  data: Record<string, unknown>,
): void {
  if (import.meta.env.VITE_ACCEPTANCE_HARNESS !== '1') return;
  void fetch('http://127.0.0.1:7778/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'foundation-identity-boot',
      runId: 'pre-fix',
      hypothesisId: 'A-D',
      location: 'gateway.ts:invoke',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

export function isBrowserGatewayRuntime(): boolean {
  return typeof window !== 'undefined' && '__PT_GATEWAY_BASE__' in window;
}

export function installBrowserGateway(): void {
  if (typeof window === 'undefined' || '__TAURI_INTERNALS__' in window) return;

  const port = import.meta.env.VITE_GATEWAY_PORT || '3030';
  const GATEWAY = `http://127.0.0.1:${port}`;
  (window as any).__PT_GATEWAY_BASE__ = GATEWAY;
  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args?: Record<string, unknown>) => {
      const startedAt = performance.now();
      const interactionId = markInvokeStarted(cmd, { runtime: 'browser-gateway' });
      const gatewayArgs = args && Object.keys(args).length === 1 && 'input' in args
        ? args.input as Record<string, unknown>
        : args ?? {};
      try {
        if (cmd === 'applets_product_window_launch_context') {
          reportFoundationLaunchContextGatewayDebug('gateway-request-started', {
            command: cmd,
          });
        }
        const res = await fetch(GATEWAY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd, args: gatewayArgs }),
        });
        if (cmd === 'applets_product_window_launch_context') {
          reportFoundationLaunchContextGatewayDebug('gateway-response-received', {
            command: cmd,
            durationMs: Math.round(performance.now() - startedAt),
            ok: res.ok,
            status: res.status,
          });
        }
        if (!res.ok) throw new Error(`Gateway ${res.status}: ${await res.text()}`);
        const result = await res.json();
        if (cmd === 'applets_product_window_launch_context') {
          reportFoundationLaunchContextGatewayDebug('gateway-json-complete', {
            command: cmd,
            durationMs: Math.round(performance.now() - startedAt),
          });
        }
        markInvokeCompleted(cmd, performance.now() - startedAt, {
          interactionId,
          runtime: 'browser-gateway',
        });
        return result;
      } catch (error) {
        markInvokeFailed(cmd, performance.now() - startedAt, {
          interactionId,
          runtime: 'browser-gateway',
          error: error instanceof Error ? error.message : String(error),
        });
        if (cmd === 'applets_product_window_launch_context') {
          reportFoundationLaunchContextGatewayDebug('gateway-request-rejected', {
            command: cmd,
            durationMs: Math.round(performance.now() - startedAt),
            errorType: error instanceof Error ? error.name : typeof error,
          });
        }
        throw error;
      }
    },
    transformCallback: (callback?: (response: unknown) => void) => {
      const id = crypto.randomUUID();
      if (callback) (window as any)[`_${id}`] = callback;
      return id;
    },
    convertFileSrc: (path: string) => path,
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  };
}
