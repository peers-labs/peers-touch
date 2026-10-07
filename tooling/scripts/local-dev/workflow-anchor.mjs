import { createHash } from 'node:crypto';
import {
  closeSync,
  fstatSync,
  openSync,
  readSync,
} from 'node:fs';
import path from 'node:path';

function taskProgress(planPackage) {
  const tasks = planPackage?.manifest?.tasks ?? [];
  const completed = tasks.filter((task) => task.status === 'done').length;
  const total = tasks.length;
  return {
    completed,
    total,
    percentage: total === 0 ? 0 : Math.round((10000 * completed) / total) / 100,
    current: tasks.find((task) => task.status === 'in_progress') ?? null,
  };
}

function field(value) {
  return value === null || value === undefined || value === '' ? 'none' : value;
}

function anchorBody(binding, inspection) {
  const progress = taskProgress(inspection.planPackage);
  const planId = inspection.binding?.planId ?? inspection.declaration?.planId;
  const taskId =
    inspection.currentTask?.id ?? inspection.declaration?.taskId ?? null;
  const state =
    inspection.session?.state?.state ??
    inspection.planPackage?.manifest?.status ??
    inspection.status;
  const active = inspection.status === 'READY' &&
    inspection.tracked &&
    inspection.planPackage?.manifest?.status === 'active' &&
    inspection.currentTask?.status === 'in_progress';
  const blocked = inspection.status === 'HARD_BLOCK';
  const status = active ? 'ACTIVE' : blocked ? 'BLOCKED' : 'TERMINAL';
  const next = active
    ? `continue ${taskId} to its durable closure`
    : blocked
      ? `repair ${inspection.code} through its owning workflow command`
      : 'none; the bound Plan is terminal';

  return [
    '**Context Anchor**',
    `- **Main task**: ${field(taskId)}`,
    `- **Execution mandate**: ${status}`,
    `- **Autonomous horizon**: ${active ? 'bound Plan terminal state or typed hard boundary' : status}`,
    `- **Execution horizon**: ${next}`,
    `- **Current closure / state**: ${field(state)}`,
    `- **Worktree / branch / workspace**: ${path.basename(binding.executionRoot)} (<repo-root>) / ${field(inspection.branch)} / ${binding.workspaceId}`,
    `- **Main session**: ${field(inspection.declaration?.workflowOwner?.host)}:${field(inspection.declaration?.workflowOwner?.rootChatId)}`,
    `- **Initial HEAD**: ${field(inspection.planPackage?.manifest?.binding?.initialHead)}`,
    `- **Expected / verified HEAD**: ${field(inspection.head)}`,
    `- **Progress**: ${progress.completed}/${progress.total} Task closures (${progress.percentage}%)`,
    '- **Completed delta**: machine-derived from current Plan manifest',
    `- **Next Progress Slice**: ${next}`,
    '- **Projected progress after Next**: owner-derived at the next durable transition',
    '- **Expected progress effect**: one Task closure or one typed hard boundary',
    '- **Plan Run queue**: dependency-ready frontier owned by the scheduler',
    `- **Remaining frontier**: ${active ? 'non-terminal' : 'none or blocked'}`,
    '- **Execution mode / lanes**: host-neutral serial kernel admission',
    '- **Conflict controls**: immutable conversation root plus declaration claims',
    '- **Critical path / ETA**: unknown',
    `- **Evidence**: role=${binding.role}; binding=${binding.bindingDigest}; root=${binding.rootBindingDigest}; workflow=${inspection.status}`,
    `- **Stop conditions / decisions**: ${blocked ? `${inspection.code}: ${inspection.message}` : status}`,
    `- **Tracking document**: ${field(inspection.binding?.planPath)}`,
  ].join('\n');
}

export function renderWorkflowAnchor(binding, inspection) {
  const body = anchorBody(binding, inspection);
  const digest = createHash('sha256').update(body).digest('hex');
  return {
    status:
      inspection.status === 'HARD_BLOCK'
        ? 'BLOCKED'
        : inspection.planPackage?.manifest?.status ?? inspection.status,
    digest,
    content:
      `\`\`\`markdown\n${body}\n` +
      `<!-- pt-workflow-anchor:${digest} -->\n\`\`\``,
  };
}

function collectStrings(value, output) {
  if (typeof value === 'string') {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, output);
  }
}

function transcriptTail(file, maximumBytes = 1024 * 1024) {
  const descriptor = openSync(file, 'r');
  try {
    const size = fstatSync(descriptor).size;
    const length = Math.min(size, maximumBytes);
    const buffer = Buffer.alloc(length);
    readSync(descriptor, buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } finally {
    closeSync(descriptor);
  }
}

function transcriptStrings(file) {
  const source = transcriptTail(file);
  const values = [source];
  for (const line of source.split('\n').slice(-200)) {
    if (!line.trim()) continue;
    try {
      collectStrings(JSON.parse(line), values);
    } catch {
      // A host may use a plain-text transcript. The raw tail remains evidence.
    }
  }
  return values;
}

export function assistantContainsAnchor(event, anchor) {
  if (event.lastAssistantMessage?.includes(anchor.content)) return true;
  if (!event.transcriptPath) return false;
  try {
    return transcriptStrings(event.transcriptPath).some((value) =>
      value.includes(anchor.content),
    );
  } catch {
    return false;
  }
}
