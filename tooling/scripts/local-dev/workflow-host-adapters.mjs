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
  // Compaction is a recovery boundary: without a mapping these events were
  // normalized as invalid and silently dropped, so no re-entry guidance fired
  // after the summary replaced the live context.
  ['PreCompact', 'PRE_COMPACT'],
  ['preCompact', 'PRE_COMPACT'],
  ['PostCompact', 'POST_COMPACT'],
  ['postCompact', 'POST_COMPACT'],
  ['SubagentStart', 'SUBAGENT_START'],
  ['subagentStart', 'SUBAGENT_START'],
  ['SubagentStop', 'SUBAGENT_STOP'],
  ['subagentStop', 'SUBAGENT_STOP'],
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

// Only tools that mutate files or execute commands can perform work in the
// wrong worktree; pure read tools stay unguarded so diagnosis is never blocked.
const MUTATING_TOOL_NAME_PATTERN =
  /(write|edit|delete|shell|bash|terminal|command|create|patch|install|apply)/i;

function collectMutationFilepaths(toolInput) {
  if (!isObject(toolInput)) return [];
  const paths = [];
  for (const key of ['file_path', 'filePath', 'path', 'notebook_path', 'filename']) {
    if (typeof toolInput[key] === 'string') paths.push(toolInput[key]);
  }
  for (const key of ['file_paths', 'filePaths', 'paths']) {
    if (Array.isArray(toolInput[key])) {
      paths.push(...toolInput[key].filter((value) => typeof value === 'string'));
    }
  }
  return paths;
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
  const toolName = firstString(
    payload.tool_name,
    payload.toolName,
    payload.name,
  );
  // The kernel must not receive raw tool internals. Expose only the minimum
  // derived facts the worktree guard needs: whether the tool mutates, its name
  // for observation, and target paths. Raw tool input stays private.
  const mutatingTool =
    typeof toolName === 'string'
    && MUTATING_TOOL_NAME_PATTERN.test(toolName);
  const mutationFilepaths = collectMutationFilepaths(toolInput);
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
  const explicitToolWorkingDirectory = firstString(
    toolInput.working_directory,
    toolInput.workingDirectory,
    toolInput.workdir,
    toolInput.cwd,
    payloadWorkingDirectory,
  );
  const toolWorkingDirectory = firstString(
    explicitToolWorkingDirectory,
    repositoryWorkingDirectory,
    installationRoot,
  );

  return {
    valid: true,
    host,
    event,
    hostEvent,
    mutatingTool,
    mutationFilepaths,
    toolName,
    executionRootHints: uniqueStrings([
      explicitTaskRoot,
      ...(workspaceRoots.length === 1 ? workspaceRoots : []),
      explicitToolWorkingDirectory,
      ...(workspaceRoots.length <= 1
        ? [repositoryWorkingDirectory, installationRoot]
        : []),
    ]),
    workspaceRoots,
    installationRoot,
    explicitTaskRoot,
    explicitToolWorkingDirectory,
    repositoryWorkingDirectory,
    toolWorkingDirectory,
    willEditFilepaths: uniqueStrings([
      ...stringArray(payload.will_edit_filepaths),
      ...stringArray(payload.willEditFilepaths),
      ...(event === 'PRE_TOOL_USE'
        ? [firstString(toolInput.file_path, toolInput.filePath)]
        : []),
    ]),
  };
}

function renderCursorResponse(result, event) {
  if (result.action === 'CONTEXT') {
    return event === 'SESSION_START'
      ? { additional_context: result.additionalContext }
      : { continue: true, additional_context: result.additionalContext };
  }
  if (result.action === 'DENY' && event === 'PRE_TOOL_USE') {
    return {
      permission: 'deny',
      reason: result.denyReason,
    };
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
    result.action === 'DENY' &&
    hostEvent === 'PreToolUse'
  ) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: result.denyReason,
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
