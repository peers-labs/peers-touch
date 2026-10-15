const HOSTS = new Set(['codex', 'cursor', 'trae']);

const EVENTS = new Map([
  ['SessionStart', 'SESSION_START'],
  ['sessionStart', 'SESSION_START'],
  ['UserPromptSubmit', 'BEFORE_PROMPT'],
  ['beforeSubmitPrompt', 'BEFORE_PROMPT'],
  ['PreToolUse', 'PRE_TOOL_USE'],
  ['preToolUse', 'PRE_TOOL_USE'],
  ['PostToolUse', 'POST_TOOL_USE'],
  ['postToolUse', 'POST_TOOL_USE'],
  ['PostToolUseFailure', 'POST_TOOL_FAILURE'],
  ['postToolUseFailure', 'POST_TOOL_FAILURE'],
  ['Stop', 'STOP'],
  ['stop', 'STOP'],
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim())
    : [];
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean))];
}

export function normalizeHostPayload(raw, options = {}) {
  const payload = isObject(raw) ? raw : {};
  const toolInput = isObject(payload.tool_input)
    ? payload.tool_input
    : isObject(payload.toolInput)
      ? payload.toolInput
      : isObject(payload.arguments)
        ? payload.arguments
        : {};
  const host = firstString(options.host, payload.host);
  const hostEvent = firstString(
    options.event,
    payload.hook_event_name,
    payload.hookEventName,
    payload.event,
  );
  const event = EVENTS.get(hostEvent);
  if (!HOSTS.has(host) || event === undefined) {
    return {
      valid: false,
      code: 'HOOK_PAYLOAD_INVALID',
      host,
      hostEvent,
    };
  }

  const workspaceRoots = uniqueStrings([
    ...stringArray(options.workspaceRoots),
    ...stringArray(payload.workspace_roots),
    ...stringArray(payload.workspaceRoots),
  ]);
  const explicitTaskRoot = firstString(payload.task_root);
  const repositoryWorkingDirectory = firstString(
    payload.repo_working_dir,
    payload.repoWorkingDir,
  );
  const payloadWorkingDirectory = firstString(payload.cwd);
  const installationRoot = firstString(options.installationRoot);
  const toolWorkingDirectory = firstString(
    toolInput.working_directory,
    toolInput.workingDirectory,
    toolInput.workdir,
    toolInput.cwd,
    payloadWorkingDirectory,
    repositoryWorkingDirectory,
    installationRoot,
  );

  return {
    valid: true,
    host,
    event,
    hostEvent,
    executionRootHints: uniqueStrings([
      explicitTaskRoot,
      ...(workspaceRoots.length === 1 ? workspaceRoots : []),
      repositoryWorkingDirectory,
      payloadWorkingDirectory,
      ...(workspaceRoots.length <= 1 ? [installationRoot] : []),
    ]),
    workspaceRoots,
    explicitTaskRoot,
    repositoryWorkingDirectory,
    toolWorkingDirectory,
    willEditFilepaths: uniqueStrings([
      ...stringArray(payload.will_edit_filepaths),
      ...stringArray(payload.willEditFilepaths),
    ]),
  };
}

function renderCursorResponse(result, event) {
  if (result.action === 'CONTEXT') {
    return event === 'SESSION_START'
      ? { additional_context: result.additionalContext }
      : { continue: true, additional_context: result.additionalContext };
  }
  if (result.action === 'ALLOW' && event === 'PRE_TOOL_USE') {
    return {
      permission: 'allow',
      ...(result.additionalContext
        ? { additional_context: result.additionalContext }
        : {}),
    };
  }
  return {};
}

function renderClaudeCompatibleResponse(result, hostEvent) {
  if (result.action === 'CONTEXT') {
    return {
      hookSpecificOutput: {
        hookEventName: hostEvent,
        additionalContext: result.additionalContext,
      },
    };
  }
  if (
    result.action === 'ALLOW' &&
    hostEvent === 'PreToolUse' &&
    result.additionalContext
  ) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Project guidance is available.',
        additionalContext: result.additionalContext,
      },
    };
  }
  return {};
}

export function renderHostResponse(host, result, normalized) {
  if (host === 'cursor') {
    return renderCursorResponse(result, normalized.event);
  }
  return renderClaudeCompatibleResponse(result, normalized.hostEvent);
}

export function renderHostFailure() {
  return {};
}
