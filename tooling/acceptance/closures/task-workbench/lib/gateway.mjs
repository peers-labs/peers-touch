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

function safeParse(value) {
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

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

  // ── Agent memory candidate gate (O08) ────────────────────────────────────
  async agentMemoryList(agentId, status) {
    const r = await this.cmd('agent_memory_list', { agent_id: agentId, status });
    return this.decode(r)?.items ?? [];
  }

  // status: 2 = confirmed, 3 = rejected (MemoryStatus proto enum).
  async agentMemoryReview(memoryId, agentId, status) {
    const r = await this.cmd('agent_memory_review', {
      memory_id: memoryId,
      agent_id: agentId,
      status,
    });
    return this.decode(r)?.item ?? null;
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

  // ── Device-held browser sessions (TW-D6) ────────────────────────────────
  async browserHostInfo() {
    const r = await this.cmd('browser_host_info', {});
    return r.data;
  }

  async browserSessionCreate(sessionId) {
    const r = await this.cmd('browser_session_create', { session_id: sessionId });
    return r.data;
  }

  async browserSessionListWorkers() {
    const r = await this.cmd('browser_session_list', {});
    return r.data ?? [];
  }

  async browserNavigate(sessionId, tabId, url) {
    const r = await this.cmd('browser_navigate', {
      session_id: sessionId,
      tab_id: tabId,
      url,
    });
    return r.data;
  }

  async browserInspect(sessionId) {
    const r = await this.cmd('browser_inspect', { session_id: sessionId });
    return r.data;
  }

  async browserSnapshot(sessionId, tabId) {
    const r = await this.cmd('browser_snapshot', {
      session_id: sessionId,
      tab_id: tabId,
    });
    return r.data;
  }

  async browserFill(sessionId, tabId, elementRef, value) {
    const r = await this.cmd('browser_fill', {
      session_id: sessionId,
      tab_id: tabId,
      element_ref: elementRef,
      value,
    });
    return r.data;
  }

  async browserSubmit(sessionId, tabId, elementRef) {
    const r = await this.cmd('browser_submit', {
      session_id: sessionId,
      tab_id: tabId,
      element_ref: elementRef,
    });
    return r.data;
  }

  async browserScreenshot(sessionId, tabId) {
    const r = await this.cmd('browser_screenshot', {
      session_id: sessionId,
      tab_id: tabId,
    });
    return r.data;
  }

  async browserTakeover(sessionId) {
    const r = await this.cmd('browser_takeover', { session_id: sessionId });
    return r.data;
  }

  async browserRelease(sessionId) {
    const r = await this.cmd('browser_release', { session_id: sessionId });
    return r.data;
  }

  async browserRemove(sessionId) {
    const r = await this.cmd('browser_remove', { session_id: sessionId });
    return r.data;
  }

  async browserStationCreate(input) {
    const r = await this.proto('agent_browser_session_create', 'CreateBrowserSession', input);
    return r.session ?? null;
  }

  // Worker metadata reporting; the response is a raw prost byte array, which
  // the closure only needs to succeed (Station truth is read back via list).
  // Tabs arrive as worker camelCase meta and must be mapped to the Station
  // proxy's snake_case contract.
  async browserStationUpdate(input) {
    const payload = { ...input };
    if (Array.isArray(input.tabs)) {
      payload.tabs = input.tabs.map((tab) => ({
        tab_id: tab.tabId ?? tab.tab_id,
        generation: tab.generation,
        url: tab.url,
        title: tab.title,
      }));
    }
    return this.cmd('agent_browser_session_update', payload);
  }

  async browserStationList(conversationId) {
    const r = await this.proto('agent_browser_session_list', 'ListBrowserSessions', {
      conversation_id: conversationId,
    });
    return r.sessions ?? [];
  }

  async browserStationRemove(sessionId) {
    return this.proto('agent_browser_session_remove', 'RemoveBrowserSession', {
      session_id: sessionId,
    });
  }

  // Station-authoritative turn trace (JSON status string).
  async turnTrace(turnId) {
    const r = await this.cmd('agent_turn_trace_get', { turn_id: turnId });
    return this.decode(r)?.entry ?? this.decode(r);
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

  // Same as proto() for arms that return AppResult<Vec<u8>> serialized as a
  // raw JSON byte array (capability authority catalog/bindings/readiness).
  async protoBytes(name, schemaName, input = {}) {
    const { decodeProtoBytes } = await import('./proto.mjs');
    const r = await this.cmd(name, input);
    if (!Array.isArray(r?.data)) {
      throw new GatewayError(name, { message: 'expected raw byte array payload' });
    }
    return decodeProtoBytes(r.data, schemaName);
  }

  // ── Actor-device engine bootstrap (headless onboarding) ─────────────────
  // Password gateway login binds only the Station JWT. The GUI post-login
  // flow additionally activates the actor-device messaging engine; headless
  // harnesses must run the same activation before the capability supervisor
  // can register a device capability session.
  async deviceEngineActivate() {
    const r = await this.cmd('agent_device_engine_activate');
    return r?.data ?? null;
  }

  async executorSupervisorStart() {
    const r = await this.cmd('agent_client_executor_supervisor_start');
    return this.decode(r);
  }

  async capabilitySessions() {
    const r = await this.cmd('agent_capability_sessions');
    return this.decode(r)?.sessions ?? [];
  }

  // ── Capability authority (raw prost byte arms) ──────────────────────────
  async capabilityManifests(sourceKinds = []) {
    const r = await this.protoBytes(
      'agent_capability_manifest_list',
      'ListCapabilityManifests',
      { source_kinds: sourceKinds },
    );
    return r.manifests ?? [];
  }

  async capabilityBindings(agentId) {
    const r = await this.protoBytes(
      'agent_capability_binding_list',
      'ListAgentCapabilityBindings',
      { agent_id: agentId },
    );
    return r.bindings ?? [];
  }

  async capabilityBindingUpsert(binding, expectedRevision = 0, idempotencyKey = crypto.randomUUID()) {
    const r = await this.protoBytes(
      'agent_capability_binding_upsert',
      'UpsertAgentCapabilityBinding',
      { binding, idempotency_key: idempotencyKey, expected_binding_revision: expectedRevision },
    );
    return r.binding ?? null;
  }

  // Tombstones one binding revision (the Station-correct way to disable: an
  // upsert UPDATE needs the exact current revision and grows a new revision;
  // DELETE tombstones the row and removes the capability from snapshots).
  async capabilityBindingDelete(bindingId, expectedRevision, reason = 'headless acceptance scope switch') {
    const r = await this.protoBytes('agent_capability_binding_delete', 'UpsertAgentCapabilityBinding', {
      binding_id: bindingId,
      expected_binding_revision: expectedRevision,
      idempotency_key: crypto.randomUUID(),
      reason,
    });
    return r.binding ?? null;
  }

  // Converges to exactly ONE live binding row per capability with the wanted
  // enabled/policy state. Station upsert forbids updating with
  // expected_revision=0, and multiple live rows for one capability break the
  // single-row invariant; so every existing live row is tombstoned first and
  // a fresh rev1 row is created.
  async convergeBinding(agentId, capabilityId, { enabled, policy = 1, agentVersion }) {
    const rows = await this.capabilityBindings(agentId);
    const existing = rows.filter((b) => b.capability_id === capabilityId);
    for (const row of existing) {
      await this.capabilityBindingDelete(row.binding_id, Number(row.revision));
    }
    const created = await this.capabilityBindingUpsert({
      agent_id: agentId,
      capability_id: capabilityId,
      capability_version: '1',
      enabled,
      approval_policy: policy,
      expected_agent_version: agentVersion,
    });
    return created;
  }

  // Converges the GLOBAL tool-binding scope to exactly one execution family.
  // Station forbids mixing desktop-device and workspace-sandbox families in a
  // single turn (mixed execution targets), and multiple live rows per
  // capability break readiness; so a closure first tombstones every live tool
  // binding and then creates only the wanted set.
  static TOOL_CAPABILITY_IDS = [
    'clipboard.read', 'clipboard.write',
    'filesystem.read', 'filesystem.list', 'filesystem.write', 'filesystem.edit',
    'shell.execute', 'shell.allowlist',
    'workspace.sandbox.filesystem.read', 'workspace.sandbox.filesystem.list',
    'workspace.sandbox.filesystem.write', 'workspace.sandbox.filesystem.edit',
    'workspace.sandbox.shell.execute', 'workspace.sandbox.shell.allowlist',
  ];

  async convergeToolScope(agentId, enabledIds, { policy = 1, agentVersion } = {}) {
    const wanted = new Set(enabledIds);
    const rows = await this.capabilityBindings(agentId);
    for (const row of rows) {
      if (Gateway.TOOL_CAPABILITY_IDS.includes(row.capability_id)) {
        await this.capabilityBindingDelete(row.binding_id, Number(row.revision));
      }
    }
    const created = [];
    for (const capabilityId of enabledIds) {
      created.push(await this.capabilityBindingUpsert({
        agent_id: agentId,
        capability_id: capabilityId,
        capability_version: '1',
        enabled: true,
        approval_policy: policy,
        expected_agent_version: agentVersion,
      }));
    }
    return created;
  }

  async capabilityReadiness(agentId, { clientCapabilitySessionId, providerId, modelId } = {}) {
    const input = { agent_id: agentId };
    if (clientCapabilitySessionId) {
      input.client_capability_session_id = clientCapabilitySessionId;
    }
    // Readiness resolves a runtime admission for the EXACT provider/model the
    // turn will use; agents without a pinned default require both explicitly.
    if (providerId && modelId) {
      input.provider_id = providerId;
      input.model_id = modelId;
    }
    const r = await this.protoBytes(
      'agent_capability_readiness',
      'GetCapabilityReadiness',
      input,
    );
    return r.snapshot ?? null;
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
    // The Rust input requires device_id to be present even though
    // WORKSPACE_SANDBOX sessions must send it empty (Station rejects a
    // non-empty device on sandbox rows).
    return this.proto('agent_terminal_session_create', 'CreateTerminalSession', {
      device_id: '',
      ...input,
    });
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

  // ── WORKSPACE_SANDBOX allocation + Station-owned PTY (WE-S6) ─────────────
  async resolveActiveSandboxes() {
    const r = await this.proto('agent_sandbox_resolve_active', 'ResolveActiveSandboxes', {});
    return r.sandboxes ?? [];
  }

  async sandboxPtyWrite(sessionId, data, { b64 = false } = {}) {
    // The Rust write input is camelCase (sessionId/dataB64).
    const r = await this.cmd('agent_sandbox_pty_write', {
      sessionId,
      dataB64: b64 ? data : Buffer.from(data, 'utf8').toString('base64'),
    });
    return r.data;
  }

  async sandboxPtyRead(sessionId, cursor = 0, maxBytes = 65536) {
    // The Rust read input is also camelCase.
    return this.proto('agent_sandbox_pty_read', 'SandboxPtyRead', {
      sessionId,
      cursor,
      maxBytes: maxBytes,
    });
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

  async artifactFeedbackSubmit(input) {
    return this.proto('agent_task_artifact_feedback_submit', 'SubmitArtifactFeedback', input);
  }

  async artifactFeedbackList(artifactId) {
    const r = await this.proto('agent_task_artifact_feedback_list', 'ListArtifactFeedback', {
      artifact_id: artifactId,
    });
    return r.feedback ?? [];
  }

  // Uploads raw bytes through the SAME OSS agent-attachment admission the GUI
  // composer uses (mime override is authoritative for the text-inline gate).
  // Returns the canonical attachment ref ({ attachment_id, object_ref, ... }).
  async uploadAgentAttachment({ filename, mimeType, bytes, conversationId }) {
    const r = await this.cmd('oss_upload_agent_attachment_bytes', {
      filename,
      mime_type: mimeType,
      bytes: Array.from(bytes),
      conversation_id: conversationId,
    });
    return this.decode(r);
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
  async runTurn(body, { coldRetries = 2, timeoutMs = 90_000, onFrame = null } = {}) {
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
        const trace = await this.#readSse(response.body, controller, onFrame);
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

  async #readSse(stream, controller, onFrame = null) {
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
      if (typeof onFrame === 'function') onFrame(payload);
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

  // Drives a governed multi-iteration tool turn. MANUAL policy parks the turn
  // after every tool_approval_required frame: the initial SSE closes and the
  // Station continuation worker resumes execution once the decision is
  // submitted, with subsequent frames surfacing on /agent/turn/events. This
  // driver therefore (1) streams the turn, (2) invokes decide(frame) for each
  // approval and submits the returned intent, (3) re-anchors a replay stream
  // at the last observed sequence and keeps going until a terminal frame.
  //
  // decide(frame) => { approved, answer?, expectedRevision? } | null (null
  // leaves the approval parked and terminates the observation).
  async runGovernedTurn(body, { decide, timeoutMs = 300_000 } = {}) {
    const calls = [];
    const approvals = [];
    const decisions = [];
    const results = [];
    const frames = [];
    let terminal = null;
    let turnId = null;
    let continuationText = '';

    const ingest = async (frame) => {
      frames.push(frame);
      if (frame.turnId) turnId = frame.turnId;
      const event = frame._event ?? frame.type ?? frame.stage;
      if (event === 'text' || frame._event === 'text' || frame.type === 'text') {
        continuationText += frame.text ?? frame.delta ?? frame.content ?? '';
      }
      if (event === 'tool_call') {
        calls.push({
          toolCallId: frame.toolCallId,
          toolName: frame.toolName,
          arguments: safeParse(frame.arguments) ?? frame.arguments,
          seq: frame.seq,
        });
      } else if (event === 'tool_result') {
        const raw = frame.result ?? frame.content ?? '';
        results.push({
          toolCallId: frame.toolCallId,
          raw,
          parsed: safeParse(raw),
          seq: frame.seq,
        });
      } else if (event === 'tool_approval_required') {
        approvals.push(frame);
        const intent = typeof decide === 'function'
          ? await decide(frame, { calls, results, approvals })
          : { approved: true };
        if (!intent) return;
        const decisionId = crypto.randomUUID();
        const response = await this.cmd('agent_submit_tool_decision', {
          approval_id: frame.approvalId,
          tool_call_id: frame.toolCallId,
          decision_id: decisionId,
          expected_revision: Number(
            intent.expectedRevision ?? frame.decisionRevision ?? 0,
          ),
          approved: intent.approved !== false,
          idempotency_key: decisionId,
          answer: intent.answer ?? '',
        });
        const status = this.decode(response);
        decisions.push(status);
      } else if (
        frame.type === 'done'
        || frame.type === 'error'
        || /turn_completed|turn_failed|turn_interrupted/.test(String(frame.stage))
      ) {
        terminal = frame;
      }
    };

    const initial = await this.runTurn(body, {
      timeoutMs,
      onFrame: (frame) => {
        void ingest(frame);
      },
    });
    if (initial.done) terminal = initial.done;
    if (initial.error && !terminal) {
      return {
        ok: false,
        transportError: initial.error,
        turnId,
        calls,
        approvals,
        decisions,
        results,
        frames,
        terminal,
      };
    }

    // Follow parked continuations until terminal. The replay stream is live
    // (SafeRead): it catches up past afterSequence and then tracks the run.
    let lastSeq = frames.reduce((max, frame) => Math.max(max, Number(frame.seq ?? 0)), 0);
    let guard = 0;
    while (!terminal && guard < 8) {
      guard += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let sawNewFrame = false;
      try {
        const response = await fetch(`${this.baseUrl}/agent/turn/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: body.conversation_id,
            turn_id: turnId,
            afterSequence: lastSeq,
          }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new GatewayError('agent/turn/events', { message: `HTTP ${response.status}` });
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let index;
          while ((index = buffer.indexOf('\n\n')) >= 0) {
            const chunk = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            let dataLine = null;
            for (const line of chunk.split('\n')) {
              if (line.startsWith('data:')) dataLine = line.slice(5).trimStart();
            }
            if (dataLine === null) continue;
            let payload;
            try {
              payload = JSON.parse(dataLine);
            } catch {
              continue;
            }
            if (Number(payload.seq) > lastSeq) {
              lastSeq = Number(payload.seq);
              sawNewFrame = true;
            }
            await ingest(payload);
            if (terminal) break;
          }
          if (terminal) break;
        }
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
      // If the stream closed without a terminal frame and without new
      // activity, stop rather than spin.
      if (!terminal && !sawNewFrame) break;
    }

    const terminalStage = terminal?.stage
      ?? (terminal?.type === 'error' ? 'error' : null)
      ?? (terminal?.type === 'done' ? terminal.stage : null);
    // Final assistant text can arrive on the initial stream or on a
    // continuation stream after the last tool result.
    const text = `${initial.text ?? ''}${continuationText}`;
    return {
      ok: !!terminal && terminal.type !== 'error'
        && !/turn_failed|turn_interrupted/.test(String(terminalStage)),
      turnId,
      terminalStage,
      text,
      calls,
      approvals,
      decisions,
      results,
      frames,
      terminal,
    };
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
