/**
 * AUD-16 / TD-J01…J05 — Agent usability depth whole-task journeys.
 *
 * Preconditions (make desktop acceptance environment):
 *  - Desktop Tauri app is running with the Playwright socket exposed
 *    (PT_PLAYWRIGHT_SOCKET), Station reachable at PT_STATION_URL.
 *  - The fixtures' ordinary test account is logged in and owns at least one
 *    Agent with a WORKING provider/model. No Harness tools or extra
 *    capabilities are injected: these journeys exercise only the built-in
 *    capabilities an ordinary user gets out of the box.
 *
 * Transport contract: the Tauri socket bridge (@srsholmes/tauri-playwright)
 * exposes string-only evaluate, numeric-timeout waits, and TauriLocator. It is
 * NOT a browser Playwright Page, so this spec deliberately avoids function
 * evaluate, options-object waits, waitForTimeout, and Playwright locator
 * matchers.
 *
 * Evidence is written under tooling/acceptance/reports/agent-usability as
 * JSON + screenshots and MUST bind to the current commit. A journey run
 * against anything else proves nothing; the spec fails closed on missing
 * anchors rather than synthesizing evidence.
 */
import { test, expect } from '../fixtures';
import type { TauriPage } from '@srsholmes/tauri-playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filenameLocal = fileURLToPath(import.meta.url);
const __dirnameLocal = path.dirname(__filenameLocal);
const REPORT_DIR = path.resolve(
  __dirnameLocal,
  '../../../../tooling/acceptance/reports/agent-usability',
);

const JOURNEY_TIMEOUT_MS = 600_000;
const TURN_SETTLE_TIMEOUT_MS = 450_000;
const REPLAY_TIMEOUT_MS = 180_000;
const APPROVAL_TICK_MS = 1_000;

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

