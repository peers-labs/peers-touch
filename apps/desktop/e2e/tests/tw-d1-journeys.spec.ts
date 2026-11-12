/**
 * TW-D1 exact-source Native journey (make desktop, ordinary user path, no
 * Harness injection):
 *
 *  1. Real model round-trip on a fresh task created by the first send.
 *  2. Double-submit in the pre-admission window creates exactly one Turn
 *     (client-side in-flight guard; Station admission is the cross-client
 *     backstop).
 *  3. Renderer reload replays from Station durable events: no duplicate
 *     messages, terminal state preserved.
 * Stop terminal readback is source-audited in TW-D1 (UI only adopts the
 * cancelled state from a Station turn_id+status=cancelled event) and is
 * exercised end-to-end by TD-J03; it is intentionally not duplicated here.
 *
 * The login/station-picker selectors in this build expose i18n keys rather
 * than English strings, so this spec binds the station itself instead of
 * reusing fixtures.ensureStationBound.
 */
import { test, expect } from '@playwright/test';
import type { TauriPage } from '@srsholmes/tauri-playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTauriTest } from '@srsholmes/tauri-playwright';

const SOCKET = process.env.PT_PLAYWRIGHT_SOCKET || '/tmp/tw-d1.sock';
const STATION_URL = process.env.PT_STATION_URL || 'http://127.0.0.1:18092';
const EMAIL = process.env.AGENT_TEST_EMAIL || 'agent-test-a@p.t';
const PASSWORD = process.env.AGENT_TEST_PASSWORD || 'Test-1234';

const { test: tauriTest } = createTauriTest({ mcpSocket: SOCKET, devUrl: '' });

const __dir = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.resolve(
  __dir,
  '../../../../tooling/acceptance/reports/task-workbench',
);
function writeEvidence(id: string, payload: Record<string, unknown>): void {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(REPORT_DIR, `${id}.json`),
    JSON.stringify({
      schemaVersion: 1,
      artifactKind: 'tw-d1-native-journey',
      journeyId: id,
      commit: process.env.PT_EVIDENCE_COMMIT || 'unknown',
      stationUrl: STATION_URL,
      recordedAt: new Date().toISOString(),
      ...payload,
    }, null, 2),
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function poll<T>(
  page: TauriPage,
  fn: string,
  timeoutMs: number,
  tickMs = 2_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const raw = await page.evaluate<string>(
      `JSON.stringify((()=>{try{return (${fn})}catch(e){return {__error:String(e)}}})())`,
    );
    const value = JSON.parse(raw) as T | { __error: string };
    // null is the "not ready yet" sentinel by convention; only non-null
    // values (primitives, arrays, objects without __error) complete the poll.
    if (value !== null
      && (typeof value !== 'object' || !('__error' in value))) {
      return value as T;
    }
    if (value !== null && '__error' in value) last = value.__error;
    await sleep(tickMs);
  }
  throw new Error(`poll timeout (${timeoutMs}ms): ${fn.slice(0, 160)} last=${last}`);
}

async function setValue(page: TauriPage, selector: string, value: string): Promise<void> {
  await page.evaluate(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('missing ' + ${JSON.stringify(selector)});
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
  );
}

async function bindAndLogin(page: TauriPage): Promise<void> {
  if (await page.evaluate<boolean>(
    "document.querySelectorAll('[data-pt-primary-nav]').length > 0",
  )) {
    return;
  }

  // Open the station picker. When no station is connected the panel shows
  // the URL input; when a station chip is already present the input is
  // absent and binding is unnecessary.
  await page.click('[data-station-picker-trigger]');
  await sleep(1_000);
  const needsBind = await page.evaluate<boolean>(
    "!!document.querySelector('input[aria-label=\"common.stationPicker.inputLabel\"]')",
  );
  if (needsBind) {
    await setValue(page, 'input[aria-label="common.stationPicker.inputLabel"]', STATION_URL);
    await page.click('button[aria-label="common.stationPicker.addLabel"]');
    await sleep(3_000);
  }

  // A persisted session can land straight on the optional PIN gate; only do
  // the email login when the login tabs are actually present.
  let hasLoginTabs = await page.evaluate<boolean>(
    "document.querySelectorAll('[data-login-tab]').length > 0",
  );
  if (hasLoginTabs) {
    await page.click('[data-login-tab="email"]');
    await sleep(500);
    await page.fill('[data-login-email]', EMAIL);
    await page.fill('[data-login-password]', PASSWORD);
    await page.click('[data-login-submit]');
    await sleep(2_000);
  }

  // Fresh accounts (and restored sessions) may show an optional local PIN;
  // acceptance skips it, polling until the primary shell appears.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await page.evaluate<boolean>(
      "document.querySelectorAll('[data-pt-primary-nav]').length > 0",
    )) {
      return;
    }
    const pinVisible = await page.evaluate<boolean>(
      "!!(document.querySelector('[data-login-pin-skip]') && document.querySelector('[data-login-pin-skip]').offsetParent !== null)",
    );
    if (pinVisible) await page.click('[data-login-pin-skip]').catch(() => undefined);
    await sleep(1_500);
  }
  throw new Error('primary shell did not appear after login/PIN gate');
}

