import { createHash } from 'node:crypto';
import path from 'node:path';

export const WORKFLOW_BINDING_PROJECTION_KIND =
  'peers-touch-workflow-binding-projection';

const HOSTS = new Set(['trae', 'cursor', 'codex']);
const ROLES = new Set(['OWNER', 'WORKER', 'REVIEWER']);
const CHILD_STATES = new Set(['ASSIGNED', 'LEASED', 'TERMINAL']);
const SHA256 = /^[0-9a-f]{64}$/;

function fail(code, message, detail = {}) {
  throw Object.assign(new Error(message), { code, detail });
}

function exactString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function identityHash(host, kind, value) {
  if (!HOSTS.has(host) || !['root', 'execution'].includes(kind) || !value) {
    fail('WORKFLOW_BINDING_IDENTITY_INVALID', 'Host binding identity is invalid');
  }
  return createHash('sha256')
    .update(`${host}\0${kind}\0${value}`)
    .digest('hex');
}

export function projectHostBindingIdentity(host, raw) {
  const payload =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (!HOSTS.has(host)) {
    fail('WORKFLOW_BINDING_IDENTITY_INVALID', 'Workflow host is invalid');
  }

  let rootChatId;
  let executionSessionId;
  if (host === 'trae') {
    rootChatId = exactString(payload.chat_session_id);
    executionSessionId = exactString(payload.session_id);
  } else if (host === 'cursor') {
    rootChatId = exactString(payload.conversation_id);
    executionSessionId = rootChatId;
  } else {
    rootChatId = exactString(payload.session_id);
    executionSessionId = rootChatId;
  }

  return {
    host,
    rootChatId,
    executionSessionId,
    rootChatHash:
      rootChatId === null ? null : identityHash(host, 'root', rootChatId),
    executionSessionHash:
      executionSessionId === null
        ? null
        : identityHash(host, 'execution', executionSessionId),
    assignmentId: exactString(payload.workflow_assignment_id),
  };
}

function canonicalRoots(values) {
  const roots = [];
  for (const value of values ?? []) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const root = path.resolve(value);
    if (!roots.includes(root)) roots.push(root);
  }
  return roots.sort();
}

export function validateWorkflowBindingProjection(projection) {
  const expectedKeys = [
    'assignmentDigest',
    'bindingDigest',
    'childState',
    'executionRoot',
    'host',
    'kind',
    'parentBindingDigest',
    'released',
    'role',
    'rootBindingDigest',
    'subjectRoots',
    'targetRoots',
    'toolRoot',
    'workflowSessionId',
    'workspaceId',
  ];
  if (
    projection === null ||
    typeof projection !== 'object' ||
    Array.isArray(projection) ||
    Object.keys(projection).sort().join(',') !== expectedKeys.join(',') ||
    projection.kind !== WORKFLOW_BINDING_PROJECTION_KIND ||
    !HOSTS.has(projection.host) ||
    !ROLES.has(projection.role) ||
    !SHA256.test(projection.bindingDigest) ||
    !SHA256.test(projection.rootBindingDigest) ||
    typeof projection.executionRoot !== 'string' ||
    !path.isAbsolute(projection.executionRoot) ||
    !/^[0-9a-f]{16}$/.test(projection.workspaceId) ||
    typeof projection.released !== 'boolean' ||
    !Array.isArray(projection.subjectRoots) ||
    !Array.isArray(projection.targetRoots)
  ) {
    fail(
      'WORKFLOW_BINDING_PROJECTION_INVALID',
      'Workflow binding projection shape is invalid',
    );
  }
  const owner = projection.role === 'OWNER';
  if (
    (owner &&
      (projection.bindingDigest !== projection.rootBindingDigest ||
        projection.parentBindingDigest !== null ||
        projection.assignmentDigest !== null ||
        projection.workflowSessionId !== null ||
        projection.childState !== null)) ||
    (!owner &&
      (!SHA256.test(projection.parentBindingDigest ?? '') ||
        !SHA256.test(projection.assignmentDigest ?? '') ||
        typeof projection.workflowSessionId !== 'string' ||
        !projection.workflowSessionId ||
        !CHILD_STATES.has(projection.childState)))
  ) {
    fail(
      'WORKFLOW_BINDING_PROJECTION_INVALID',
      'Workflow binding projection lineage is invalid',
    );
  }
  if (
    (projection.toolRoot !== null && !path.isAbsolute(projection.toolRoot)) ||
    [...projection.subjectRoots, ...projection.targetRoots].some(
      (root) => typeof root !== 'string' || !path.isAbsolute(root),
    )
  ) {
    fail(
      'WORKFLOW_BINDING_PROJECTION_INVALID',
      'Workflow binding projection roots are invalid',
    );
  }
  return projection;
}

