import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

import {
  assistantContainsAnchor,
  renderWorkflowAnchor,
} from './workflow-anchor.mjs';
import {
  releaseWorkflowOwner,
  resolveEventWorkflowBinding,
  terminalizeWorkflowChild,
  writeWorkflowAnchorReceipt,
} from './workflow-binding-store.mjs';
import {
  projectWorkflowEventRoots,
} from './workflow-binding-projection.mjs';
import {
  inspectStopContext,
  inspectWorkflowContext,
  resolveExecutionRoot,
  resolveProjectRoot,
} from './workflow-state-inspector.mjs';
import {
  recordWorkflowAction,
  startWorkflowActionHeartbeat,
} from './workflow-action-store.mjs';
import { classifyToolIntent } from './workflow-tool-intent.mjs';
import {
  buildPreEditContext,
  DEFAULT_REGISTRY_PATH,
  renderPreEditContext,
} from '../architecture/module-governance.mjs';

const STOPPABLE_SESSION_STATES = new Set([
  'BLOCKED',
  'FAILED',
  'STALE',
  'CANCELLED',
]);

function repositoryPath(root, cwd, value) {
  const absolute = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(cwd ?? root, value);
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith('../') ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  return relative;
}

function claimContains(claim, target) {
  const prefix = claim.pathPrefix.replace(/\/+$/, '');
  return (
    claim.mode === 'exclusive-write' &&
    (prefix === '.' || target === prefix || target.startsWith(`${prefix}/`))
  );
}

function absoluteTarget(event, binding, target) {
  return path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(
      event.toolWorkingDirectory ?? binding.executionRoot,
      target,
    );
}

function canonicalCandidate(candidate) {
  const absolute = path.resolve(candidate);
  let existing = absolute;
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return absolute;
    existing = parent;
  }
  return path.join(realpathSync(existing), path.relative(existing, absolute));
}