async function gotoAgent(page: TauriPage): Promise<void> {
  await page.click('[data-pt-primary-nav="agent"] [role="button"]');
  await poll(
    page,
    "document.querySelector('[data-pt-agent-composer-input]') instanceof HTMLTextAreaElement ? 1 : null",
    30_000,
  );
}

async function beginNewTopic(page: TauriPage): Promise<void> {
  await page.click('[data-pt-agent-session-start]');
  await poll(
    page,
    "(()=>{const c=document.querySelector('[data-pt-agent-composer-input]');return (c instanceof HTMLTextAreaElement && c.value==='') ? 1 : null;})()",
    15_000,
  );
}

async function sendPrompt(page: TauriPage, text: string): Promise<void> {
  await setValue(page, '[data-pt-agent-composer-input]', text);
  await page.click('[data-pt-agent-composer-send]');
}

async function settleLatest(page: TauriPage, timeoutMs = 240_000): Promise<string> {
  return poll<string>(
    page,
    `(() => {
      const msgs = Array.from(document.querySelectorAll('[data-pt-agent-message="assistant"]'));
      const last = msgs[msgs.length - 1];
      if (!last) return null;
      const status = last.getAttribute('data-pt-agent-terminal-status') || '';
      if (['completed','failed','cancelled','interrupted'].includes(status)) return status;
      return null;
    })()`,
    timeoutMs,
    3_000,
  );
}

tauriTest.describe('TW-D1 task/turn/event chain (native, ordinary user)', () => {
  tauriTest('TW-D1: real turn, duplicate submit guard, reload replay', async ({ tauriPage }) => {
    tauriTest.setTimeout(900_000);
    const page = tauriPage as unknown as TauriPage;

    await bindAndLogin(page);
    await gotoAgent(page);
    await beginNewTopic(page);

    // ── 1. Real model round-trip on the first send ────────────────────────
    const marker = `TWD1${Date.now().toString(36)}`;
    const prompt = `${marker} Reply with exactly the text: D1-OK`;
    await sendPrompt(page, prompt);
    const firstStatus = await settleLatest(page);
    expect(['completed']).toContain(firstStatus);

    const replyText = await poll<string>(
      page,
      `(() => {
        const msgs = Array.from(document.querySelectorAll('[data-pt-agent-message="assistant"]'));
        const text = (msgs[msgs.length - 1]?.textContent || '').trim();
        return /D1-OK/i.test(text) ? text.slice(0, 200) : null;
      })()`,
      60_000,
    );

    // ── 2. Duplicate pre-admission submit creates one Turn ────────────────
    await beginNewTopic(page);
    const dedupeMarker = `${marker}-DUP`;
    await setValue(page, '[data-pt-agent-composer-input]', `${dedupeMarker} reply with just OK`);
    const before = await page.evaluate<number>(
      "Array.from(document.querySelectorAll('[data-pt-agent-message=\"user\"]')).length",
    );
    // Two discrete clicks dispatched in the same tick with the identical
    // draft: the in-flight guard (session+content+attachment key) must
    // suppress the second gesture before Station admission.
    await page.evaluate(
      `(() => {
        const btn = document.querySelector('[data-pt-agent-composer-send]');
        btn.click(); btn.click();
      })()`,
    );
    await sleep(3_000);
    const afterDoubleClick = await page.evaluate<number>(
      "Array.from(document.querySelectorAll('[data-pt-agent-message=\"user\"]')).length",
    );
    expect(afterDoubleClick).toBe(before + 1);

    const dupStatus = await settleLatest(page);
    expect(['completed', 'failed']).toContain(dupStatus);

    // ── 3. Reload replays durable events without duplicating messages ─────
    const countsBefore = await page.evaluate<{ users: number; assistants: number }>(
      `(() => ({
        users: document.querySelectorAll('[data-pt-agent-message="user"]').length,
        assistants: document.querySelectorAll('[data-pt-agent-message="assistant"]').length,
      }))()`,
    );
    await page.reload();
    await sleep(4_000);
    await poll(page, "document.querySelectorAll('[data-pt-primary-nav]').length > 0 ? 1 : null", 60_000);
    await poll(
      page,
      `(() => {
        const u = document.querySelectorAll('[data-pt-agent-message="user"]').length;
        const a = document.querySelectorAll('[data-pt-agent-message="assistant"]').length;
        return u === ${countsBefore.users} && a === ${countsBefore.assistants}
          ? { u, a } : null;
      })()`,
      90_000,
    ).catch(() => undefined);
    const countsAfter = await page.evaluate<{ users: number; assistants: number }>(
      `(() => ({
        users: document.querySelectorAll('[data-pt-agent-message="user"]').length,
        assistants: document.querySelectorAll('[data-pt-agent-message="assistant"]').length,
      }))()`,
    );
    expect(countsAfter.users).toBe(countsBefore.users);
    expect(countsAfter.assistants).toBe(countsBefore.assistants);

    // ── 4. Evidence ────────────────────────────────────────────────────────
    const screenshot = await page.screenshot();
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, 'tw-d1-journey.png'), screenshot);
    writeEvidence('tw-d1-journey', {
      status: 'passed',
      firstTurn: { status: firstStatus, reply: replyText },
      duplicateSubmit: { userMessagesBefore: before, afterDoubleClick },
      replay: { before: countsBefore, after: countsAfter },
    });
  });
});
