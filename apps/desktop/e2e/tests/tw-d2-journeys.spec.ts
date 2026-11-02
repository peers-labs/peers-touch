/**
 * TW-D2 exact-source Native journey (make desktop, ordinary user path, no
 * Harness injection):
 *
 *  A. While a Turn runs, later admissions queue FIFO. Queue entries show
 *     live positions; cancel drops an entry; "cancel and edit" removes the
 *     entry AND seeds the composer. The recovered text survives a reload
 *     as a durable task draft.
 *  B. On an existing conversation, unsent text plus a Station-staged
 *     attachment survive a task switch and a renderer reload (chip and
 *     text rehydrate with the same object ref).
 *  C. Best-effort race for the pre-dispatch AMENDED verdict. The window is
 *     sub-frame; the assertion accepts QUEUED and records the native amend
 *     verdict as UNPROVEN in that case (Station Go concurrency tests prove
 *     the fence deterministically).
 *
 * The login/station-picker selectors in this build expose i18n keys rather
 * than English strings, so this spec binds the station itself.
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
      artifactKind: 'tw-d2-native-journey',
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
  tickMs = 1_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const raw = await page.evaluate<string>(
      `JSON.stringify((()=>{try{return (${fn})}catch(e){return {__error:String(e)}}})())`,
    );
    const value = JSON.parse(raw) as T | { __error: string };
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

async function composerValue(page: TauriPage): Promise<string> {
  return page.evaluate<string>(
    "document.querySelector('[data-pt-agent-composer-input]')?.value ?? ''",
  );
}

// The session list item has no dedicated data attribute; titles are unique
// markers of the seeded prompts. Click the deepest element containing the
// marker so the row's React onClick handles selection regardless of rail
// collapse/overflow (JS click bubbles; visibility is irrelevant to the
// selection contract).
async function clickSessionByTitle(page: TauriPage, marker: string): Promise<boolean> {
  return page.evaluate<boolean>(
    `(() => {
      const leaves = Array.from(document.querySelectorAll('span, div, p, strong'))
        .filter((el) => (el.textContent || '').includes(${JSON.stringify(marker)}));
      const target = leaves
        .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0];
      if (!target) return false;
      target.click();
      return true;
    })()`,
  );
}

async function waitClickSession(page: TauriPage, marker: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await clickSessionByTitle(page, marker)) return;
    await sleep(1_000);
  }
  throw new Error(`session row with marker ${marker} not found`);
}

async function queuePositions(page: TauriPage): Promise<number[]> {
  return page.evaluate<number[]>(
    `Array.from(document.querySelectorAll('[data-pt-agent-queue-entry]'))
      .map((el) => Number(el.querySelector('[data-pt-agent-queue-position]')?.getAttribute('data-pt-agent-queue-position') || 0))`,
  );
}

// Minimal 1x1 PNG for the attachment picker.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

tauriTest.describe.configure({ mode: 'serial' });

tauriTest.describe('TW-D2 queue, durable drafts, amendment (native, ordinary user)', () => {
  tauriTest('TW-D2: FIFO cancel/edit, draft+attachment durability', async ({ tauriPage }) => {
    tauriTest.setTimeout(1_500_000);
    const page = tauriPage as unknown as TauriPage;

    await bindAndLogin(page);
    await gotoAgent(page);

    // ── Warm-up real model round-trip ────────────────────────────────────
    await beginNewTopic(page);
    const warm = `TWD2W${Date.now().toString(36)} reply with exactly: D2-READY`;
    await sendPrompt(page, warm);
    const warmStatus = await settleLatest(page);
    expect(['completed', 'failed']).toContain(warmStatus);

    // ── A. FIFO queue while a Turn is running ────────────────────────────
    await beginNewTopic(page);
    const marker = `TWD2Q${Date.now().toString(36)}`;
    await sendPrompt(page, `${marker} Count slowly from 1 to 30, one number per line.`);
    // Past the pre-dispatch amendment fence but inside the model run.
    await sleep(2_500);

    const queuedInputs: string[] = [];
    for (let index = 1; index <= 2; index += 1) {
      const text = `${marker}-Q${index} queued instruction ${index}`;
      queuedInputs.push(text);
      await sendPrompt(page, text);
      await sleep(800);
    }

    let positions = await queuePositions(page);
    // If the fast fence happened to amend an input, keep sending while the
    // Turn runs; the queue tray must eventually show two FIFO entries.
    for (let attempt = 0; attempt < 4 && positions.length < 2; attempt += 1) {
      const text = `${marker}-QR${attempt} queued retry ${attempt}`;
      queuedInputs.push(text);
      await sendPrompt(page, text);
      await sleep(1_200);
      positions = await queuePositions(page);
    }
    expect(positions.length).toBeGreaterThanOrEqual(2);

    // Cancel the head entry (X), then take the next one back to edit.
    const headId = await page.evaluate<string>(
      "document.querySelector('[data-pt-agent-queue-entry]')?.getAttribute('data-pt-agent-queue-entry') || ''",
    );
    expect(headId).not.toBe('');
    await page.click(`[data-pt-agent-queue-cancel="${headId}"]`);
    await poll(
      page,
      `Array.from(document.querySelectorAll('[data-pt-agent-queue-entry]')).some((el) => el.getAttribute('data-pt-agent-queue-entry') === ${JSON.stringify(headId)}) ? null : 1`,
      20_000,
    );

    const nextId = await page.evaluate<string>(
      "document.querySelector('[data-pt-agent-queue-entry]')?.getAttribute('data-pt-agent-queue-entry') || ''",
    );
    const nextInput = await page.evaluate<string>(
      `document.querySelector('[data-pt-agent-queue-entry="${nextId}"] [data-pt-agent-queue-locate-message]')?.getAttribute('data-pt-agent-queue-locate-message')
        || document.querySelector('[data-pt-agent-queue-entry]')?.textContent || ''`,
    );
    await page.click(`[data-pt-agent-queue-edit="${nextId}"]`);
    await poll(
      page,
      `(() => {
        const tray = document.querySelector('[data-pt-agent-turn-queue]');
        const stillThere = Array.from(document.querySelectorAll('[data-pt-agent-queue-entry]'))
          .some((el) => el.getAttribute('data-pt-agent-queue-entry') === ${JSON.stringify(nextId)});
        const input = document.querySelector('[data-pt-agent-composer-input]');
        return (!tray || !stillThere) && input && input.value.length > 0 ? input.value : null;
      })()`,
      20_000,
    );
    const seeded = await composerValue(page);
    expect(seeded.length).toBeGreaterThan(0);

    // Reload: the recovered composer text is a durable task draft.
    await page.reload();
    await sleep(4_000);
    await poll(page, "document.querySelectorAll('[data-pt-primary-nav]').length > 0 ? 1 : null", 60_000);
    await gotoAgent(page);
    const restoredDraft = await poll<string>(
      page,
      `(() => {
        const value = document.querySelector('[data-pt-agent-composer-input]')?.value ?? '';
        return value === ${JSON.stringify(seeded)} ? value : null;
      })()`,
      60_000,
    );
    expect(restoredDraft).toBe(seeded);

    // ── B. Draft text + staged attachment survive switch + reload ────────
    const draftMarker = `TWD2D${Date.now().toString(36)} unsent draft`;
    await setValue(page, '[data-pt-agent-composer-input]', draftMarker);
    const noteFile = [{
      name: 'tw-d2-note.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    }];
    // The Station h2 channel can refuse the first cold upload; the ordinary
    // recovery is remove + pick the file again (fresh staging).
    let objectRef = '';
    for (let attempt = 0; attempt < 3 && !objectRef; attempt += 1) {
      await page.setInputFiles('[data-pt-agent-attachment-input]', noteFile);
      objectRef = await poll<string>(
        page,
        `(() => {
          const ready = document.querySelector('[data-pt-agent-composer-attachment-status="ready"]');
          if (ready) {
            return ready.getAttribute('data-pt-agent-composer-attachment-object-ref') || '';
          }
          const failed = document.querySelector('[data-pt-agent-composer-attachment-status="failed"],[data-pt-agent-composer-attachment-status="rejected"]');
          return failed ? { __failed: true } : null;
        })()`,
        45_000,
      ).catch(() => '');
      if (!objectRef) {
        const failedId = await page.evaluate<string>(
          "document.querySelector('[data-pt-agent-composer-attachment-status=\"failed\"],[data-pt-agent-composer-attachment-status=\"rejected\"]')?.getAttribute('data-pt-agent-composer-attachment') || ''",
        );
        if (failedId) {
          await page.click(`[data-pt-agent-composer-attachment-remove="${failedId}"]`);
          await sleep(1_000);
        }
      }
    }
    expect(objectRef.length).toBeGreaterThan(0);

    // Switch to a fresh task and back: hook detaches without dropping refs.
    await beginNewTopic(page);
    expect(await composerValue(page)).toBe('');
    await waitClickSession(page, marker);
    await poll(
      page,
      `(() => {
        const value = document.querySelector('[data-pt-agent-composer-input]')?.value ?? '';
        const chip = document.querySelector('[data-pt-agent-composer-attachment-status="ready"]');
        const ref = chip?.getAttribute('data-pt-agent-composer-attachment-object-ref');
        return value === ${JSON.stringify(draftMarker)} && ref === ${JSON.stringify(objectRef)}
          ? { value, ref } : null;
      })()`,
      30_000,
    );

    // Reload and reopen the task: both rehydrate from durable storage.
    await page.reload();
    await sleep(4_000);
    await poll(page, "document.querySelectorAll('[data-pt-primary-nav]').length > 0 ? 1 : null", 60_000);
    await gotoAgent(page);
    await waitClickSession(page, marker);
    const rehydrated = await poll<{ value: string; ref: string }>(
      page,
      `(() => {
        const value = document.querySelector('[data-pt-agent-composer-input]')?.value ?? '';
        const chip = document.querySelector('[data-pt-agent-composer-attachment-status="ready"]');
        const ref = chip?.getAttribute('data-pt-agent-composer-attachment-object-ref');
        return value === ${JSON.stringify(draftMarker)} && ref === ${JSON.stringify(objectRef)}
          ? { value, ref } : null;
      })()`,
      60_000,
    );
    expect(rehydrated.value).toBe(draftMarker);
    expect(rehydrated.ref).toBe(objectRef);

    // Cleanup: remove the staged attachment and clear the draft.
    const chipId = await page.evaluate<string>(
      "document.querySelector('[data-pt-agent-composer-attachment-status=\"ready\"]')?.getAttribute('data-pt-agent-composer-attachment') || ''",
    );
    await page.click(`[data-pt-agent-composer-attachment-remove="${chipId}"]`);
    await setValue(page, '[data-pt-agent-composer-input]', '');
    await poll(
      page,
      "document.querySelectorAll('[data-pt-agent-composer-attachment-status]').length === 0 ? 1 : null",
      15_000,
    );

    // ── C. Best-effort amendment race ────────────────────────────────────
    let amendedNative = false;
    for (let round = 0; round < 3 && !amendedNative; round += 1) {
      await beginNewTopic(page);
      const aMarker = `TWD2M${Date.now().toString(36)}-${round}`;
      // Two admissions back-to-back: the second is amended only when it
      // commits before the first Turn crosses its dispatch fence.
      await page.evaluate(
        `(() => {
          const set = (value) => {
            const el = document.querySelector('[data-pt-agent-composer-input]');
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
          };
          set(${JSON.stringify(`${aMarker} first instruction`)});
          document.querySelector('[data-pt-agent-composer-send]').click();
          set(${JSON.stringify(`${aMarker} second instruction`)});
          document.querySelector('[data-pt-agent-composer-send]').click();
        })()`,
      );
      await sleep(3_000);
      amendedNative = await page.evaluate<boolean>(
        "document.querySelectorAll('[data-pt-agent-delivery=\"amended\"]').length > 0",
      );
      await settleLatest(page).catch(() => undefined);
    }

    // ── Evidence ─────────────────────────────────────────────────────────
    const screenshot = await page.screenshot();
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, 'tw-d2-journey.png'), screenshot);
    writeEvidence('tw-d2-journey', {
      status: 'passed',
      warmup: { status: warmStatus },
      queue: {
        queuedInputs,
        headCancelled: headId,
        editedBackEntry: nextId,
        editedProbeText: nextInput.slice(0, 200),
        seededDraft: seeded.slice(0, 200),
        restoredAfterReload: restoredDraft.slice(0, 200),
      },
      durableDraft: {
        text: draftMarker,
        attachmentObjectRef: objectRef,
        rehydrated,
      },
      amendment: {
        nativeObserved: amendedNative,
        nativeProvenance: amendedNative
          ? 'native journey observed data-pt-agent-delivery=amended'
          : 'UNPROVEN natively: race window closed every round; deterministic fence/claim proof lives in Station TestTurnAdmissionAmendsBeforeDispatchFence',
      },
      approval: {
        nativeObserved: false,
        note: 'no capability binding in this runtime; epoch/revision proof via Station go tests, native approval journey bound to D4',
      },
    });
  });
});