function pathIsInside(root, candidate) {
  const relative = path.relative(root, canonicalCandidate(candidate));
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

function shellTargetLooksLikePath(event, binding, target) {
  if (path.isAbsolute(target) || target.startsWith('.') || target.includes('/')) {
    return true;
  }
  return existsSync(absoluteTarget(event, binding, target));
}

function mutationPaths(event, binding, intent) {
  const targets =
    intent.kind === 'WRITE'
      ? intent.targets
      : intent.targets.filter((target) =>
        shellTargetLooksLikePath(event, binding, target));
  return [
    ...(intent.kind === 'WRITE' || !event.toolWorkingDirectory
      ? []
      : [path.resolve(event.toolWorkingDirectory)]),
    ...targets.map((target) => absoluteTarget(event, binding, target)),
  ];
}

async function preEditContext(binding, targets) {
  const registry = path.join(
    binding.executionRoot,
    ...DEFAULT_REGISTRY_PATH.split('/'),
  );
  if (!existsSync(registry)) {
    const governanceRoot = path.join(
      binding.executionRoot,
      'docs',
      'architecture',
      'architecture-module-governance',
    );
    if (existsSync(governanceRoot)) {
      const error = new Error(
        'architecture module registry is required by this repository',
      );
      error.code = 'ARCHITECTURE_REGISTRY_INVALID';
      throw error;
    }
    return null;
  }
  const receipt = await buildPreEditContext({
    repoRoot: binding.executionRoot,
    targets,
  });
  return {
    receipt,
    additionalContext: renderPreEditContext(receipt),
  };
}

function contextText(binding, inspection, enforcementMode) {
  const lines = [
    'PT_WORKFLOW_KERNEL_ACTIVE',
    `enforcement=${enforcementMode}`,
    `executionRoot=${binding?.executionRoot ?? 'pending'}`,
    `workspaceId=${binding?.workspaceId ?? 'pending'}`,
    `bindingRole=${binding?.role ?? 'pending'}`,
    `rootBindingDigest=${binding?.rootBindingDigest ?? 'pending'}`,
    `bindingDigest=${binding?.bindingDigest ?? 'pending'}`,
    binding
      ? `entrySkill=${path.join(binding.executionRoot, 'tooling', 'skills', 'pt-ew', 'SKILL.md')}`
      : 'entrySkill=pending-first-pre-tool-use',
    'The conversation execution root is immutable after the first blockable PreToolUse.',
    'Cross-worktree reads are allowed; cross-worktree writes are denied.',
  ];
  if (inspection?.status === 'READY') {
    lines.push(
      `workflow=${inspection.tracked ? 'TRACKED' : 'UNTRACKED'}`,
      `workItemId=${inspection.declaration.workItemId}`,
      `sessionId=${inspection.declaration.sessionId}`,
    );
    if (inspection.tracked) {
      lines.push(
        `planId=${inspection.binding.planId}`,
        `taskId=${inspection.currentTask.id}`,
        `devState=${inspection.session.state.state}`,
      );
    }
  } else if (inspection) {
    lines.push(
      `workflow=${inspection.code ?? inspection.status}`,
      `workflowReason=${inspection.message ?? inspection.status}`,
    );
  }
  return lines.join('\n');
}

function deny(code, reason, binding = null) {
  return {
    action: 'DENY',
    code,
    reason,
    enforcementMode: 'ENFORCED',
    executionRoot: binding?.executionRoot ?? null,
  };
}

async function resolveBinding(event, options) {
  if (!event.bindingIdentity?.rootChatId) {
    return { mode: 'OBSERVE_ONLY', binding: null };
  }
  const resolver =
    options.resolveEventWorkflowBinding ?? resolveEventWorkflowBinding;
  const root = options.executionRoot ?? resolveExecutionRoot(event);
  const resolved = resolver(event, root, {
    machineRoot: options.machineRoot,
    now: options.now,
  });
  let projection = resolved.projection ?? null;
  if (projection !== null) {
    const intent = (options.classifyToolIntent ?? classifyToolIntent)(event);
    const toolRoot = resolveProjectRoot(event.toolWorkingDirectory);
    const targetRoots = intent.targets
      .map((target) =>
        resolveProjectRoot(absoluteTarget(event, projection, target)))
      .filter(Boolean);
    const hintRoots = (event.executionRootHints ?? [])
      .map((candidate) => resolveProjectRoot(candidate))
      .filter(Boolean);
    projection = projectWorkflowEventRoots(projection, {
      toolRoot,
      targetRoots,
      subjectRoots: [...hintRoots, ...(toolRoot ? [toolRoot] : []), ...targetRoots],
    });
  }
  return {
    ...resolved,
    storedBinding: resolved.binding ?? null,
    binding: projection,
  };
}

async function evaluateWorkflowEventInternal(event, options = {}) {
  if (!event.valid) {
    return deny(
      event.code,
      'Hook payload is missing a supported host or event.',
    );
  }
  const resolved = await resolveBinding(event, options);
  if (resolved.mode === 'OUTSIDE_PROJECT') return { action: 'NOOP' };
  if (resolved.mode === 'OBSERVE_ONLY') {
    if (event.event === 'SESSION_START' || event.event === 'BEFORE_PROMPT') {
      return {
        action: 'CONTEXT',
        additionalContext:
          'PT_WORKFLOW_KERNEL_OBSERVE_ONLY\n' +
          'The host supplied no stable conversation identifier; this session ' +
          'must not claim workflow enforcement.',
        enforcementMode: 'OBSERVE_ONLY',
        executionRoot: resolveExecutionRoot(event),
      };
    }
    if (event.event === 'PRE_TOOL_USE') {
      const intent = (options.classifyToolIntent ?? classifyToolIntent)(event);
      if (intent.mutating) {
        return {
          action: 'DENY',
          code: 'STABLE_CONVERSATION_ID_REQUIRED',
          reason: 'A stable conversation identifier is required for mutation.',
          enforcementMode: 'OBSERVE_ONLY',
          executionRoot: resolveExecutionRoot(event),
        };
      }
    }
    return {
      action: 'ALLOW',
      code: 'OBSERVE_ONLY',
      reason:
        'The host supplied no stable conversation identifier; enforcement is unavailable.',
      enforcementMode: 'OBSERVE_ONLY',
      executionRoot: resolveExecutionRoot(event),
    };
  }
  if (resolved.mode === 'PREWARM') {
    const root = resolveExecutionRoot(event);
    if (event.event !== 'SESSION_START' && event.event !== 'BEFORE_PROMPT') {
      return {
        action: 'ALLOW',
        enforcementMode: 'PENDING_BINDING',
        executionRoot: root,
      };
    }
    return {
      action: 'CONTEXT',
      additionalContext: contextText(null, null, 'PENDING_BINDING'),
      enforcementMode: 'PENDING_BINDING',
      executionRoot: root,
    };
  }

  const binding = resolved.binding;
  if (
    binding.role !== 'OWNER' &&
    (binding.released || binding.childState !== 'LEASED')
  ) {
    return deny(
      'WORKFLOW_CHILD_BINDING_NOT_LIVE',
      'Assigned child is expired, terminal, or its owner is released.',
      binding,
    );
  }
  const inspect = options.inspectWorkflowContext ?? inspectWorkflowContext;
  if (
    event.event === 'SESSION_START' ||
    event.event === 'BEFORE_PROMPT' ||
    event.event === 'SUBAGENT_START' ||
    event.event === 'PRE_COMPACT' ||
    event.event === 'POST_COMPACT'
  ) {
    const inspection = await inspectStopContext(binding, inspect);
    return {
      action: 'CONTEXT',
      additionalContext: contextText(binding, inspection, 'ENFORCED'),
      enforcementMode: 'ENFORCED',
      executionRoot: binding.executionRoot,
    };
  }

  if (event.event === 'PRE_TOOL_USE') {
    const intent = (options.classifyToolIntent ?? classifyToolIntent)(event);
    if (binding.released && intent.mutating) {
      return deny(
        'WORKFLOW_OWNER_RELEASED',
        'Released OWNER lineage cannot admit a new mutation.',
        binding,
      );
    }
    if (intent.kind === 'DIRECT_RUNTIME_OWNER') {
      return deny(
        'DIRECT_RUNTIME_OWNER_DENIED',
        'Development functional verification must run through make dev-functional-result.',
        binding,
      );
    }
    if (intent.kind === 'SHELL_UNSAFE') {
      return deny(
        intent.ast.code,
        'Dynamic, multiline, or unsupported shell structure cannot be admitted.',
        binding,
      );
    }
    if (intent.kind === 'UNSUPPORTED') {
      return deny(
        'TOOL_INTENT_UNSUPPORTED',
        'The host tool has no registered read/write intent adapter.',
        binding,
      );
    }
    if (!intent.mutating) {
      return {
        action: 'ALLOW',
        enforcementMode: 'ENFORCED',
        executionRoot: binding.executionRoot,
      };
    }

    const paths = mutationPaths(event, binding, intent);
    if (paths.some((candidate) => !pathIsInside(binding.executionRoot, candidate))) {
      return deny(
        'CROSS_WORKTREE_WRITE_DENIED',
        'This conversation may write only inside its immutable execution root.',
        binding,
      );
    }
    if (intent.kind === 'OWNER_CONTROL') {
      return {
        action: 'ALLOW',
        enforcementMode: 'ENFORCED',
        executionRoot: binding.executionRoot,
      };
    }

    const inspection = await inspect(binding);
    if (inspection.status !== 'READY') {
      return deny(inspection.code, inspection.message, binding);
    }
    if (intent.kind === 'WRITE' && intent.targets.length === 0) {
      return deny(
        'TOOL_WRITE_TARGET_UNRESOLVED',
        'The write target cannot be resolved from the tool payload.',
        binding,
      );
    }
    const scopedTargets = intent.targets;
    const relativeTargets = [];
    for (const target of scopedTargets) {
      const relative = repositoryPath(
        binding.executionRoot,
        event.toolWorkingDirectory,
        target,
      );
      if (
        relative === null ||
        !inspection.declaration.sourceClaims.some((claim) =>
          claimContains(claim, relative),
        )
      ) {
        return deny(
          'SOURCE_SCOPE_DENIED',
          `Write target is outside the active declaration: ${target}`,
          binding,
        );
      }
      relativeTargets.push(relative);
    }
    let context;
    try {
      context = await preEditContext(binding, relativeTargets);
    } catch (error) {
      return deny(
        error.code ?? 'PRE_EDIT_CONTEXT_FAILED',
        error.message ?? 'Pre-edit architecture context could not be loaded.',
        binding,
      );
    }
    return {
      action: 'ALLOW',
      enforcementMode: 'ENFORCED',
      executionRoot: binding.executionRoot,
      ...(context === null
        ? {}
        : {
            additionalContext: context.additionalContext,
            contextReceipt: context.receipt,
          }),
    };
  }

  if (event.event === 'POST_TOOL_USE' || event.event === 'POST_TOOL_FAILURE') {
    return {
      action: 'ALLOW',
      enforcementMode: 'ENFORCED',
      executionRoot: binding.executionRoot,
    };
  }

  if (event.event === 'SUBAGENT_STOP') {
    if (binding.role !== 'OWNER') {
      const normalizedResult = String(event.childResult ?? 'PASS').toUpperCase();
      const result = new Set(['PASS', 'FAIL', 'BLOCKED', 'CANCELLED']).has(
        normalizedResult,
      )
        ? normalizedResult
        : 'BLOCKED';
      (options.terminalizeWorkflowChild ?? terminalizeWorkflowChild)(
        resolved.storedBinding,
        result,
        {
          machineRoot: options.machineRoot,
          now: options.now,
        },
      );
    }
    return {
      action: 'ALLOW',
      enforcementMode: 'ENFORCED',
      executionRoot: binding.executionRoot,
    };
  }

  const inspection = await inspectStopContext(binding, inspect);
  if (inspection.status === 'IDLE') {
    return {
      action: 'ALLOW',
      enforcementMode: 'ENFORCED',
      executionRoot: binding.executionRoot,
    };
  }
  const active =
    inspection.status === 'READY' &&
    inspection.tracked &&
    inspection.planPackage.manifest.status === 'active' &&
    inspection.currentTask?.status === 'in_progress' &&
    !STOPPABLE_SESSION_STATES.has(inspection.session.state.state);
  const anchor = renderWorkflowAnchor(binding, inspection);
  (options.writeWorkflowAnchorReceipt ?? writeWorkflowAnchorReceipt)(
    resolved.owner,
    anchor,
    {
    machineRoot: options.machineRoot,
    now: options.now,
    },
  );
  if (active) {
    return {
      action: 'CONTINUE',
      code: 'PLAN_RUN_CONTINUES',
      reason:
        `Continue Plan ${inspection.binding.planId} Task ` +
        `${inspection.currentTask.id}; the Task closure is not durable yet.`,
      followupMessage:
        `Continue the active Plan Run. Do not stop at this internal boundary.\n\n${anchor.content}`,
      enforcementMode: 'ENFORCED',
      executionRoot: binding.executionRoot,
    };
  }
  if (!(options.assistantContainsAnchor ?? assistantContainsAnchor)(event, anchor)) {
    return {
      action: 'CONTINUE',
      code: 'CONTEXT_ANCHOR_REQUIRED',
      reason: 'The final response must include the exact machine-rendered anchor.',
      followupMessage:
        `Return the following exact machine-rendered block before stopping:\n\n${anchor.content}`,
      enforcementMode: 'ENFORCED',
      executionRoot: binding.executionRoot,
    };
  }
  if (binding.role !== 'OWNER') {
    return {
      action: 'ALLOW',
      enforcementMode: 'ENFORCED',
      executionRoot: binding.executionRoot,
    };
  }
  (options.releaseWorkflowOwner ?? releaseWorkflowOwner)(
    resolved.owner,
    anchor.digest,
    {
      machineRoot: options.machineRoot,
      now: options.now,
    },
  );
  return {
    action: 'ALLOW',
    enforcementMode: 'RELEASED',
    executionRoot: binding.executionRoot,
  };
}

function digestProgress(binding, inspection) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        workspaceId: binding.workspaceId,
        workItemId: inspection?.declaration?.workItemId ?? null,
        planId: inspection?.declaration?.planId ?? null,
        taskId: inspection?.declaration?.taskId ?? null,
        sessionId: inspection?.declaration?.sessionId ?? null,
        sessionDigest: inspection?.session?.eventDigest ?? null,
        sessionState: inspection?.session?.state?.state ?? null,
      }),
    )
    .digest('hex');
}

