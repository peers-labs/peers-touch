import path from 'node:path';

import {
  buildPreEditContext,
  DEFAULT_REGISTRY_PATH,
  renderPreEditContext,
} from '../architecture/module-governance.mjs';
import { resolveProjectRoot } from './workflow-state-inspector.mjs';

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
    event.repositoryWorkingDirectory,
    event.toolWorkingDirectory,
    ...(event.executionRootHints ?? []),
  ]) {
    const root = resolveHint(candidate);
    if (root && (workspaceRoots.length === 0 || workspaceRoots.includes(root))) {
      return root;
    }
  }
  return null;
}

function contextHeader(root) {
  return [
    'Peers-Touch project guidance',
    `workspace=${path.basename(root)}`,
    'workflow=docs/global/workflow.md',
    'knowledge=docs/knowledge/README.md',
    'skills=tooling/skills',
    'Hook context is advisory; operation permissions remain at concrete runtime and delivery entrypoints.',
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
  const additionalContext = await guidanceContext(
    event,
    executionRoot,
    options,
  );
  return {
    action: ['SESSION_START', 'BEFORE_PROMPT'].includes(event.event)
      ? 'CONTEXT'
      : 'ALLOW',
    code: 'PROJECT_GUIDANCE_AVAILABLE',
    reason: 'Current project workflow and relevant knowledge are available.',
    executionRoot,
    additionalContext,
  };
}
