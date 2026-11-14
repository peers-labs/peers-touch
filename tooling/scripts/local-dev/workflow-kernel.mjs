import path from 'node:path';

import {
  buildPreEditContext,
  DEFAULT_REGISTRY_PATH,
  renderPreEditContext,
} from '../architecture/module-governance.mjs';
import { resolveProjectRoot } from './workflow-state-inspector.mjs';
import {
  bindSessionWorktree,
  detectWorktreeDrift,
  readSessionBinding,
  resolveInvocationWorktree,
} from './worktree-session-binding.mjs';

// Only tools that mutate files or execute commands can perform work in the
// wrong worktree. Pure read tools stay unguarded so diagnosis is never blocked.
// The adapter derives these facts; raw tool name/input never reach the kernel.
function isMutatingTool(event) {
  if (event.event !== 'PRE_TOOL_USE') return false;
  if (event.mutatingTool === true) return true;
  // Fall back to declared edit paths when the tool name is absent.
  return (event.willEditFilepaths ?? []).length > 0;
}

function mutatingTargetPaths(event) {
  return Array.isArray(event.mutationFilepaths)
    ? event.mutationFilepaths
    : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function resolveHint(candidate) {
  return candidate ? resolveProjectRoot(candidate) : null;
}

function selectExecutionRoot(event) {
  const explicit = resolveHint(event.explicitTaskRoot);
  if (explicit) return explicit;
  const workspaceRoots = unique(
    (event.workspaceRoots ?? []).map(resolveHint),
  );
  if (workspaceRoots.length === 1) return workspaceRoots[0];
  for (const candidate of [
    event.explicitToolWorkingDirectory,
    ...(event.executionRootHints ?? []),
  ]) {
    const root = resolveHint(candidate);
    if (root && (workspaceRoots.length === 0 || workspaceRoots.includes(root))) {
      return root;
    }
  }
  return null;
}

// Events whose prior live context was replaced (session start, prompt entry,
// context compaction). They must re-assert the workflow as guidance instead of
// emitting a bare tool allowance, so recovery boundaries cannot silently skip it.
const CONTEXT_EVENTS = new Set([
  'SESSION_START',
  'BEFORE_PROMPT',
  'PRE_COMPACT',
  'POST_COMPACT',
]);

function contextHeader(root) {
  return [
    'Peers-Touch project guidance',
    `workspace=${path.basename(root)}`,
    'workflow=docs/global/workflow.md',
    'knowledge=docs/knowledge/README.md',
    'skills=tooling/skills',
    'The project workflow skills are mandatory unless the user explicitly declares an opt-out.',
    'Hooks cannot hard-block by design; advisory delivery does not make the workflow optional.',
    'Operation permissions remain at concrete runtime and delivery entrypoints.',
  ].join('\n');
}

function compactionGuidance(root) {
  return [
    contextHeader(root),
    '',
    'Context was compacted, so the live workflow state was replaced. Before continuing work:',
    '1. Re-enter via the pt-god-view skill to re-classify intent and current stage.',
    '2. Resume the owning workflow skill (for example pt-dev-workflow) instead of treating',
    '   the frozen plan, task summary, or handoff notes as proof the workflow already ran.',
    '3. If the user has explicitly declared the workflow skipped for this scope, record that',
    '   declaration and proceed; otherwise the workflow is mandatory.',
  ].join('\n');
}

function targetPaths(event, root) {
  return unique(event.willEditFilepaths ?? [])
    .map((value) =>
      path.isAbsolute(value)
        ? path.resolve(value)
        : path.resolve(event.toolWorkingDirectory ?? root, value),
    )
    .filter((value) => {
      const relative = path.relative(root, value);
      return (
        relative !== '' &&
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
      );
    })
    .map((value) => path.relative(root, value).split(path.sep).join('/'));
}

async function guidanceContext(event, root, options) {
  const paths = targetPaths(event, root);
  if (paths.length === 0) return contextHeader(root);
  try {
    const build = options.buildPreEditContext ?? buildPreEditContext;
    const render = options.renderPreEditContext ?? renderPreEditContext;
    const receipt = await build({
      repoRoot: root,
      registryPath: options.registryPath ?? DEFAULT_REGISTRY_PATH,
      targets: paths,
    });
    return `${contextHeader(root)}\n\n${render(receipt)}`;
  } catch {
    return contextHeader(root);
  }
}

export async function evaluateWorkflowEvent(event, options = {}) {
  if (!event?.valid) {
    return {
      action: 'NOOP',
      code: event?.code ?? 'HOOK_PAYLOAD_IGNORED',
      reason: 'Unknown or malformed Hook input is ignored.',
      executionRoot: null,
      additionalContext: null,
    };
  }

  // SessionStart: silently bind the session to its single worktree. Logging
  // and binding only; never block startup on an ambiguous workspace.
  if (event.event === 'SESSION_START' && options.worktreeStateRoot) {
    bindSessionWorktree({
      stateRoot: options.worktreeStateRoot,
      workspaceRoots: event.workspaceRoots ?? [],
      source: 'session-start',
    });
  }

  // PreToolUse: hard-block mutating tools that escape the bound worktree.
  if (
    event.event === 'PRE_TOOL_USE'
    && options.worktreeStateRoot
    && isMutatingTool(event)
  ) {
    const binding = readSessionBinding(options.worktreeStateRoot);
    if (binding) {
      const invocationRoot = resolveInvocationWorktree({
        toolWorkingDirectory:
          event.toolWorkingDirectory
          ?? event.repositoryWorkingDirectory
          ?? event.installationRoot,
        targetFilepaths: [
          ...(event.willEditFilepaths ?? []),
          ...mutatingTargetPaths(event),
        ],
        installationRoot: event.installationRoot,
      });
      const drift = detectWorktreeDrift({ binding, invocationRoot });
      if (drift) {
        const invoked = drift.invokedRoot.join(', ');
        return {
          action: 'DENY',
          code: 'WORKTREE_DRIFT_BLOCKED',
          denyReason:
            `Worktree drift blocked: this session is bound to `
            + `${drift.boundName} (${drift.boundRoot}), but the tool targets `
            + `${invoked}. Do not create or switch worktrees unless the user `
            + `explicitly instructs it; rebind through the machine-dev session `
            + 'entrypoint only.',
          executionRoot: null,
          additionalContext: null,
        };
      }
    }
  }

  const executionRoot = selectExecutionRoot(event);
  if (executionRoot === null) {
    return {
      action: 'ALLOW',
      code: 'WORKSPACE_CONTEXT_UNRESOLVED',
      reason: 'No unambiguous project root was available for optional context.',
      executionRoot: null,
      additionalContext: null,
    };
  }
  const installationRoot = resolveHint(event.installationRoot);
  if (installationRoot && executionRoot !== installationRoot) {
    return {
      action: 'NOOP',
      code: 'HOOK_INSTALLATION_ROOT_MISMATCH',
      reason: 'A project Hook cannot inject context for a sibling worktree.',
      executionRoot: null,
      additionalContext: null,
    };
  }
  // Compaction replaced the live context: inject an explicit workflow re-entry
  // directive rather than the ordinary pre-edit guidance so recovery cannot
  // silently continue without re-running the workflow.
  if (event.event === 'PRE_COMPACT' || event.event === 'POST_COMPACT') {
    return {
      action: 'CONTEXT',
      code: 'WORKFLOW_REENTRY_AFTER_COMPACTION',
      reason: 'Context was compacted; the workflow must be re-entered unless the user opted out.',
      executionRoot,
      additionalContext: compactionGuidance(executionRoot),
    };
  }
  const additionalContext = await guidanceContext(
    event,
    executionRoot,
    options,
  );
  return {
    action: CONTEXT_EVENTS.has(event.event) ? 'CONTEXT' : 'ALLOW',
    code: 'PROJECT_GUIDANCE_AVAILABLE',
    reason: 'Current project workflow and relevant knowledge are available.',
    executionRoot,
    additionalContext,
  };
}