function safeActionTarget(event, binding, intent) {
  const target = intent.targets.find((candidate) =>
    shellTargetLooksLikePath(event, binding, candidate));
  if (!target) return null;
  return repositoryPath(
    binding.executionRoot,
    event.toolWorkingDirectory,
    target,
  );
}

async function reportWorkflowAction(event, result, options) {
  if (
    !['PRE_TOOL_USE', 'POST_TOOL_USE', 'POST_TOOL_FAILURE'].includes(
      event.event,
    ) ||
    !event.bindingIdentity?.rootChatId ||
    !result.executionRoot
  ) {
    return;
  }
  const intent = (options.classifyToolIntent ?? classifyToolIntent)(event);
  if (!intent.mutating && result.action !== 'DENY') return;
  const resolved = await resolveBinding(event, options);
  const binding = resolved.binding;
  if (binding === null || resolved.mode !== 'ENFORCED') return;
  if (
    binding.released ||
    (binding.role !== 'OWNER' && binding.childState !== 'LEASED')
  ) {
    return;
  }
  let inspection = null;
  try {
    inspection = await (
      options.inspectWorkflowContext ?? inspectWorkflowContext
    )(binding);
  } catch {
    // Admission already completed. Missing activity evidence is projected later.
  }
  const writer =
    options.recordWorkflowAction === undefined
      ? recordWorkflowAction
      : options.recordWorkflowAction;
  if (writer === false) return;
  const postEvent =
    event.event === 'POST_TOOL_USE' || event.event === 'POST_TOOL_FAILURE';
  const receiptEvent =
    result.action === 'DENY' || postEvent ? 'FINISHED' : 'STARTED';
  const receiptResult =
    result.action === 'DENY'
      ? 'DENIED'
      : event.event === 'POST_TOOL_FAILURE'
        ? 'FAIL'
        : postEvent
          ? 'PASS'
          : 'RUNNING';
  const recordInput = {
    machineRoot: options.machineRoot,
    host: binding.host,
    rootBindingDigest: binding.rootBindingDigest,
    actor: {
      host: binding.host,
      bindingDigest: binding.bindingDigest,
      role: binding.role,
      rootBindingDigest: binding.rootBindingDigest,
      parentBindingDigest: binding.parentBindingDigest,
      assignmentDigest: binding.assignmentDigest,
    },
    binding: {
      workspaceId: binding.workspaceId,
      workItemId: inspection?.declaration?.workItemId ?? null,
      planId: inspection?.declaration?.planId ?? null,
      taskId: inspection?.declaration?.taskId ?? null,
      sessionId: inspection?.declaration?.sessionId ?? null,
    },
    actionId: event.actionId ?? undefined,
    event: receiptEvent,
    result: receiptResult,
    operation: {
      family: intent.kind,
      label:
        intent.kind === 'OWNER_CONTROL'
          ? intent.ast.commands[0][1]
          : event.toolName ?? 'tool',
      targetRef: safeActionTarget(event, binding, intent),
    },
    progressStamp: digestProgress(binding, inspection),
    now: options.now,
  };
  try {
    const receipt = writer(recordInput);
    const startHeartbeat =
      options.startWorkflowActionHeartbeat === undefined
        ? startWorkflowActionHeartbeat
        : options.startWorkflowActionHeartbeat;
    if (
      receiptEvent === 'STARTED' &&
      receipt?.actionId &&
      startHeartbeat !== false
    ) {
      startHeartbeat({ ...recordInput, actionId: receipt.actionId });
    }
  } catch {
    // Observability never changes the already-computed admission result.
  }
}

export async function evaluateWorkflowEvent(event, options = {}) {
  const result = await evaluateWorkflowEventInternal(event, options);
  await reportWorkflowAction(event, result, options);
  return result;
}
