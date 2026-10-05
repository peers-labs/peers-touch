export const COMPLETION_AUDIT_KIND =
  'peers-touch-completion-audit';

export const COMPLETION_AUDIT_MODES = new Set([
  'tracked',
  'standalone',
]);

export const COMPLETION_AUDIT_CLAIM_CLASSES = new Set([
  'implementation-ready',
  'delivery-ready',
  'close-ready',
]);

const TERMINAL_SESSION_STATES = new Set([
  'SOURCE_READY',
  'CANCELLED',
  'DELIVERY_READY',
]);

function check(id, passed, evidence, blocker) {
  return {
    id,
    status: passed ? 'PASS' : 'BLOCKED',
    evidence,
    blocker: passed ? null : blocker,
  };
}

function selectorChecks(snapshot) {
  const selector = snapshot.selector ?? {};
  return [
    check(
      'selector.workspace',
      /^[0-9a-f]{16}$/.test(selector.workspaceId ?? ''),
      { workspaceId: selector.workspaceId ?? null },
      'workspaceId is missing or invalid',
    ),
    check(
      'selector.work-item',
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(
        selector.workItemId ?? '',
      ),
      { workItemId: selector.workItemId ?? null },
      'workItemId is missing or invalid',
    ),
  ];
}

function implementationChecks(snapshot) {
  const checks = [
    check(
      'declaration.active',
      snapshot.declaration?.state === 'ACTIVE',
      {
        state: snapshot.declaration?.state ?? null,
        declarationDigest:
          snapshot.declaration?.declarationDigest ?? null,
      },
      'implementation-ready requires the exact ACTIVE declaration',
    ),
  ];
  if (snapshot.mode === 'standalone') {
    checks.push(
      check(
        'standalone.unmounted',
        snapshot.mount === null,
        { mountId: snapshot.mount?.mountId ?? null },
        'standalone work must remain unmounted',
      ),
      check(
        'standalone.no-tracked-projection',
        snapshot.activeWork === null && snapshot.session === null,
        {
          activeWork: snapshot.activeWork !== null,
          session: snapshot.session !== null,
        },
        'standalone work must not create Session or active-work state',
      ),
    );
  } else {
    checks.push(
      check(
        'tracked.mount',
        snapshot.mount?.state === 'mounted',
        {
          mountId: snapshot.mount?.mountId ?? null,
          state: snapshot.mount?.state ?? null,
        },
        'tracked implementation requires the exact live Plan mount',
      ),
      check(
        'tracked.run',
        ['prepared', 'active', 'blocked'].includes(
          snapshot.run?.state,
        ),
        {
          runId: snapshot.run?.runId ?? null,
          state: snapshot.run?.state ?? null,
        },
        'tracked implementation requires a non-terminal Execution Run',
      ),
    );
  }
  return checks;
}

function deliveryChecks(snapshot) {
  const checks = [
    check(
      'declaration.delivery-owner',
      snapshot.declaration?.state === 'ACTIVE',
      { state: snapshot.declaration?.state ?? null },
      'delivery-ready requires an ACTIVE declaration until close begins',
    ),
  ];
  if (snapshot.mode === 'standalone') {
    checks.push(
      check(
        'standalone.delivery-unmounted',
        snapshot.mount === null &&
          snapshot.activeWork === null &&
          snapshot.session === null,
        {
          mount: snapshot.mount !== null,
          activeWork: snapshot.activeWork !== null,
          session: snapshot.session !== null,
        },
        'standalone delivery must not manufacture tracked owner state',
      ),
    );
  } else {
    checks.push(
      check(
        'tracked.run-completed',
        snapshot.run?.state === 'completed',
        {
          runId: snapshot.run?.runId ?? null,
          state: snapshot.run?.state ?? null,
        },
        'tracked delivery requires a completed Execution Run',
      ),
      check(
        'tracked.session-terminal',
        snapshot.session === null ||
          TERMINAL_SESSION_STATES.has(snapshot.session.state),
        { state: snapshot.session?.state ?? null },
        'tracked delivery requires a terminal Development Session',
      ),
    );
  }
  return checks;
}

function closeChecks(snapshot) {
  const receipt = snapshot.closeReceipt;
  const resourceStates = receipt?.resources ?? {};
  const pendingResources = Object.entries(resourceStates)
    .filter(([, state]) => state === 'PENDING')
    .map(([resource]) => resource);
  const checks = [
    check(
      'close.receipt',
      receipt?.state === 'CLOSED',
      {
        receiptId: receipt?.receiptId ?? null,
        state: receipt?.state ?? null,
        recordDigest: receipt?.recordDigest ?? null,
      },
      'close-ready requires a CLOSED DevelopmentCloseReceipt',
    ),
    check(
      'close.resource-matrix',
      receipt?.state === 'CLOSED' && pendingResources.length === 0,
      { pendingResources },
      'DevelopmentCloseReceipt contains pending resources',
    ),
    check(
      'close.declaration',
      snapshot.declaration === null ||
        snapshot.declaration.state === 'RELEASED',
      { state: snapshot.declaration?.state ?? null },
      'declaration remains live after close',
    ),
    check(
      'close.projections',
      snapshot.activeWork === null && snapshot.session === null,
      {
        activeWork: snapshot.activeWork !== null,
        session: snapshot.session !== null,
      },
      'Session or active-work remains live after close',
    ),
  ];
  if (snapshot.mode === 'tracked') {
    checks.push(
      check(
        'close.mount',
        snapshot.mount?.state === 'released',
        {
          mountId: snapshot.mount?.mountId ?? null,
          state: snapshot.mount?.state ?? null,
        },
        'tracked close requires a released Plan mount',
      ),
    );
  } else {
    checks.push(
      check(
        'close.standalone-unmounted',
        snapshot.mount === null,
        { mountId: snapshot.mount?.mountId ?? null },
        'standalone close must remain unmounted',
      ),
    );
  }
  return checks;
}

export function evaluateCompletionSnapshot(snapshot) {
  if (
    snapshot === null ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot)
  ) {
    throw new TypeError('completion audit snapshot must be an object');
  }
  if (!COMPLETION_AUDIT_MODES.has(snapshot.mode)) {
    throw new TypeError('completion audit mode is invalid');
  }
  if (!COMPLETION_AUDIT_CLAIM_CLASSES.has(snapshot.claimClass)) {
    throw new TypeError('completion audit claimClass is invalid');
  }
  const checks = [
    ...selectorChecks(snapshot),
    ...(snapshot.claimClass === 'implementation-ready'
      ? implementationChecks(snapshot)
      : snapshot.claimClass === 'delivery-ready'
        ? deliveryChecks(snapshot)
        : closeChecks(snapshot)),
  ];
  const blockers = checks
    .filter((item) => item.status === 'BLOCKED')
    .map((item) => ({ checkId: item.id, message: item.blocker }));
  return {
    kind: COMPLETION_AUDIT_KIND,
    selector: { ...snapshot.selector },
    mode: snapshot.mode,
    claimClass: snapshot.claimClass,
    status: blockers.length === 0 ? 'PASS' : 'BLOCKED',
    checks,
    blockers,
  };
}
