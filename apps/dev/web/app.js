const elements = {
  authority: document.querySelector('#authority'),
  blockedCount: document.querySelector('#blocked-count'),
  observedAt: document.querySelector('#observed-at'),
  occupancyBody: document.querySelector('#occupancy-body'),
  profileCapacityCount: document.querySelector('#profile-capacity-count'),
  profileCount: document.querySelector('#profile-count'),
  refresh: document.querySelector('#refresh'),
  requirementCount: document.querySelector('#requirement-count'),
  runtimeCount: document.querySelector('#runtime-count'),
  serverSource: document.querySelector('#server-source'),
  statusMessage: document.querySelector('#status-message'),
  worktreeBody: document.querySelector('#worktree-body'),
  worktreeCount: document.querySelector('#worktree-count'),
};
let refreshPending = false;

function text(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function shortId(value) {
  const normalized = text(value);
  return normalized === '—' ? normalized : normalized.slice(0, 8);
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text(value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

function makeCell(value, className) {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = text(value);
  return cell;
}

function makeState(state) {
  const badge = document.createElement('span');
  badge.className = `state state-${state}`;
  const dot = document.createElement('span');
  dot.className = 'state-dot';
  dot.setAttribute('aria-hidden', 'true');
  badge.append(dot, document.createTextNode(state));
  return badge;
}

function appendLines(cell, lines, empty = '—') {
  const visible = lines.filter(Boolean);
  if (visible.length === 0) {
    cell.textContent = empty;
    return cell;
  }
  for (const [index, line] of visible.entries()) {
    const item = document.createElement('span');
    item.className = index === 0 ? 'cell-line' : 'cell-line subtle-line';
    item.textContent = line;
    cell.append(item);
  }
  return cell;
}

function replaceRows(body, rows, emptyColumns) {
  body.replaceChildren();
  if (rows.length > 0) {
    body.append(...rows);
    return;
  }
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = emptyColumns;
  cell.className = 'empty';
  cell.textContent = 'No current records';
  row.append(cell);
  body.append(row);
}

function formatClaim(claim) {
  return `${claim.kind}: ${claim.resourceId} · ${claim.mode}`;
}

function resourceCell(resource) {
  return appendLines(document.createElement('td'), [
    resource.url,
    resource.deployEnvironment
      ? `deploy: ${resource.deployEnvironment}`
      : null,
    ...resource.claims.map(formatClaim),
  ]);
}

function planLines(plan) {
  if (!plan) return [];
  if (plan.status === 'available') {
    const progress = plan.progress;
    const projected = progress?.nextProgressBoundary;
    return [
      `Task ${plan.taskId}`,
      progress
        ? `${progress.completed} / ${progress.total} · ${progress.percentage}%`
        : null,
      projected
        ? `After Next ${projected.completedAfter} / ${progress.total} · ${projected.percentageAfter}%`
        : null,
    ];
  }
  return [
    `Plan ${plan.status}`,
    plan.errorCode ? `Reason ${plan.errorCode}` : null,
  ];
}

function renderWorktrees(snapshot) {
  const rows = snapshot.worktrees.map((item) => {
    const row = document.createElement('tr');

    const worktreeCell = document.createElement('td');
    const name = document.createElement('strong');
    name.textContent = item.name ?? 'Unregistered';
    worktreeCell.append(name);
    appendLines(worktreeCell, [shortId(item.workspaceId)]);

    const workStateCell = document.createElement('td');
    workStateCell.append(makeState(item.workState));

    const environmentHealthCell = document.createElement('td');
    environmentHealthCell.append(makeState(item.environmentHealth.state));
    appendLines(environmentHealthCell, item.environmentHealth.issues);

    const requirementCell = document.createElement('td');
    if (item.requirements.length === 0) {
      requirementCell.textContent = '—';
    } else {
      for (const requirement of item.requirements) {
        const entry = document.createElement('div');
        entry.className = 'requirement';
        const title = document.createElement('strong');
        title.textContent = requirement.workItemId;
        entry.append(title);
        appendLines(entry, [
          requirement.journeyId
            ? `Journey ${requirement.journeyId}`
            : 'No Journey',
          `Declaration ${requirement.state}`,
          ...planLines(requirement.plan),
          requirement.purpose,
        ]);
        requirementCell.append(entry);
      }
    }

    const environmentCell = appendLines(document.createElement('td'), [
      item.environment.profile
        ? `profile: ${item.environment.profile}`
        : null,
      item.environment.slot !== null
        ? `slot: ${item.environment.slot}`
        : null,
      item.environment.resetPolicy
        ? `reset: ${item.environment.resetPolicy}`
        : null,
      item.environment.sourceState
        ? `source: ${item.environment.sourceState}`
        : null,
    ]);

    const otherClaims = [
      ...item.resources.databases,
      ...item.resources.other,
    ];
    const otherCell = appendLines(
      document.createElement('td'),
      otherClaims.map(formatClaim),
    );
    const leaseCell = appendLines(
      document.createElement('td'),
      item.leases.map(
        (lease) =>
          `${lease.resourceKind}: ${lease.resourceId} · ${shortId(lease.leaseId)}`,
      ),
    );

    row.append(
      worktreeCell,
      appendLines(document.createElement('td'), item.branches),
      workStateCell,
      environmentHealthCell,
      requirementCell,
      environmentCell,
      resourceCell(item.resources.station),
      resourceCell(item.resources.relay),
      otherCell,
      leaseCell,
    );
    return row;
  });
  replaceRows(elements.worktreeBody, rows, 10);
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
    if (profile?.error) {
      appendLines(profileCell, [profile.error.code]);
    }
    const stateCell = document.createElement('td');
    stateCell.append(makeState(item.state));
    row.append(
      profileCell,
      stateCell,
      makeCell(item.resetPolicy),
      makeCell(profile?.stationUrl),
      makeCell(profile?.relayUrl),
      makeCell(profile?.sourceState),
      appendLines(
        document.createElement('td'),
        item.workspaceIds.map((workspaceId) => {
          const registration = registrations.get(workspaceId);
          return registration?.name ?? shortId(workspaceId);
        }),
      ),
      makeCell(item.slots.join(', ')),
      appendLines(document.createElement('td'), item.workItemIds),
    );
    return row;
  });
  replaceRows(elements.occupancyBody, rows, 9);
  elements.profileCapacityCount.textContent = String(snapshot.occupancy.length);
}

function renderSummary(snapshot) {
  const requirementCount = snapshot.worktrees.reduce(
    (count, item) => count + item.requirements.length,
    0,
  );
  const runtimeCount = snapshot.worktrees.filter(
    (item) => item.leases.length > 0,
  ).length;
  const blockedCount = snapshot.worktrees.filter((item) =>
    item.workState === 'blocked' ||
    ['blocked', 'conflict'].includes(item.environmentHealth.state),
  ).length;

  elements.worktreeCount.textContent = String(snapshot.worktrees.length);
  elements.requirementCount.textContent = String(requirementCount);
  elements.runtimeCount.textContent = String(runtimeCount);
  elements.blockedCount.textContent = String(blockedCount);
  elements.profileCount.textContent = String(snapshot.profiles.length);
  elements.authority.textContent = `Authority: ${snapshot.authority}`;
  elements.observedAt.textContent = `Observed ${formatTime(snapshot.observedAt)}`;
  const source = snapshot.server?.source;
  elements.serverSource.textContent = source
    ? `${source.branch} · ${shortId(source.head)}${source.dirty ? ' dirty' : ''} · ${shortId(source.workspaceId)}`
    : 'Server source unavailable';
}

function render(snapshot) {
  renderSummary(snapshot);
  renderWorktrees(snapshot);
  renderOccupancy(snapshot);
  const warnings = [];
  if (snapshot.staleLeaseCount > 0) {
    warnings.push(`${snapshot.staleLeaseCount} stale lease record(s)`);
  }
  if (snapshot.unregisteredObservationCount > 0) {
    warnings.push('Unregistered observations');
  }
  const declarationOnly = snapshot.worktrees.filter(
    (item) => item.environmentHealth.state === 'unregistered',
  ).length;
  if (declarationOnly > 0) {
    warnings.push(`${declarationOnly} declaration-only worktrees`);
  }
  const staleWork = snapshot.worktrees.filter(
    (item) => item.workState === 'stale',
  ).length;
  if (staleWork > 0) {
    warnings.push(`${staleWork} worktree(s) with stale declarations`);
  }
  elements.statusMessage.replaceChildren(
    ...warnings.map((warning) => {
      const item = document.createElement('span');
      item.className = 'status-warning';
      item.textContent = warning;
      return item;
    }),
  );
}

async function refresh() {
  if (refreshPending) return;
  refreshPending = true;
  elements.refresh.disabled = true;
  elements.refresh.classList.add('is-loading');
  elements.statusMessage.textContent = '';
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message ?? payload.error ?? 'Status unavailable');
    }
    render(payload);
  } catch (error) {
    elements.statusMessage.textContent = error.message;
  } finally {
    elements.refresh.disabled = false;
    elements.refresh.classList.remove('is-loading');
    refreshPending = false;
  }
}

elements.refresh.addEventListener('click', refresh);
refresh();
setInterval(refresh, 15_000);