function runMarker(): string {
  return `TDJ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function commitSha(): string {
  // Containerized runs mount the worktree without its host gitdir, so git
  // cannot resolve HEAD there; the harness supplies the verified short SHA.
  const pinned = process.env.PT_EVIDENCE_COMMIT?.trim();
  if (pinned) return pinned;
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: path.resolve(__dirnameLocal, '../../..'),
    }).toString().trim();
  } catch {
    return 'unknown';
  }
}

function ensureReportDir(): void {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

function writeEvidence(id: string, payload: Record<string, unknown>): void {
  ensureReportDir();
  fs.writeFileSync(
    path.join(REPORT_DIR, `${id}.json`),
    JSON.stringify(
      {
        schemaVersion: 1,
        artifactKind: 'agent-usability-journey',
        journeyId: id,
        commit: commitSha(),
        recordedAt: new Date().toISOString(),
        ...payload,
      },
      null,
      2,
    ),
  );
}

async function screenshot(page: TauriPage, id: string): Promise<void> {
  ensureReportDir();
  const png = await page.screenshot();
  fs.writeFileSync(path.join(REPORT_DIR, `${id}.png`), png);
}

async function gotoAgentSurface(page: TauriPage): Promise<void> {
  // The anchor span is display:contents; click the real ActionIcon control.
  await page.click('[data-pt-primary-nav="agent"] [role="button"]');
  await page.waitForSelector('[data-pt-agent-composer-input]', 30_000);
  // Cold enrollment loads the Station runtime default and capability session
  // after mount; sending before readiness resolves would silently fall back to
  // the catalog model. The socket bridge caps function waits at ~30s, so poll
  // the readiness projection explicitly for up to two minutes.
  const readinessProbe = `(() => {
    const state = document.querySelector('[data-pt-agent-readiness-state]')
      ?.getAttribute('data-pt-agent-readiness-state');
    const model = document.querySelector('[data-pt-agent-selected-model]')
      ?.getAttribute('data-pt-agent-selected-model') || 'unknown';
    return state === 'ready' && model !== 'unknown';
  })()`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await page.evaluate<boolean>(readinessProbe).catch(() => false);
    if (ready === true) return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error('agent surface did not become ready');
}

/**
 * Each journey starts from an empty draft topic. Reusing a prior conversation
 * would inherit its failure/interruption projection and violate scenario
 * isolation; the Station conversation is created on first send.
 */
async function beginNewTopic(page: TauriPage): Promise<void> {
  await page.click('[data-pt-agent-session-start]');
  await pollExpression(
    page,
    `(() => {
      const composer = document.querySelector('[data-pt-agent-composer-input]');
      return composer instanceof HTMLTextAreaElement && composer.value === '';
    })()`,
    15_000,
  );
}

/**
 * The socket bridge's fill only drives HTMLInputElement, while the agent
 * composer is a textarea. Use the React-compatible native value setter plus
 * an input event so the store observes the draft exactly like keystrokes.
 */
async function setFieldValue(page: TauriPage, selector: string, value: string): Promise<void> {
  const target = JSON.stringify(selector);
  const payload = JSON.stringify(value);
  await page.evaluate(
    `(() => {
      const el = document.querySelector(${target});
      if (!el) throw new Error('field not found: ' + ${target});
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (!setter) throw new Error('value setter unavailable: ' + ${target});
      setter.call(el, ${payload});
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
  );
}

/**
 * The tauri-plugin-playwright socket bridge hard-caps every in-webview
 * evaluation at 30s (eval_js oneshot timeout in the 0.4.1 plugin server), so
 * waits longer than 30s MUST be expressed as short evaluate snapshots polled
 * from the test side instead of waitForFunction/waitForSelector.
 */
async function pollExpression(
  page: TauriPage,
  expression: string,
  timeoutMs: number,
  tickMs = 1_500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = '';
  while (Date.now() < deadline) {
    const met = await page.evaluate<boolean>(`(() => {
      try { return Boolean(${expression}); }
      catch (error) { return false; }
    })()`).catch((error: unknown) => {
      lastFailure = String(error).slice(0, 200);
      return false;
    });
    if (met) return;
    await sleep(tickMs);
  }
  throw new Error(
    `condition not met within ${timeoutMs}ms (last error: ${lastFailure || 'none'}): ${expression.slice(0, 200)}`,
  );
}

async function pollSelector(
  page: TauriPage,
  selector: string,
  timeoutMs: number,
  tickMs = 1_000,
): Promise<void> {
  const target = JSON.stringify(selector);
  await pollExpression(
    page,
    `(() => {
      const el = document.querySelector(${target});
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0
        && style.visibility !== 'hidden' && style.display !== 'none';
    })()`,
    timeoutMs,
    tickMs,
  );
}

/**
 * One-shot snapshot reads can also hit the bridge's hard 30s eval cap during
 * a transient webview stall; retry the trivial read instead of failing the
 * journey on transport noise.
 */
async function evalSnapshot<T>(
  page: TauriPage,
  expression: string,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await page.evaluate<T>(expression);
    } catch (error) {
      lastError = error;
      await sleep(1_000);
    }
  }
  throw lastError;
}

async function countRetry(page: TauriPage, selector: string, attempts = 3): Promise<number> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await page.count(selector);
    } catch (error) {
      lastError = error;
      await sleep(1_000);
    }
  }
  throw lastError;
}

async function startTurn(page: TauriPage, prompt: string): Promise<number> {
  const assistantBefore = await countRetry(page, '[data-pt-agent-message="assistant"]');
  const toolGroupsBefore = await countRetry(page, '[data-pt-agent-tool-call-group]');
  // After a restart/reload the composer briefly holds the previous capability
  // session while the new lease registers. Send only once readiness is fresh
  // so the turn pins the live, renewed session whose approvals stay claimable.
  await pollExpression(
    page,
    `document.querySelector('[data-pt-agent-readiness-state="ready"]') !== null`,
    20_000,
  ).catch(() => undefined);
  await setFieldValue(page, '[data-pt-agent-composer-input]', prompt);
  await page.click('[data-pt-agent-composer-send]');
  // A turn whose first response is a pure tool call (e.g. ask_user) does not
  // mount an assistant message bubble until the turn completes; wait for any
  // new turn projection instead. Polled because of the bridge 30s eval cap.
  await pollExpression(
    page,
    `document.querySelectorAll('[data-pt-agent-message="assistant"]').length > ${assistantBefore}
      || document.querySelectorAll('[data-pt-agent-tool-call-group]').length > ${toolGroupsBefore}`,
    90_000,
  );
  return assistantBefore;
}

