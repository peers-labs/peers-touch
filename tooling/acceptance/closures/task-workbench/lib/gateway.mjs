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
    return this.decode(r);
  }

  // Most gateway commands return their payload as a JSON-encoded `status`
  // string. decode() unwraps that and tolerates already-object responses.
  decode(result) {
    const status = result?.data?.status;
    if (typeof status === 'string') {
      try {
        return JSON.parse(status);
      } catch {
        return null;
      }
    }
    return result?.data ?? null;
  }

  async providerGet(providerId) {
    const r = await this.cmd('provider_get', { id: providerId });
    return this.decode(r)?.provider ?? null;
  }

  // Idempotently ensures a custom OpenAI-compatible provider exists. Returns
  // the provider record (existing or newly created).
  async ensureProvider({ id, name, baseUrl, protocol = 'openai' }) {
    try {
      const existing = await this.providerGet(id);
      if (existing) return existing;
    } catch {
      // Fall through to create when the provider is absent.
    }
    const r = await this.cmd('provider_create', {
      id,
      name,
      description: 'task-workbench acceptance provider',
      logo: '',
      key_vaults: '{"api_key":"ollama"}',
      config_json: JSON.stringify({ base_url: baseUrl, protocol }),
    });
    return this.decode(r)?.provider ?? null;
  }

  // Ensures a model row exists under a provider, keyed by the upstream
  // provider model id (e.g. "qwen-tw"). Ollama needs no real secret but the
  // Station credential lease still requires a credential row to exist.
  async ensureProviderModel(providerId, { id, displayName, contextWindow = 32768 }) {
    const provider = await this.providerGet(providerId);
    const credentialConfigured = provider?.credential_status === 'configured';
    if (!credentialConfigured) {
      await this.cmd('provider_update', {
        id: providerId,
        enabled: true,
        version: Number(provider?.version ?? 1),
        key_vaults: '{"api_key":"ollama"}',
        config_json: JSON.stringify({
          base_url: provider?.base_url,
          protocol: provider?.protocol ?? 'openai',
        }),
      });
    }
    const models = provider?.models ?? [];
    const present = models.some((m) => (m.model_id ?? m.id) === id);
    if (present) return { created: false };
    await this.cmd('model_add', {
      provider_id: providerId,
      data: {
        id,
        display_name: displayName ?? id,
        enabled: true,
        context_window: contextWindow,
        capabilities: {
          flags: { streaming: true, 'text-input': true, 'text-output': true },
        },
      },
    });
    return { created: true };
  }

  // Enables/disables a provider while preserving its base URL and credential.
  // Station returns the incremented revision; callers always re-read the
  // provider first so a stale expected_version never causes a 409.
  async providerSetEnabled(providerId, enabled) {
    const provider = await this.providerGet(providerId);
    const r = await this.cmd('provider_update', {
      id: providerId,
      enabled,
      version: Number(provider?.version ?? 1),
      key_vaults: '{"api_key":"ollama"}',
      config_json: JSON.stringify({
        base_url: provider?.base_url,
        protocol: provider?.protocol ?? 'openai',
      }),
    });
    return this.decode(r)?.provider ?? null;
  }

  async conversationCreate(agentId, { providerId, modelName, title }) {
    const r = await this.cmd('agent_conversation_create', {
      agent_id: agentId,
      title,
      provider_id: providerId,
      model_name: modelName,
    });
    return this.decode(r)?.conversation ?? null;
  }

  async conversationList(agentId, { status = 'active', pageSize = 100 } = {}) {
    const r = await this.cmd('agent_conversation_list', {
      agent_id: agentId,
      status,
      page: 1,
      page_size: pageSize,
    });
    const decoded = this.decode(r);
    return decoded?.conversations ?? decoded?.items ?? [];
  }

  async conversationMessages(conversationId, { limit = 50, afterSeq, beforeSeq } = {}) {
    const input = { conversation_id: conversationId, limit };
    if (Number.isInteger(afterSeq)) input.after_seq = afterSeq;
    if (Number.isInteger(beforeSeq)) input.before_seq = beforeSeq;
    const r = await this.cmd('agent_conversation_messages', input);
    return this.decode(r)?.messages ?? [];
  }

  // Calls a gateway arm that returns a prost response as { proto_b64 } and
  // decodes it using the named schema in lib/proto.mjs.
  async proto(name, schemaName, input = {}) {
    const { decodeProtoB64 } = await import('./proto.mjs');
    const r = await this.cmd(name, input);
    const b64 = r?.data?.proto_b64;
    if (typeof b64 !== 'string') {
      throw new GatewayError(name, { message: 'missing proto_b64 in response' });
    }
    return decodeProtoB64(b64, schemaName);
  }

  // ── Device-held terminal sessions (TW-D5, JSON) ──────────────────────────
  async terminalDefaultWorkspace(deviceId) {
    const r = await this.cmd('terminal_default_workspace', { device_id: deviceId });
    return this.decode(r)?.workspaceRoot ?? null;
  }

  async terminalCreate(workspaceRoot, {
    command, args = [], cwd, cols = 100, rows = 30, allowedRoots = [],
  }) {
    const r = await this.cmd('terminal_session_create', {
      command, args, cwd, workspace_root: workspaceRoot, allowed_roots: allowedRoots,
      cols, rows,
    });
    return r.data;
  }

  async terminalWrite(sessionId, utf8) {
    const dataB64 = Buffer.from(utf8, 'utf8').toString('base64');
    await this.cmd('terminal_session_write', { session_id: sessionId, data_b64: dataB64 });
    return true;
  }

  async terminalResize(sessionId, cols, rows) {
    return this.cmd('terminal_session_resize', { session_id: sessionId, cols, rows });
  }

  async terminalKill(sessionId) {
    const r = await this.cmd('terminal_session_kill', { session_id: sessionId });
    return r.data;
  }

  async terminalRemove(sessionId) {
    return this.cmd('terminal_session_remove', { session_id: sessionId });
  }

  async terminalList() {
    const r = await this.cmd('terminal_session_list');
    return Array.isArray(r.data) ? r.data : [];
  }

  async terminalRead(sessionId, cursor = 0) {
    const r = await this.cmd('terminal_session_read', { session_id: sessionId, cursor });
    return r.data;
  }

  // ── Station terminal metadata + sandbox PTY (proto) ──────────────────────
  async stationTerminalCreate(input) {
    return this.proto('agent_terminal_session_create', 'CreateTerminalSession', input);
  }

  async stationTerminalUpdate(input) {
    return this.proto('agent_terminal_session_update', 'UpdateTerminalSession', input);
  }

  async stationTerminalList(conversationId) {
    const r = await this.proto('agent_terminal_session_list', 'ListTerminalSessions', {
      conversation_id: conversationId,
    });
    return r.sessions ?? [];
  }

  async stationTerminalReconcile(input) {
    const r = await this.proto('agent_terminal_session_reconcile', 'ReconcileTerminalSessions', input);
    return r.sessions ?? [];
  }

  async stationTerminalRemove(sessionId) {
    return this.proto('agent_terminal_session_remove', 'RemoveTerminalSession', {
      session_id: sessionId,
    });
  }

  async resolveActiveSandboxes() {
    const r = await this.proto('agent_sandbox_resolve_active', 'ResolveActiveSandboxes', {});
    return r.sandboxes ?? [];
  }

  // ── Logical artifact versions (TW-D3 / O04, proto) ───────────────────────
  async artifactClaimVersion(input) {
    return this.proto('agent_task_artifact_claim_version', 'ClaimArtifactVersion', input);
  }

  async artifactList(conversationId) {
    const r = await this.proto('agent_task_artifact_list', 'ListTaskArtifacts', {
      conversation_id: conversationId,
    });
    return r.artifacts ?? [];
  }

  async artifactVersions(artifactId) {
    const r = await this.proto('agent_task_artifact_versions', 'ListArtifactVersions', {
      artifact_id: artifactId,
    });
    return r.versions ?? [];
  }

  async artifactBody(versionId) {
    return this.proto('agent_task_artifact_body_get', 'GetArtifactVersionBody', {
      version_id: versionId,
    });
  }

  async artifactRecordCheck(input) {
    return this.proto('agent_task_artifact_check_record', 'RecordArtifactCheck', input);
  }

  async artifactChecks(artifactId) {
    const r = await this.proto('agent_task_artifact_check_list', 'ListArtifactChecks', {
      artifact_id: artifactId,
    });
    return r.checks ?? [];
  }

  async artifactAccept(input) {
    return this.proto('agent_task_artifact_accept', 'AcceptArtifactVersion', input);
  }

  async artifactAcceptances(artifactId) {
    const r = await this.proto('agent_task_artifact_acceptance_list', 'ListArtifactAcceptances', {
      artifact_id: artifactId,
    });
    return r.acceptances ?? [];
  }

  // High-level real turn driver. Sends a Station-shaped turn body to the
  // native SSE proxy and returns a structured trace.
  //
  // The verified libp2p HTTP/2 route session is cold after idle; its first
  // request can race re-establishment and surface HTTP 502 ("Station HTTP/2
  // is not ready"). That is a transport warm-up condition, not a turn result,
  // so the call is retried a bounded number of times before failing.
  async runTurn(body, { coldRetries = 2, timeoutMs = 90_000 } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt <= coldRetries; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}/agent/turn/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (response.status === 502) {
          lastError = new Error(`cold HTTP/2 route 502 (attempt ${attempt + 1})`);
          continue;
        }
        if (!response.ok || !response.body) {
          throw new GatewayError('agent/turn/stream', {
            message: `HTTP ${response.status}`,
          });
        }
        const trace = await this.#readSse(response.body, controller);
        clearTimeout(timer);
        return { ok: true, ...trace };
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timer);
      }
    }
    return { ok: false, error: lastError?.message ?? 'turn failed', frames: [] };
  }

  async #readSse(stream, controller) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const frames = [];
    const stages = [];
    let text = '';
    let done = null;
    let error = null;
    let admission = null;

    const ingest = (frame) => {
      let eventName = null;
      let dataLine = null;
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLine = line.slice(5).trimStart();
      }
      if (dataLine === null) return;
      let payload = null;
      try {
        payload = JSON.parse(dataLine);
      } catch {
        return;
      }
      if (eventName) payload._event = eventName;
      frames.push(payload);
      if (payload.stage) stages.push(payload.stage);
      const delta = payload.text ?? payload.delta ?? payload.content;
      if (typeof delta === 'string' && (payload.type === 'text' || payload._event === 'text')) {
        text += delta;
      }
      if (payload.type === 'text' && typeof delta !== 'string') {
        // Some encoders nest text under delta.text.
        const nested = payload.delta?.text ?? payload.content?.text;
        if (typeof nested === 'string') text += nested;
      }
      if (payload.type === 'done') done = payload;
      if (payload.type === 'error') error = payload;
      if (payload._event === 'admission_replayed' || payload.type === 'admission_replayed') {
        admission = payload.admission ?? payload;
      }
    };

    for (;;) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        ingest(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
      }
      if (controller.signal.aborted) break;
    }
    if (buffer.trim()) ingest(buffer.trim());
    return { frames, stages, text, done, error, admission };
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
