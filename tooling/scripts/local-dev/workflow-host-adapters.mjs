import {
  projectHostBindingIdentity,
} from './workflow-binding-projection.mjs';

const HOSTS = new Set(['codex', 'cursor', 'trae']);

const EVENT_ALIASES = new Map([
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
  ['SubagentStart', 'SUBAGENT_START'],
  ['SubagentStop', 'SUBAGENT_STOP'],
  ['PreCompact', 'PRE_COMPACT'],
  ['PostCompact', 'POST_COMPACT'],
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
  return [
    ...new Set(
      values
        .filter((value) => typeof value === 'string' && value.trim())
        .map((value) => value.trim()),
    ),
  ];
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
  const event = EVENT_ALIASES.get(hostEvent);
  if (!HOSTS.has(host) || event === undefined) {
    return {
      valid: false,
      code: 'HOOK_PAYLOAD_INVALID',
      host,
      hostEvent,
    };
  }

  const bindingIdentity = projectHostBindingIdentity(host, payload);
  const workspaceRoots = uniqueStrings([
    ...stringArray(options.workspaceRoots),
    ...stringArray(payload.workspace_roots),
    ...stringArray(payload.workspaceRoots),
  ]);
  const explicitTaskRoot = firstString(payload.task_root);
  const activeEditorPath = firstString(payload.active_editor_path);
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
    bindingIdentity,
    actionId: firstString(
      payload.tool_use_id,
      payload.toolUseId,
      payload.tool_call_id,
      payload.toolCallId,
    ),
    executionRootHints: uniqueStrings([
      explicitTaskRoot,
      ...(workspaceRoots.length === 1 ? workspaceRoots : []),
      repositoryWorkingDirectory,
      payloadWorkingDirectory,
      ...(workspaceRoots.length <= 1 ? [installationRoot] : []),
    ]),
    workspaceRoots,
    explicitTaskRoot,
    activeEditorPath,
    bootstrapRoot: firstString(options.bootstrapRoot),
    repositoryWorkingDirectory,
    toolWorkingDirectory,
    toolName: firstString(
      payload.tool_name,
      payload.toolName,
      payload.name,
    ),
    toolInput,
    command: firstString(
      payload.command,
      toolInput.command,
      toolInput.cmd,
      toolInput.script,
    ),
    willEditFilepaths: uniqueStrings([
      ...stringArray(payload.will_edit_filepaths),
      ...stringArray(payload.willEditFilepaths),
    ]),
    lastAssistantMessage: firstString(
      payload.last_assistant_message,
      payload.lastAssistantMessage,
      payload.assistant_message,
      payload.assistantMessage,
    ),
    transcriptPath: firstString(
      payload.transcript_path,
      payload.transcriptPath,
    ),
    stopHookActive:
      payload.stop_hook_active === true || payload.stopHookActive === true,
    loopCount:
      Number.isInteger(payload.loop_count) && payload.loop_count >= 0
        ? payload.loop_count
        : null,
    agentType: firstString(payload.agent_type),
    childResult: firstString(payload.result),
  };
}

function message(result) {
  return `${result.code}: ${result.reason}`;
}

function renderCursorResponse(result, event) {
  if (result.action === 'CONTEXT') {
    return event === 'SESSION_START'
      ? { additional_context: result.additionalContext }
      : { continue: true };
  }
  if (result.action === 'DENY') {
    if (event === 'SESSION_START') {
      return { additional_context: message(result) };
    }
    if (event === 'BEFORE_PROMPT') {
      return {
        continue: false,
        user_message: message(result),
      };
    }
    return {
      permission: 'deny',
      user_message: message(result),
      agent_message: message(result),
    };
  }
  if (result.action === 'CONTINUE') {
    return { followup_message: result.followupMessage ?? message(result) };
  }
  if (event === 'PRE_TOOL_USE') {
    return {
      permission: 'allow',
      ...(result.additionalContext
        ? { additional_context: result.additionalContext }
        : {}),
    };
  }
  if (event === 'BEFORE_PROMPT') return { continue: true };
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
  if (result.action === 'DENY') {
    if (hostEvent === 'SessionStart' || hostEvent === 'UserPromptSubmit') {
      return {
        hookSpecificOutput: {
          hookEventName: hostEvent,
          additionalContext: message(result),
        },
      };
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: message(result),
      },
    };
  }
  if (result.action === 'CONTINUE') {
    return {
      decision: 'block',
      reason: result.followupMessage ?? message(result),
    };
  }
  if (hostEvent === 'PreToolUse' && result.additionalContext) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason:
          'Architecture and operational knowledge context loaded.',
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

export function renderHostFailure(host, hostEvent, error) {
  const result = {
    action: hostEvent === 'Stop' || hostEvent === 'stop' ? 'CONTINUE' : 'DENY',
    code: 'PT_EW_PLUGIN_FAILURE',
    reason: error?.message ?? String(error),
  };
  if (
    hostEvent === 'SessionStart' ||
    hostEvent === 'sessionStart' ||
    hostEvent === 'UserPromptSubmit'
  ) {
    result.action = 'CONTEXT';
    result.additionalContext = message(result);
  }
  return renderHostResponse(host, result, {
    event: EVENT_ALIASES.get(hostEvent),
    hostEvent,
  });
}