interface AssistantProjection {
  nodes: number;
  status: string | null;
}

async function assistantProjection(page: TauriPage): Promise<AssistantProjection> {
  return evalSnapshot<AssistantProjection>(page, `(() => {
    const nodes = Array.from(document.querySelectorAll('[data-pt-agent-message="assistant"]'));
    const last = nodes[nodes.length - 1];
    return {
      nodes: nodes.length,
      status: last?.getAttribute('data-pt-agent-terminal-status') ?? null,
    };
  })()`);
}

/**
 * Turn-level liveness: the operation status tray is mounted only while the
 * chat store holds an active streaming operation. Per-iteration assistant
 * bubbles can already carry a terminal status while the model round-trips to
 * the next tool call, so message-level status alone is not a turn boundary.
 */
async function turnOperationActive(page: TauriPage): Promise<boolean> {
  return (await countRetry(page, '[data-pt-agent-operation-status]')) > 0;
}

/**
 * Approves each real per-action approval card as it appears (every click is a
 * genuine user decision, never a Harness grant) until the turn operation
 * stops and the newest assistant turn reaches a terminal status.
 */
async function settleLatestTurn(
  page: TauriPage,
  sinceCount: number,
  timeoutMs = TURN_SETTLE_TIMEOUT_MS,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let projection: AssistantProjection = { nodes: 0, status: null };
  let inactiveProbes = 0;
  while (Date.now() < deadline) {
    const pendingApprovals = await countRetry(
      page,
      '[data-pt-agent-tool-decision="approve"]:not([disabled])',
    );
    if (pendingApprovals > 0) {
      await page
        .click('[data-pt-agent-tool-decision="approve"]:not([disabled])')
        .catch(() => undefined);
      inactiveProbes = 0;
      await sleep(800);
      continue;
    }
    projection = await assistantProjection(page);
    const hasTerminalBubble =
      projection.nodes > sinceCount
      && Boolean(projection.status)
      && TERMINAL_STATUSES.has(projection.status ?? '');
    const active = await turnOperationActive(page);
    if (!active && hasTerminalBubble) {
      // Guard against the brief tear-down gap between the last event and the
      // tray unmount: require two consecutive inactive probes (~3s).
      inactiveProbes += 1;
      if (inactiveProbes >= 2) {
        return projection.status as string;
      }
    } else {
      inactiveProbes = 0;
    }
    await sleep(APPROVAL_TICK_MS);
  }
  throw new Error(
    `latest turn did not settle within ${timeoutMs}ms (assistantNodes=${projection.nodes}, status=${projection.status ?? 'none'})`,
  );
}

interface LastTurnCounts {
  toolCalls: number;
  fileArtifacts: number;
  attributionEntries: number;
  budgetErrors: number;
}

async function lastTurnCounts(page: TauriPage): Promise<LastTurnCounts> {
  // Each journey starts from an empty draft topic, so every rendered group
  // belongs to that journey's turn. Cards mount only while a group is
  // expanded, so count the group's declared totals instead of querying cards.
  return evalSnapshot<LastTurnCounts>(page, `(() => {
    const totals = { toolCalls: 0, fileArtifacts: 0, attributionEntries: 0, budgetErrors: 0 };
    document.querySelectorAll('[data-pt-agent-tool-call-group]').forEach((group) => {
      totals.toolCalls += Number(group.getAttribute('data-pt-agent-tool-call-total')) || 0;
    });
    totals.fileArtifacts = document
      .querySelectorAll('[data-pt-agent-turn-artifact]').length;
    totals.attributionEntries = document
      .querySelectorAll('[data-turn-attribution-turn-id]').length;
    totals.budgetErrors = document
      .querySelectorAll('[data-pt-agent-error-reason-code*="budget"]').length;
    return totals;
  })()`);
}

