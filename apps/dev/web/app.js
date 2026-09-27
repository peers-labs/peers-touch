const elements = {
  agentCount: document.querySelector('#agent-count'),
  authority: document.querySelector('#authority'),
  blockedCount: document.querySelector('#blocked-count'),
  observedAt: document.querySelector('#observed-at'),
  occupancyBody: document.querySelector('#occupancy-body'),
  planCount: document.querySelector('#plan-count'),
  profileCapacityCount: document.querySelector('#profile-capacity-count'),
  profileCount: document.querySelector('#profile-count'),
  refresh: document.querySelector('#refresh'),
  serverSource: document.querySelector('#server-source'),
  statusMessage: document.querySelector('#status-message'),
  transport: document.querySelector('#transport'),
  worktreeCount: document.querySelector('#worktree-count'),
  worktreeList: document.querySelector('#worktree-list'),
};

let eventSource = null;
let lastSnapshot = null;
let lastSuccessAt = null;
let pollTimer = null;
let pollController = null;
let reconnectTimer = null;
let refreshPending = false;
let eventStreamOpen = false;

function text(value, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function shortId(value) {
  const normalized = text(value);
  return normalized === '-' ? normalized : normalized.slice(0, 8);
}

function formatTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text(value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

function formatAge(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '-';
  if (milliseconds < 60_000) return `${Math.floor(milliseconds / 1000)}s ago`;
  if (milliseconds < 3_600_000) {
    return `${Math.floor(milliseconds / 60_000)}m ago`;
  }
  return `${Math.floor(milliseconds / 3_600_000)}h ago`;
}

function stateClass(value) {
  return text(value, 'unknown').toLowerCase().replaceAll('_', '-');
}

function makeState(state, label = state) {
  const badge = document.createElement('span');
  badge.className = `state state-${stateClass(state)}`;
  badge.dataset.state = stateClass(state);
  const dot = document.createElement('span');
  dot.className = 'state-dot';
  dot.setAttribute('aria-hidden', 'true');
  badge.append(dot, document.createTextNode(text(label)));
  return badge;
}

function appendLines(parent, lines, empty = '-') {
  const visible = lines.filter(Boolean);
  if (visible.length === 0) {
    parent.textContent = empty;
    return parent;
  }
  for (const [index, line] of visible.entries()) {
    const item = document.createElement('span');
    item.className = index === 0 ? 'cell-line' : 'cell-line subtle-line';
    item.textContent = line;
    parent.append(item);
  }
  return parent;
}

function makeProgress(progress) {
  const wrapper = document.createElement('div');
  wrapper.className = 'plan-progress';
  const track = document.createElement('div');
  track.className = 'progress-track';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', 'Plan task closure progress');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.setAttribute('aria-valuenow', String(progress?.percentage ?? 0));
  const fill = document.createElement('span');
  fill.className = 'progress-fill';
  fill.style.width = `${Math.max(0, Math.min(100, progress?.percentage ?? 0))}%`;
  track.append(fill);
  const value = document.createElement('span');
  value.className = 'progress-value';
  if (progress) {
    value.textContent = `${progress.completed}/${progress.total} | ${progress.percentage}%`;
    const projected = progress.nextProgressBoundary;
    if (projected) {
      const next = document.createElement('span');
      next.className = 'progress-next';
      next.textContent = `Next ${projected.completedAfter}/${progress.total} | ${projected.percentageAfter}%`;
      value.append(next);
    }
  } else {
    value.textContent = 'No tracked progress';
  }
  wrapper.append(track, value);
  return wrapper;
}

function makeSegments(items, className, emptyLabel) {
  const row = document.createElement('div');
  row.className = className;
  if (items.length === 0) {
    row.classList.add('segments-empty');
    row.textContent = emptyLabel;
    return row;
  }
  for (const item of items) {
    const segment = document.createElement('span');
    segment.className = `segment segment-${stateClass(item.state)}`;
    segment.dataset.state = stateClass(item.state);
    const marker = document.createElement('span');
    marker.className = 'segment-marker';
    marker.setAttribute('aria-hidden', 'true');
    segment.append(marker, document.createTextNode(item.label ?? item.id));
    row.append(segment);
  }
  return row;
}

function makeDetail(label, value) {
  const item = document.createElement('div');
  item.className = 'detail';
  const key = document.createElement('span');
  key.className = 'detail-label';
  key.textContent = label;
  const body = document.createElement('div');
  body.className = 'detail-value';
  if (value instanceof Node) body.append(value);
  else body.textContent = text(value);
  item.append(key, body);
  return item;
}

function makeFreshness(item) {
  const value = document.createElement('div');
  value.className = 'freshness-value';
  value.append(makeState(item.freshness.state));
  const time = document.createElement('span');
  time.textContent = item.freshness.lastReportedAt
    ? `Reported ${formatTime(item.freshness.lastReportedAt)}`
    : `Checked ${formatTime(item.freshness.checkedAt)}`;
  value.append(time);
  return value;
}

function renderWorktree(item) {
  const workflow = item.workflow ?? {};
  const plan = workflow.plan;
  const task = workflow.task;
  const activity = item.agentActivity ?? { state: 'idle', lastAction: null };
  const band = document.createElement('article');
  band.className = 'worktree-band';
  band.dataset.workspaceId = item.workspaceId;
  band.dataset.workflowVerdict = stateClass(workflow.verdict);
  band.dataset.activityState = stateClass(activity.state);

  const heading = document.createElement('div');
  heading.className = 'worktree-heading';
  const identity = document.createElement('div');
  identity.className = 'worktree-identity';
  const title = document.createElement('h3');
  title.textContent = item.name ?? item.branches[0] ?? 'Unregistered worktree';
  const branch = document.createElement('p');
  branch.textContent = `${item.branches.join(', ') || 'No branch'} | ${shortId(item.workspaceId)}`;
  identity.append(title, branch);
  const states = document.createElement('div');
  states.className = 'worktree-states';
  states.append(
    makeState(workflow.verdict ?? 'SUSPENDED'),
    makeState(item.workState),
    makeState(item.environmentHealth.state),
    makeState(activity.state),
  );
  heading.append(identity, states);

  const stageBlock = document.createElement('div');
  stageBlock.className = 'progress-block';
  const stageLabel = document.createElement('span');
  stageLabel.className = 'block-label';
  stageLabel.textContent = 'Stage';
  stageBlock.append(
    stageLabel,
    makeSegments(workflow.stages ?? [], 'stage-rail', 'No tracked stage'),
  );

  const planBlock = document.createElement('div');
  planBlock.className = 'progress-block';
  const planHeader = document.createElement('div');
  planHeader.className = 'block-heading';
  const planLabel = document.createElement('span');
  planLabel.className = 'block-label';
  planLabel.textContent = plan?.id ?? 'No tracked plan';
  planHeader.append(planLabel);
  if (plan) planHeader.append(makeState(plan.status));
  planBlock.append(planHeader, makeProgress(plan?.progress));

  const taskBlock = document.createElement('div');
  taskBlock.className = 'progress-block task-block';
  const taskHeader = document.createElement('div');
  taskHeader.className = 'block-heading';
  const taskLabel = document.createElement('span');
  taskLabel.className = 'block-label';
  taskLabel.textContent = task ? `${task.id} | ${task.title}` : 'No active task';
  taskHeader.append(taskLabel);
  if (workflow.session?.state) {
    taskHeader.append(makeState(workflow.session.state));
  }
  taskBlock.append(
    taskHeader,
    makeSegments(task?.segments ?? [], 'task-segments', 'No Task segments'),
  );

  const activityValue = document.createElement('div');
  activityValue.className = 'activity-value';
  activityValue.append(makeState(activity.state));
  if (activity.lastAction) {
    const action = document.createElement('span');
    action.className = 'activity-action';
    action.textContent = `${activity.lastAction.operation.label} | ${formatAge(activity.lastAction.ageMs)}`;
    activityValue.append(action);
  }

  const reviewValue = document.createElement('div');
  reviewValue.className = 'review-value';
  reviewValue.append(makeState(workflow.review?.state ?? 'MISSING'));
  if (workflow.review?.reviewedAt) {
    const time = document.createElement('span');
    time.textContent = formatTime(workflow.review.reviewedAt);
    reviewValue.append(time);
  }

  const details = document.createElement('div');
  details.className = 'detail-grid';
  details.append(
    makeDetail('Agent activity', activityValue),
    makeDetail('Completion review', reviewValue),
    makeDetail('Freshness', makeFreshness(item)),
    makeDetail(
      'Profile / slot',
      [item.environment.profile, item.environment.slot]
        .filter((value) => value !== null)
        .join(' / ') || '-',
    ),
    makeDetail('Station', item.resources.station.url),
    makeDetail('Relay', item.resources.relay.url),
    makeDetail('Continuation', workflow.continuation),
  );

  if ((workflow.findings ?? []).length > 0) {
    const findings = document.createElement('div');
    findings.className = 'finding-list';
    for (const finding of workflow.findings) {
      const entry = document.createElement('span');
      entry.className = `finding finding-${stateClass(finding.severity)}`;
      entry.textContent = `${finding.owner}: ${finding.code}`;
      findings.append(entry);
    }
    band.append(heading, stageBlock, planBlock, taskBlock, details, findings);
  } else {
    band.append(heading, stageBlock, planBlock, taskBlock, details);
  }
  return band;
}

function renderWorktrees(snapshot) {
  const rows = snapshot.worktrees.map(renderWorktree);
  elements.worktreeList.replaceChildren();
  if (rows.length > 0) {
    elements.worktreeList.append(...rows);
    return;
  }
  const empty = document.createElement('p');
  empty.className = 'empty';
  empty.textContent = 'No current worktrees';
  elements.worktreeList.append(empty);
}

function makeCell(value, label) {
  const cell = document.createElement('td');
  if (label) cell.dataset.label = label;
  cell.textContent = text(value);
  return cell;
}

function renderOccupancy(snapshot) {
  const profiles = new Map(
    snapshot.profiles.map((profile) => [profile.name, profile]),
  );
  const registrations = new Map(
    snapshot.registrations.map((registration) => [
      registration.workspaceId,
      registration,
    ]),
  );
  const rows = snapshot.occupancy.map((item) => {
    const profile = profiles.get(item.profile);
    const row = document.createElement('tr');
    const profileCell = document.createElement('td');
    const profileName = document.createElement('strong');
    profileName.textContent = item.profile;
    profileCell.append(profileName);
    profileCell.dataset.label = 'Profile';
    const stateCell = document.createElement('td');
    stateCell.append(makeState(item.state));
    stateCell.dataset.label = 'State';
    const worktreeCell = document.createElement('td');
    worktreeCell.dataset.label = 'Worktrees';
    appendLines(
      worktreeCell,
      item.workspaceIds.map(
        (workspaceId) =>
          registrations.get(workspaceId)?.name ?? shortId(workspaceId),
      ),
    );
    const workCell = document.createElement('td');
    workCell.dataset.label = 'Work';
    appendLines(workCell, item.workItemIds);
    row.append(
      profileCell,
      stateCell,
      makeCell(item.resetPolicy, 'Reset'),
      makeCell(profile?.stationUrl, 'Station'),
      makeCell(profile?.relayUrl, 'Relay'),
      makeCell(profile?.sourceState, 'Source'),
      worktreeCell,
      makeCell(item.slots.join(', '), 'Slots'),
      workCell,
    );
    return row;
  });
  elements.occupancyBody.replaceChildren();
  if (rows.length > 0) {
    elements.occupancyBody.append(...rows);
  } else {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 9;
    cell.className = 'empty';
    cell.textContent = 'No runtime profiles';
    row.append(cell);
    elements.occupancyBody.append(row);
  }
  elements.profileCapacityCount.textContent = String(snapshot.occupancy.length);
}

function updateFreshness() {
  if (!lastSuccessAt) return;
  const age = Math.max(0, Date.now() - Date.parse(lastSuccessAt));
  const prefix = lastSnapshot?.stream?.state === 'stale' ? 'Stale' : 'Updated';
  elements.observedAt.textContent = `${prefix} ${formatAge(age)}`;
}

function setTransport(state, label) {
  elements.transport.dataset.state = state;
  elements.transport.textContent = label;
}

function render(snapshot) {
  const unchanged =
    lastSnapshot?.digest &&
    lastSnapshot.digest === snapshot.digest &&
    lastSnapshot.stream?.state === snapshot.stream?.state;
  lastSnapshot = snapshot;
  lastSuccessAt = snapshot.stream?.lastSuccessAt ?? snapshot.observedAt;
  if (unchanged) {
    updateFreshness();
    return;
  }
  renderWorktrees(snapshot);
  renderOccupancy(snapshot);
  const activePlans = snapshot.worktrees.filter(
    (item) => item.workflow?.plan?.status === 'active',
  ).length;
  const workingAgents = snapshot.worktrees.filter((item) =>
    ['working', 'waiting'].includes(item.agentActivity?.state),
  ).length;
  const blocked = snapshot.worktrees.filter((item) =>
    ['BLOCKED', 'DRIFT'].includes(item.workflow?.verdict),
  ).length;
  elements.worktreeCount.textContent = String(snapshot.worktrees.length);
  elements.planCount.textContent = String(activePlans);
  elements.agentCount.textContent = String(workingAgents);
  elements.blockedCount.textContent = String(blocked);
  elements.profileCount.textContent = String(snapshot.profiles.length);
  elements.authority.textContent = `${snapshot.verdict} | ${snapshot.continuation}`;
  const source = snapshot.server?.source;
  const serverState = snapshot.serverFreshness?.state;
  elements.serverSource.textContent = source
    ? `${source.branch} | ${shortId(source.head)}${source.dirty ? ' dirty' : ''} | ${shortId(source.workspaceId)}${serverState ? ` | ${serverState}` : ''}`
    : 'Server source unavailable';
  const warnings = [];
  if (snapshot.stream?.state === 'stale') {
    warnings.push(`Live refresh failed: ${snapshot.stream.errorCode}`);
  }
  if (snapshot.staleLeaseCount > 0) {
    warnings.push(`${snapshot.staleLeaseCount} stale lease record(s)`);
  }
  if (snapshot.unregisteredObservationCount > 0) {
    warnings.push('Unregistered runtime observations');
  }
  if (snapshot.discovery?.error) {
    warnings.push(snapshot.discovery.error.code);
  }
  if (
    snapshot.serverFreshness &&
    snapshot.serverFreshness.state !== 'current'
  ) {
    warnings.push(`Dev server ${snapshot.serverFreshness.state}`);
  }
  const freshnessIssues = snapshot.worktrees.filter((item) =>
    ['stale', 'missing', 'invalid'].includes(item.freshness.state),
  ).length;
  if (freshnessIssues > 0) {
    warnings.push(`${freshnessIssues} worktree freshness issue(s)`);
  }
  elements.statusMessage.replaceChildren(
    ...warnings.map((warning) => {
      const item = document.createElement('span');
      item.className = 'status-warning';
      item.textContent = warning;
      return item;
    }),
  );
  updateFreshness();
  window.__PEERS_DEV_READY__ = true;
}

async function fetchSnapshot() {
  if (refreshPending) return;
  refreshPending = true;
  elements.refresh.disabled = true;
  elements.refresh.classList.add('is-loading');
  const controller = new AbortController();
  pollController = controller;
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch('/api/status', {
      cache: 'no-store',
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message ?? payload.error ?? 'Status unavailable');
    }
    render(payload);
    if (!eventStreamOpen) setTransport('polling', 'Polling');
  } catch (error) {
    if (eventStreamOpen && error.name === 'AbortError') return;
    if (lastSnapshot) {
      lastSnapshot = {
        ...lastSnapshot,
        stream: {
          ...(lastSnapshot.stream ?? {}),
          state: 'stale',
          errorCode:
            error.name === 'AbortError'
              ? 'REQUEST_TIMEOUT'
              : 'DEV_STATUS_UNAVAILABLE',
        },
      };
      render(lastSnapshot);
    } else {
      elements.statusMessage.textContent = error.message;
    }
    setTransport('stale', 'Stale');
  } finally {
    clearTimeout(timeout);
    if (pollController === controller) pollController = null;
    elements.refresh.disabled = false;
    elements.refresh.classList.remove('is-loading');
    refreshPending = false;
  }
}

function schedulePoll(immediate = false) {
  clearTimeout(pollTimer);
  if (eventStreamOpen) return;
  const delay = immediate ? 0 : document.hidden ? 30_000 : 5_000;
  pollTimer = setTimeout(async () => {
    await fetchSnapshot();
    if (!eventStreamOpen) schedulePoll();
  }, delay);
}

function stopPolling() {
  clearTimeout(pollTimer);
  pollTimer = null;
  pollController?.abort();
  pollController = null;
}

function connectEvents() {
  clearTimeout(reconnectTimer);
  if (!('EventSource' in window)) {
    setTransport('polling', 'Polling');
    schedulePoll(true);
    return;
  }
  eventSource?.close();
  setTransport('connecting', 'Connecting');
  eventSource = new EventSource('/api/events');
  eventSource.addEventListener('open', () => {
    eventStreamOpen = true;
    stopPolling();
    setTransport('live', 'Live');
  });
  eventSource.addEventListener('snapshot', (event) => {
    try {
      eventStreamOpen = true;
      render(JSON.parse(event.data));
      setTransport('live', 'Live');
    } catch {
      setTransport('stale', 'Invalid stream');
    }
  });
  eventSource.addEventListener('error', () => {
    eventStreamOpen = false;
    eventSource?.close();
    eventSource = null;
    setTransport('polling', 'Polling');
    schedulePoll(true);
    reconnectTimer = setTimeout(connectEvents, 10_000);
  });
}

elements.refresh.addEventListener('click', fetchSnapshot);
document.addEventListener('visibilitychange', () => {
  if (eventSource === null) schedulePoll(true);
});
setInterval(updateFreshness, 1_000);
connectEvents();