export function projectWorkflowBinding({
  binding,
  assignment = null,
  released = false,
  terminal = false,
  now = new Date(),
  subjectRoots = [],
  toolRoot = null,
  targetRoots = [],
}) {
  const child = binding.role !== 'OWNER';
  const instant = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(instant.getTime())) {
    fail('WORKFLOW_BINDING_CLOCK_INVALID', 'Workflow binding clock is invalid');
  }
  if (
    child &&
    (assignment === null ||
      assignment.digest !== binding.assignmentDigest ||
      assignment.rootBindingDigest !== binding.rootBindingDigest ||
      assignment.parentBindingDigest !== binding.parentBindingDigest)
  ) {
    fail(
      'WORKFLOW_BINDING_LINEAGE_INVALID',
      'Child binding assignment does not match its lineage',
    );
  }
  const childState = !child
    ? null
    : terminal
      ? 'TERMINAL'
      : instant.getTime() > Date.parse(assignment.leaseUntil)
        ? 'ASSIGNED'
        : 'LEASED';
  return validateWorkflowBindingProjection({
    kind: WORKFLOW_BINDING_PROJECTION_KIND,
    host: binding.host,
    role: binding.role,
    bindingDigest: binding.digest,
    rootBindingDigest:
      binding.role === 'OWNER' ? binding.digest : binding.rootBindingDigest,
    parentBindingDigest:
      binding.role === 'OWNER' ? null : binding.parentBindingDigest,
    assignmentDigest:
      binding.role === 'OWNER' ? null : binding.assignmentDigest,
    workflowSessionId:
      binding.role === 'OWNER' ? null : binding.workflowSessionId,
    executionRoot: binding.executionRoot,
    workspaceId: binding.workspaceId,
    subjectRoots: canonicalRoots(subjectRoots),
    toolRoot: toolRoot === null ? null : path.resolve(toolRoot),
    targetRoots: canonicalRoots(targetRoots),
    released,
    childState,
  });
}

export function projectWorkflowEventRoots(
  projection,
  {
    subjectRoots = [],
    toolRoot = null,
    targetRoots = [],
  } = {},
) {
  validateWorkflowBindingProjection(projection);
  return validateWorkflowBindingProjection({
    ...projection,
    subjectRoots: canonicalRoots(subjectRoots),
    toolRoot: toolRoot === null ? null : path.resolve(toolRoot),
    targetRoots: canonicalRoots(targetRoots),
  });
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function selectOwnerExecutionRoot(
  event,
  {
    resolveProjectRoot,
    targetPaths = [],
  },
) {
  if (typeof resolveProjectRoot !== 'function') {
    fail(
      'WORKTREE_SELECTION_REQUIRED',
      'Project-root resolver is unavailable',
    );
  }
  const workspaceRoots = unique(
    (event.workspaceRoots ?? [])
      .map((candidate) => resolveProjectRoot(candidate)),
  );
  const explicitTaskRoot = resolveProjectRoot(event.explicitTaskRoot);
  const activeEditorRoot = resolveProjectRoot(event.activeEditorPath);
  if (explicitTaskRoot !== null) {
    if (
      workspaceRoots.length > 0 &&
      !workspaceRoots.includes(explicitTaskRoot)
    ) {
      fail(
        'WORKTREE_SELECTION_REQUIRED',
        'Explicit task root is not a declared workspace root',
      );
    }
    if (
      activeEditorRoot !== null &&
      activeEditorRoot !== explicitTaskRoot
    ) {
      fail(
        'WORKTREE_SELECTION_REQUIRED',
        'Active editor and explicit task root identify different worktrees',
      );
    }
    return explicitTaskRoot;
  }

  const targetRoots = unique(
    targetPaths.map((candidate) => resolveProjectRoot(candidate)),
  );
  if (workspaceRoots.length > 1) {
    const matchingTargets = targetRoots.filter((candidate) =>
      workspaceRoots.includes(candidate));
    if (matchingTargets.length === 1) {
      if (
        activeEditorRoot !== null &&
        activeEditorRoot !== matchingTargets[0]
      ) {
        fail(
          'WORKTREE_SELECTION_REQUIRED',
          'Active editor and mutation target identify different worktrees',
        );
      }
      return matchingTargets[0];
    }
    fail(
      'WORKTREE_SELECTION_REQUIRED',
      'Multi-root workspace requires one explicit task or mutation root',
      {
        workspaceRootCount: workspaceRoots.length,
        mutationRootCount: matchingTargets.length,
      },
    );
  }
  if (workspaceRoots.length === 1) {
    if (
      activeEditorRoot !== null &&
      activeEditorRoot !== workspaceRoots[0]
    ) {
      fail(
        'WORKTREE_SELECTION_REQUIRED',
        'Active editor and declared workspace root identify different worktrees',
      );
    }
    return workspaceRoots[0];
  }

  const inferred = unique([
    resolveProjectRoot(event.repositoryWorkingDirectory),
    resolveProjectRoot(event.toolWorkingDirectory),
    ...targetRoots,
  ]);
  if (inferred.length === 1) return inferred[0];
  if (inferred.length === 0) return null;
  fail(
    'WORKTREE_SELECTION_REQUIRED',
    'Host event resolves more than one candidate worktree',
    { candidateCount: inferred.length },
  );
}