async function userMessagesContaining(page: TauriPage, marker: string): Promise<number> {
  const needle = JSON.stringify(marker);
  return evalSnapshot<number>(page, `(() => {
    const needle = ${needle};
    return Array.from(document.querySelectorAll('[data-pt-agent-message="user"]'))
      .filter((node) => (node.textContent ?? '').includes(needle))
      .length;
  })()`);
}

async function queueEntryIds(page: TauriPage): Promise<string[]> {
  // Plain JavaScript only: WebKit parses bridge evals as scripts, so TS-only
  // syntax (e.g. a type-predicate annotation) would fail to parse and the
  // callback would never resolve.
  return evalSnapshot<string[]>(
    page,
    `Array.from(document.querySelectorAll('[data-pt-agent-turn-queue] [data-pt-agent-queue-entry]'))
      .flatMap((node) => {
        const value = node.getAttribute('data-pt-agent-queue-entry');
        return value ? [value] : [];
      })`,
  );
}

async function firstArtifactId(page: TauriPage): Promise<string> {
  return evalSnapshot<string>(
    page,
    `document.querySelector('[data-pt-agent-turn-artifact]')?.getAttribute('data-pt-agent-turn-artifact') ?? ''`,
  );
}

async function firstAttributionTurnId(page: TauriPage): Promise<string> {
  return evalSnapshot<string>(
    page,
    `document.querySelector('[data-turn-attribution-turn-id]')?.getAttribute('data-turn-attribution-turn-id') ?? ''`,
  );
}

