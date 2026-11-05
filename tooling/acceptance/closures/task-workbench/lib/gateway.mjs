// Headless Desktop-native gateway client for task-workbench acceptance.
//
// It drives the REAL Tauri desktop binary purely over its loopback HTTP
// gateway (tiny_http, default :3030): no webview, no X11/VNC, no Playwright.
// The desktop process owns the Station bearer token after `access_submit_login`
// and binds it gateway-side, so this client needs no token header.
//
// Wire envelope (see apps/desktop/src-tauri/src/interface/http_gateway/mod.rs):
//   POST /  { "cmd": "<tauri-command>", "args": { "input": <payload> } }
//   agent turn streaming is POST /agent/turn/stream (SSE).

const GATE_TYPE_AUTH_LOGIN = 2;

export class GatewayError extends Error {
  constructor(cmd, error) {
    super(`${cmd}: ${error?.message ?? 'unknown error'}`);
    this.name = 'GatewayError';
    this.code = error?.code ?? null;
    this.details = error?.details ?? null;
  }
}

export class Gateway {
  constructor(baseUrl = process.env.PEERS_GATEWAY_URL ?? 'http://127.0.0.1:3030') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async cmd(name, input = {}, { expectOk = true } = {}) {
    const response = await fetch(`${this.baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: name, args: { input } }),
    });
    let payload;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new GatewayError(name, { message: `non-json HTTP ${response.status}: ${cause.message}` });
    }
    if (expectOk && !payload.ok) {
      throw new GatewayError(name, payload.error);
    }
    return payload;
  }

  // Runs the Station access-gate password login the same way the kernel does
  // (access_start -> choose auth.login gate -> submit_login). Resolves with
  // the authenticated decision response.
  async login(account, password) {
    const start = await this.cmd('access_start');
    const decision = start?.data?.decision;
    if (!decision?.attemptId) {
      throw new GatewayError('access_start', { message: 'missing decision.attemptId' });
    }
    const gate = (decision.gates ?? []).find((g) => g.gateId === 'auth.login');
    if (!gate) {
      throw new GatewayError('access_start', { message: 'no auth.login gate in decision' });
    }
    const submit = await this.cmd('access_submit_login', {
      attempt_id: decision.attemptId,
      gate_id: gate.gateId,
      gate_type: GATE_TYPE_AUTH_LOGIN,
      action_id: gate.actionId || 'auth.password',
      schema_revision: gate.schemaRevision ?? 0,
      schema_digest: gate.schemaDigest ?? '',
      submission_id: crypto.randomUUID(),
      account,
      password,
    });
    return submit.data;
  }

  async currentSession() {
    const r = await this.cmd('acceptance_current_session');
    // This command returns its fields as a JSON-encoded status string.
    const status = r?.data?.status;
    return typeof status === 'string' ? JSON.parse(status) : (r?.data ?? null);
  }

  async agentsList() {
    const r = await this.cmd('agents_list');
    return r.data;
  }

  // SSE POST to /agent/turn/stream. Calls onEvent(rawDataString) for each SSE
  // `data:` frame; resolves when the stream closes. Does not interpret frames.
  async turnStream(requestBody, { onEvent = () => {}, signal, timeoutMs = 180_000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const response = await fetch(`${this.baseUrl}/agent/turn/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new GatewayError('agent/turn/stream', { message: `HTTP ${response.status}` });
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of frame.split('\n')) {
            if (line.startsWith('data:')) onEvent(line.slice(5).trimStart());
          }
        }
      }
      return true;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function envActor() {
  return {
    account: process.env.PT_ACTOR_ACCOUNT ?? 'alice@p.t',
    password: process.env.PT_ACTOR_PASSWORD ?? '1',
  };
}