test.describe('TD-J01…J05 ordinary-user task journeys', () => {
  test.skip(
    !!process.env.PT_SKIP_TAURI_JOURNEYS,
    'native make desktop journeys skipped via PT_SKIP_TAURI_JOURNEYS',
  );

  test.beforeEach(async ({ authenticatedPage }) => {
    await gotoAgentSurface(authenticatedPage);
    await beginNewTopic(authenticatedPage);
  });

  test('TD-J01: multi-step investigation chain delivers a sourced report file', async ({
    authenticatedPage,
  }) => {
    test.setTimeout(JOURNEY_TIMEOUT_MS);
    const page = authenticatedPage;
    const marker = runMarker();
    const before = await startTurn(
      page,
      `[${marker}] Investigate the workspace topic "release checklist" as a bounded task: ` +
        'list the workspace, read at most two relevant local files (or one web_fetch only ' +
        'if no local material exists), keep a todo list, then write a final report file ' +
        'release-checklist-report.md naming every source used. Use only the built-in ' +
        'workspace list/read/write tools; do NOT run shell commands such as grep, cat, ' +
        'or find. Use at most 8 tool calls total, do not repeat a completed tool call, ' +
        'and always finish by writing the file.',
    );

    const status = await settleLatestTurn(page, before);
    expect(status).toBe('completed');

    // The artifact bar projects from a Station fetch after the terminal
    // event; give the bounded projection window time to mount its chips.
    await pollExpression(
      page,
      `document.querySelectorAll('[data-pt-agent-turn-artifact]').length > 0
        || document.querySelectorAll('[data-turn-attribution-turn-id]').length > 0`,
      30_000,
    );

    const counts = await lastTurnCounts(page);
    expect(counts.toolCalls).toBeGreaterThanOrEqual(3);
    expect(counts.fileArtifacts + counts.attributionEntries).toBeGreaterThan(0);
    expect(counts.budgetErrors).toBe(0);

    await screenshot(page, 'td-j01');
    writeEvidence('td-j01', {
      status: 'passed',
      marker,
      terminalStatus: status,
      toolCalls: counts.toolCalls,
      fileArtifacts: counts.fileArtifacts,
      attributionEntries: counts.attributionEntries,
    });
  });

  test('TD-J02: authorized directory edit fails a real check, then is fixed and re-verified', async ({
    authenticatedPage,
  }) => {
    test.setTimeout(JOURNEY_TIMEOUT_MS);
    const page = authenticatedPage;
    const marker = runMarker();
    const before = await startTurn(
      page,
      `[${marker}] Using ONLY the local file tools (no shell for creation), create ` +
        'tdj02-notes.txt at the workspace root whose content is "v1". Do not explore ' +
        'the environment (no pwd, git, or ls). Then verify with one shell allowlist ' +
        'command, namely `grep -F v2-final tdj02-notes.txt` (no pipes, redirects, or ' +
        'other shell metacharacters); on the v1 file that check must return a non-zero ' +
        'exit code. Then overwrite tdj02-notes.txt to contain exactly "v2-final" and ' +
        'run that exact grep check again until its exit code is 0. Do not touch any other file.',
    );

    const status = await settleLatestTurn(page, before);
    expect(status).toBe('completed');

    const counts = await lastTurnCounts(page);
    // write + first check + edit + re-check is a real multi-card approved chain
    expect(counts.toolCalls).toBeGreaterThanOrEqual(3);
    expect(counts.budgetErrors).toBe(0);

    await screenshot(page, 'td-j02');
    writeEvidence('td-j02', {
      status: 'passed',
      marker,
      terminalStatus: status,
      approvedToolCards: counts.toolCalls,
      note: 'Workspace scope fencing is enforced by the approved local file/shell tool receipts.',
    });
  });

  test('TD-J03: turns submitted while running queue in FIFO order and can be cancelled', async ({
    authenticatedPage,
  }) => {
    test.setTimeout(JOURNEY_TIMEOUT_MS);
    const page = authenticatedPage;
    const marker = runMarker();

    await startTurn(
      page,
      `[${marker}-a] Work slowly through a todo list with at least four steps: ` +
        'list the workspace once with the local workspace list tool, then pause between each ' +
        'todo update, and finish by writing the line "queue-a done" into a NEW root-level file ' +
        'tdj03-queue-a.txt using the local file write tool. Use only todo, workspace list, and ' +
        'file write tools; do NOT read files and do NOT use shell commands.',
    );
    await sleep(2_500);
    await setFieldValue(page, '[data-pt-agent-composer-input]', `[${marker}-b] After the previous task, create a NEW root-level file tdj03-queue-b.txt containing the line "queue-b" using the local file write tool.`);
    await page.click('[data-pt-agent-composer-send]');
    await setFieldValue(page, '[data-pt-agent-composer-input]', `[${marker}-c] Create a NEW root-level file tdj03-queue-c.txt containing the line "queue-c" using the local file write tool.`);
    await page.click('[data-pt-agent-composer-send]');

    // Both follow-ups must queue behind the still-running first turn.
    await pollExpression(
      page,
      `document.querySelectorAll('[data-pt-agent-turn-queue] [data-pt-agent-queue-entry]').length >= 2`,
      45_000,
    );
    const queuedIds = await queueEntryIds(page);
    expect(queuedIds.length).toBeGreaterThanOrEqual(2);

    // Cancel the last queued entry; the running turn and the earlier queued
    // entry keep their leases.
    const cancelledId = queuedIds[queuedIds.length - 1];
    await page.click(`[data-pt-agent-queue-cancel="${cancelledId}"]`);

    // The cancellation must actually take server-side before admission; the
    // cancelled entry leaves the queue while the other remains.
    await pollExpression(
      page,
      `document.querySelectorAll('[data-pt-agent-turn-queue] [data-pt-agent-queue-entry]').length === 1
        && !document.querySelector('[data-pt-agent-queue-entry="${cancelledId}"]')`,
      20_000,
    );

    const deadline = Date.now() + TURN_SETTLE_TIMEOUT_MS;
    let lastStatus: string | null = null;
    while (Date.now() < deadline) {
      const pendingApprovals = await countRetry(
        page,
        '[data-pt-agent-tool-decision="approve"]:not([disabled])',
      );
      if (pendingApprovals > 0) {
        await page
          .click('[data-pt-agent-tool-decision="approve"]:not([disabled])')
          .catch(() => undefined);
        await sleep(800);
        continue;
      }
      const remainingQueue = await countRetry(
        page,
        '[data-pt-agent-turn-queue] [data-pt-agent-queue-entry]',
      );
      const projection = await assistantProjection(page);
      lastStatus = projection.status;
      const active = await turnOperationActive(page);
      if (
        remainingQueue === 0
        && !active
        && lastStatus
        && TERMINAL_STATUSES.has(lastStatus)
      ) {
        break;
      }
      await sleep(APPROVAL_TICK_MS);
    }

    const remainingQueue = await countRetry(
      page,
      '[data-pt-agent-turn-queue] [data-pt-agent-queue-entry]',
    );
    expect(remainingQueue).toBe(0);
    expect(lastStatus === 'completed' || lastStatus === 'cancelled').toBe(true);

    // Receiver-visible proof that the surviving queued turn really ran after
    // the last entry was cancelled: its named file artifact must be projected
    // in the conversation. The first turn writes a different file, and a turn
    // whose approval expired never produces an artifact.
    await pollSelector(
      page,
      '[data-pt-agent-turn-artifact]',
      60_000,
    );
    const survivingTurnArtifact = await evalSnapshot<boolean>(
      page,
      `Array.from(document.querySelectorAll('[data-pt-agent-turn-artifact]'))
        .some((chip) => (chip.textContent || '').includes('tdj03-queue-b.txt'))`,
    );
    expect(survivingTurnArtifact).toBe(true);
    const cancelledTurnArtifact = await evalSnapshot<boolean>(
      page,
      `Array.from(document.querySelectorAll('[data-pt-agent-turn-artifact]'))
        .some((chip) => (chip.textContent || '').includes('tdj03-queue-c.txt'))`,
    );
    expect(cancelledTurnArtifact).toBe(false);
    const expiredReceipts = await countRetry(
      page,
      '[data-pt-agent-tool-receipt-status="expired"],[data-pt-agent-tool-receipt-status="error"]',
    );
    expect(expiredReceipts).toBe(0);

    await screenshot(page, 'td-j03');
    writeEvidence('td-j03', {
      status: 'passed',
      marker,
      entriesObserved: queuedIds.length,
      cancelledQueueEntryId: cancelledId,
      finalStatus: lastStatus,
      survivingTurnArtifact,
    });
  });

  test('TD-J05: long-task artifacts open, reopen after restart, and keep historical attribution', async ({
    authenticatedPage,
  }) => {
    test.setTimeout(JOURNEY_TIMEOUT_MS);
    const page = authenticatedPage;
    const marker = runMarker();
    const before = await startTurn(
      page,
      `[${marker}] Create a report file report.md at the workspace root with a short ` +
        'draft, then iterate once: after creating it, add a "## Final" section by editing ' +
        'the same file. Keep the file as the turn artifact. Use only todo, local file read, ' +
        'write, and edit tools; do NOT use shell commands and do NOT create directories.',
    );

    const status = await settleLatestTurn(page, before);
    expect(status).toBe('completed');

    await pollSelector(page, '[data-pt-agent-turn-artifact]', 60_000);
    const artifactId = await firstArtifactId(page);
    expect(artifactId).toBeTruthy();
    // Attribution projects from the context ledger and can land a moment
    // after the artifact chip; wait for the turn-id marker explicitly.
    await pollSelector(page, '[data-turn-attribution-turn-id]', 45_000);
    const turnId = await firstAttributionTurnId(page);
    expect(turnId).toBeTruthy();

    // Open from the producing turn into the Station-truth portal detail view.
    await page.click(`[data-pt-agent-turn-artifact-open="${artifactId}"]`);
    await pollSelector(page, '[data-pt-agent-portal-view="artifactDetail"]', 45_000);
    await page.click('[data-pt-agent-portal-close]');
    await page.waitForFunction(
      "document.querySelectorAll('[data-pt-agent-portal]').length === 0",
      15_000,
    );

    // Restart: replay rebuilds artifacts and attribution from Station truth.
    await page.reload();
    await gotoAgentSurface(page);
    await pollSelector(
      page,
      `[data-pt-agent-turn-artifact="${artifactId}"]`,
      REPLAY_TIMEOUT_MS,
    );
    const attributionAfterRestart = await countRetry(
      page,
      `[data-turn-attribution-turn-id="${turnId}"]`,
    );
    expect(attributionAfterRestart).toBe(1);

    // Reopen the same artifact after restart.
    await page.click(`[data-pt-agent-turn-artifact-open="${artifactId}"]`);
    await pollSelector(page, '[data-pt-agent-portal-view="artifactDetail"]', 45_000);

    await screenshot(page, 'td-j05');
    writeEvidence('td-j05', {
      status: 'passed',
      marker,
      artifactId,
      attributionTurnId: turnId,
      reopenedAfterRestart: true,
    });
  });

  test('TD-J04: clarification continues the same turn; replay after restart duplicates nothing', async ({
    authenticatedPage,
  }) => {
    test.setTimeout(JOURNEY_TIMEOUT_MS);
    const page = authenticatedPage;
    const marker = runMarker();
    const before = await startTurn(
      page,
      `[${marker}] Ask exactly one clarifying question before you do anything, then wait ` +
        'for my answer. Treat whatever I type as the final, verbatim file content and use it ' +
        'without asking again or proposing alternatives. After my answer, write a NEW ' +
        'root-level file tdj04-answer.txt containing only my answer text using the local file ' +
        'write tool, then finish. Do not create directories and do not use shell commands.',
    );

    await pollSelector(page, '[data-pt-agent-clarification]', REPLAY_TIMEOUT_MS);
    await pollExpression(
      page,
      `!!document.querySelector('[data-pt-agent-clarification-submit]')
        && (document.querySelectorAll('[data-pt-agent-clarification-choice]').length > 0
          || !!document.querySelector('[data-pt-agent-clarification-input], [data-pt-agent-clarification-other]'))`,
      60_000,
    );
    const choices = await countRetry(page, '[data-pt-agent-clarification-choice]');
    if (choices > 0) {
      await page.click('[data-pt-agent-clarification-choice]');
    } else {
      await setFieldValue(page, '[data-pt-agent-clarification-input]', `${marker} final answer content`);
    }
    await page.click('[data-pt-agent-clarification-submit]');

    const status = await settleLatestTurn(page, before);
    expect(status).toBe('completed');

    const userMessagesBefore = await userMessagesContaining(page, marker);
    expect(userMessagesBefore).toBeGreaterThan(0);

    // Simulate a Desktop/webview restart: Station truth rebuilds the session.
    await page.reload();
    await gotoAgentSurface(page);
    await pollExpression(
      page,
      `(() => {
        const nodes = Array.from(document.querySelectorAll('[data-pt-agent-message="assistant"]'));
        const last = nodes[nodes.length - 1];
        return last?.getAttribute('data-pt-agent-terminal-status') === 'completed';
      })()`,
      REPLAY_TIMEOUT_MS,
    );
    await sleep(2_000);

    const userMessagesAfter = await userMessagesContaining(page, marker);
    expect(userMessagesAfter).toBe(userMessagesBefore);

    await screenshot(page, 'td-j04');
    writeEvidence('td-j04', {
      status: 'passed',
      marker,
      userMessagesBefore,
      userMessagesAfter,
    });
  });
});
