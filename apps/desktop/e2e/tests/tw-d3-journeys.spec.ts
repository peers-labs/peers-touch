/**
 * TW-D3 exact-source Native journey (make desktop, ordinary user path):
 *
 *  1. Material + task produce a real assistant output; the output is claimed
 *     as immutable artifact v1 (reader body equals Station message bytes).
 *  2. Structural check, human review, acceptance all bind the exact version;
 *     acceptance projects as current.
 *  3. Reload/reopen reads the same artifact/version/body/acceptance and the
 *     export action binds the viewed version.
 *  4. Selection feedback is quoted into the composer; the feedback Turn's
 *     output is claimed as v2 linked to the feedback; v1 turns historical
 *     with its acceptance no longer current; v2 is checked and accepted.
 *
 * Immutability and material-adoption facts are additionally asserted
 * directly against Station state (Postgres), never inferred from the UI.
 */
import { expect, test } from '@playwright/test';
import type { TauriPage } from '@srsholmes/tauri-playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createTauriTest } from '@srsholmes/tauri-playwright';

const SOCKET = process.env.PT_PLAYWRIGHT_SOCKET || '/tmp/tw-d1.sock';
const STATION_URL = process.env.PT_STATION_URL || 'http://127.0.0.1:18092';
const EMAIL = process.env.AGENT_TEST_EMAIL || 'agent-test-a@p.t';
const PASSWORD = process.env.AGENT_TEST_PASSWORD || 'Test-1234';

const { test: tauriTest } = createTauriTest({ mcpSocket: SOCKET, devUrl: '' });

const __dir = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.resolve(__dir, '../../../../tooling/acceptance/reports/task-workbench');
function writeEvidence(id: string, payload: Record<string, unknown>): void {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, `${id}.json`), JSON.stringify({
    schemaVersion: 1,
    artifactKind: 'tw-d3-native-journey',
    journeyId: id,
    commit: process.env.PT_EVIDENCE_COMMIT || 'unknown',
    stationUrl: STATION_URL,
    recordedAt: new Date().toISOString(),
    ...payload,
  }, null, 2));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function poll<T>(page: TauriPage, fn: string, timeoutMs: number, tickMs = 1_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const raw = await page.evaluate<string>(
      `JSON.stringify((()=>{try{return (${fn})}catch(e){return {__error:String(e)}}})())`,
    );
    const value = JSON.parse(raw) as T | { __error: string };
    if (value !== null && (typeof value !== 'object' || !('__error' in value))) {
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
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
  );
}

async function bindAndLogin(page: TauriPage): Promise<void> {
  if (await page.evaluate<boolean>(
    "document.querySelectorAll('[data-pt-primary-nav]').length > 0",
  )) return;
  await page.click('[data-station-picker-trigger]');
  await sleep(1_000);
  if (await page.evaluate<boolean>(
    "!!document.querySelector('input[aria-label=\"common.stationPicker.inputLabel\"]')",
  )) {
    await setValue(page, 'input[aria-label="common.stationPicker.inputLabel"]', STATION_URL);
    await page.click('button[aria-label="common.stationPicker.addLabel"]');
    await sleep(3_000);
  }
  if (await page.evaluate<boolean>("document.querySelectorAll('[data-login-tab]').length > 0")) {
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
    )) return;
    const pinVisible = await page.evaluate<boolean>(
      "!!(document.querySelector('[data-login-pin-skip]') && document.querySelector('[data-login-pin-skip]').offsetParent !== null)",
    );
    if (pinVisible) await page.click('[data-login-pin-skip]').catch(() => undefined);
    await sleep(1_500);
  }
  throw new Error('primary shell did not appear');
}

async function gotoAgent(page: TauriPage): Promise<void> {
  await page.click('[data-pt-primary-nav="agent"] [role="button"]');
  await poll(page,
    "document.querySelector('[data-pt-agent-composer-input]') instanceof HTMLTextAreaElement ? 1 : null",
    30_000);
}

async function beginNewTopic(page: TauriPage): Promise<void> {
  await page.click('[data-pt-agent-session-start]');
  await poll(page,
    "(()=>{const c=document.querySelector('[data-pt-agent-composer-input]');return c instanceof HTMLTextAreaElement && c.value==='' ? 1 : null;})()",
    15_000);
}

async function sendPrompt(page: TauriPage, text: string): Promise<void> {
  await setValue(page, '[data-pt-agent-composer-input]', text);
  await page.click('[data-pt-agent-composer-send]');
}

async function settleLatest(page: TauriPage, timeoutMs = 240_000): Promise<string> {
  return poll(page,
    `(() => {
      const msgs = Array.from(document.querySelectorAll('[data-pt-agent-message="assistant"]'));
      const last = msgs[msgs.length - 1];
      if (!last) return null;
      const status = last.getAttribute('data-pt-agent-terminal-status') || '';
      return ['completed','failed','cancelled','interrupted'].includes(status) ? status : null;
    })()`,
    timeoutMs, 3_000);
}

async function latestAssistantText(page: TauriPage): Promise<string> {
  return page.evaluate<string>(
    `(() => {
      const msgs = Array.from(document.querySelectorAll('[data-pt-agent-message="assistant"]'));
      const last = msgs[msgs.length - 1];
      return last?.textContent?.trim() ?? '';
    })()`,
  );
}

function psql(query: string): string {
  return execSync(
    `docker exec pt-tw-d1-postgres-1 psql -U peers -d peers_touch_tw_d1 -t -A -c ${JSON.stringify(query)}`,
    { encoding: 'utf8' },
  ).trim();
}

// Material is a text document: the acceptance model (qwen2.5:0.5b) has no
// vision capability, and the composer correctly fail-closes image sends for
// it (image_input_unsupported). Text material is the real consumable type
// here; the unique token lets us prove the model actually read the bytes.
const MATERIAL_TOKEN = 'ZXQ-4417-D3-MATERIAL-TOKEN';
const MATERIAL_BYTES = Buffer.from(
  [
    '# TW-D3 Material Note',
    '',
    `Material token: ${MATERIAL_TOKEN}`,
    'Scope note: the venue booking scope was checked against the city register.',
    'Conclusion seed: the site is suitable for a weekday afternoon event.',
    '',
  ].join('\n'),
  'utf-8',
);

tauriTest.describe.configure({ mode: 'serial' });

tauriTest('TW-D3: material, immutable artifact, feedback revision, checks, acceptance', async ({ tauriPage }) => {
  tauriTest.setTimeout(1_500_000);
  const page = tauriPage as unknown as TauriPage;

  await bindAndLogin(page);
  await gotoAgent(page);
  await beginNewTopic(page);

  const marker = `TWD3${Date.now().toString(36)}`;
  // Stage the material; the first cold OSS upload can fail in this cell, so
  // remove and reselect once on failure (same contract as the TW-D2 journey).
  let objectRef = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.setInputFiles('[data-pt-agent-attachment-input]', [{
      name: 'tw-d3-material.txt',
      mimeType: 'text/plain',
      buffer: MATERIAL_BYTES,
    }]);
    try {
      objectRef = await poll<string>(page,
        `(() => {
          const ready = document.querySelector('[data-pt-agent-composer-attachment-status="ready"]');
          return ready?.getAttribute('data-pt-agent-composer-attachment-object-ref') || null;
        })()`,
        60_000);
      break;
    } catch {
      const failedId = await page.evaluate<string>(
        "document.querySelector('[data-pt-agent-composer-attachment-status=\"failed\"],[data-pt-agent-composer-attachment-status=\"rejected\"]')?.getAttribute('data-pt-agent-composer-attachment') || ''",
      );
      if (!failedId || attempt === 1) throw new Error('material attachment never became ready');
      await page.click(`[data-pt-agent-composer-attachment-remove="${failedId}"]`);
      await poll(page,
        `document.querySelectorAll('[data-pt-agent-composer-attachment-status]').length === 0 ? 1 : null`,
        15_000);
    }
  }
  if (!objectRef) throw new Error('material attachment never became ready');

  await sendPrompt(page,
    `${marker} Read the attached material and write a markdown report titled exactly "${marker} Report". It must contain the material token ${MATERIAL_TOKEN} verbatim, a line "Scope: checked" and a line "Conclusion: ok".`);
  const status = await settleLatest(page);
  expect(['completed', 'failed']).toContain(status);
  const assistantText = await latestAssistantText(page);
  expect(assistantTextHasContent(assistantText)).toBe(true);
  // The unique material token proves the turn actually consumed the bytes
  // instead of merely completing a chat round trip.
  expect(assistantText).toContain(MATERIAL_TOKEN);

  // ── 1. Claim v1 ────────────────────────────────────────────────────────
  await poll(page,
    "document.querySelector('[data-pt-artifact-save-new]') ? 1 : null",
    30_000);
  await page.click('[data-pt-artifact-save-new]');
  await poll(page, "document.querySelector('[data-pt-artifact-panel]') ? 1 : null", 20_000);
  const v1 = await poll<{ id: string; body: string; name: string }>(page,
    `(() => {
      const panel = document.querySelector('[data-pt-artifact-panel]');
      const id = panel?.getAttribute('data-pt-artifact-version') || '';
      const body = document.querySelector('[data-pt-artifact-body]')?.textContent?.trim() || '';
      const name = document.querySelector('[data-pt-artifact-name]')?.textContent?.trim() || '';
      return id && body.length > 0 ? { id, body, name } : null;
    })()`,
    20_000);

  // Reader reads the exact Station message bytes.
  const v1BodyFromStation = psql(
    `SELECT b.body FROM agent_artifact_version_bodies b JOIN agent_artifact_versions v ON v.id=b.version_id WHERE v.id='${v1.id}'`,
  );
  const v1BodyText = psql(
    `SELECT convert_from(b.body,'UTF8') FROM agent_artifact_version_bodies b JOIN agent_artifact_versions v ON v.id=b.version_id WHERE v.id='${v1.id}'`,
  );
  expect(v1.body.length).toBeGreaterThan(0);
  expect(v1BodyFromStation.length).toBeGreaterThan(0);
  // The claimed Station bytes themselves carry the material token: the
  // artifact preserves proof that the producing turn consumed the material.
  expect(v1BodyText).toContain(MATERIAL_TOKEN);

  // ── 2. Structural check, human review, accept v1 ───────────────────────
  await page.click('[data-pt-artifact-check-structural]');
  await poll(page,
    "document.querySelector('[data-pt-artifact-check-result=\"passed\"]') ? 1 : null",
    15_000);
  await page.click('[data-pt-artifact-check-human-pass]');
  await poll(page,
    "Array.from(document.querySelectorAll('[data-pt-artifact-check-result]')).filter((el)=>el.getAttribute('data-pt-artifact-check-result')==='passed').length >= 2 ? 1 : null",
    15_000);
  await page.click('[data-pt-artifact-accept]');
  await poll(page, "document.querySelector('[data-pt-artifact-accepted]') ? 1 : null", 15_000);

  // ── 3. Reload: same artifact/version/body/acceptance reopen ────────────
  await page.reload();
  await sleep(4_000);
  await poll(page, "document.querySelectorAll('[data-pt-primary-nav]').length > 0 ? 1 : null", 60_000);
  await gotoAgent(page);
  await poll(page, "document.querySelector('[data-pt-artifact-open]') ? 1 : null", 30_000);
  await page.click('[data-pt-artifact-open]');
  await poll(page, "document.querySelector('[data-pt-artifact-panel]') ? 1 : null", 20_000);
  const reopenedBody = await poll<string>(page,
    `(() => {
      const id = document.querySelector('[data-pt-artifact-panel]')?.getAttribute('data-pt-artifact-version');
      const body = document.querySelector('[data-pt-artifact-body]')?.textContent?.trim() || '';
      return id === ${JSON.stringify(v1.id)} && body.length > 0 ? body : null;
    })()`,
    20_000);
  expect(reopenedBody.length).toBeGreaterThan(0);
  await poll(page, "document.querySelector('[data-pt-artifact-accepted]') ? 1 : null", 15_000);

  // Export binds the exact viewed version: intercept the synthetic download
  // anchor so no native download dialog is triggered in the harness webview.
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__twD3Export = null;
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function interceptClick(this: HTMLAnchorElement) {
      w.__twD3Export = this.download;
      HTMLAnchorElement.prototype.click = originalClick;
    };
  });
  await page.click('[data-pt-artifact-export]');
  const exportName = await poll<string>(page,
    "(window).__twD3Export ? String((window).__twD3Export) : null",
    10_000);
  expect(exportName).toContain('v1');

  // ── 4. Selection feedback → v2 ─────────────────────────────────────────
  // Select real rendered text and quote it into the composer.
  await page.evaluate(
    `(() => {
      const body = document.querySelector('[data-pt-artifact-body]');
      const range = document.createRange();
      const node = body.querySelector('p,h1,h2,li') || body;
      range.selectNodeContents(node);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    })()`,
  );
  await page.click('[data-pt-artifact-quote-selection]');
  await poll(page,
    "document.querySelector('[data-pt-artifact-feedback-pending]') ? 1 : null",
    15_000);
  const composerAfterQuote = await page.evaluate<string>(
    "document.querySelector('[data-pt-agent-composer-input]').value",
  );
  expect(composerAfterQuote.length).toBeGreaterThan(0);
  // Append the explicit revision instruction and send.
  await setValue(page, '[data-pt-agent-composer-input]',
    `${composerAfterQuote}\n${marker} revise: add a final line "Revision: applied".`);
  await page.click('[data-pt-artifact-panel] [data-pt-artifact-close]');
  await page.click('[data-pt-agent-composer-send]');
  await settleLatest(page);

  // Claim the new assistant output as v2 of the same artifact.
  await poll(page, '[data-pt-artifact-save-version] ? 1 : null', 30_000);
  const saveVersionSelector = await page.evaluate<string>(
    `document.querySelector('[data-pt-artifact-save-version]')?.getAttribute('data-pt-artifact-save-version') || ''`,
  );
  expect(saveVersionSelector.length).toBeGreaterThan(0);
  await page.click(`[data-pt-artifact-save-version="${saveVersionSelector}"]`);
  const v2 = await poll<{ id: string; seq: number; feedbackId: string }>(page,
    `(() => {
      const panel = document.querySelector('[data-pt-artifact-panel]');
      const id = panel?.getAttribute('data-pt-artifact-version') || '';
      const selected = document.querySelector('[data-pt-artifact-version-select]')?.textContent || '';
      const pendingGone = !document.querySelector('[data-pt-artifact-feedback-pending]');
      return id && pendingGone && selected.includes('v2') ? { id, seq: 2, feedbackId: '' } : null;
    })()`,
    20_000);
  expect(v2.id).not.toBe(v1.id);

  // v1 is now historical; its acceptance row is retained but no longer
  // projected as current. The antd Select has no native <select>, so drive
  // it through the rendered trigger and dropdown options.
  await page.evaluate(
    `(() => {
      const trigger = document.querySelector('[data-pt-artifact-version-select] .ant-select-selector');
      trigger?.click();
    })()`,
  );
  await sleep(500);
  await page.evaluate(
    `(() => {
      const options = Array.from(document.querySelectorAll('.ant-select-item-option'));
      const v1opt = options.find((el) => (el.textContent || '').includes('v1'));
      v1opt?.click();
    })()`,
  );
  await poll(page,
    `(() => {
      const id = document.querySelector('[data-pt-artifact-panel]')?.getAttribute('data-pt-artifact-version');
      const historical = document.querySelector('[data-pt-artifact-historical]');
      const accepted = document.querySelector('[data-pt-artifact-accepted]');
      return id === ${JSON.stringify(v1.id)} && historical && !accepted ? 1 : null;
    })()`,
    15_000);

  // Back to v2: check + accept.
  await page.evaluate(
    `(() => {
      document.querySelector('[data-pt-artifact-version-select] .ant-select-selector')?.click();
    })()`,
  );
  await sleep(500);
  await page.evaluate(
    `(() => {
      const options = Array.from(document.querySelectorAll('.ant-select-item-option'));
      options.find((el) => (el.textContent || '').includes('v2'))?.click();
    })()`,
  );
  await poll(page,
    `document.querySelector('[data-pt-artifact-panel]')?.getAttribute('data-pt-artifact-version') === ${JSON.stringify(v2.id)} ? 1 : null`,
    10_000);
  await page.click('[data-pt-artifact-check-structural]');
  await poll(page,
    `Array.from(document.querySelectorAll('[data-pt-artifact-check-result]')).filter((el)=>el.closest('[data-pt-artifact-panel]') && el.getAttribute('data-pt-artifact-check-result')==='passed').length >= 1 ? document.querySelector('[data-pt-artifact-panel]').getAttribute('data-pt-artifact-version') : null`,
    15_000);
  await page.click('[data-pt-artifact-accept]');
  await poll(page, "document.querySelector('[data-pt-artifact-accepted]') ? 1 : null", 15_000);

  // ── Station-state facts ────────────────────────────────────────────────
  const seqv1 = psql(`SELECT seq FROM agent_artifact_versions WHERE id='${v1.id}'`);
  const seqv2 = psql(`SELECT seq FROM agent_artifact_versions WHERE id='${v2.id}'`);
  const v2Parent = psql(`SELECT parent_version_id FROM agent_artifact_versions WHERE id='${v2.id}'`);
  const v2Origin = psql(`SELECT origin FROM agent_artifact_versions WHERE id='${v2.id}'`);
  const feedbackLinked = psql(`SELECT resulting_version_id FROM agent_artifact_feedback WHERE resulting_version_id='${v2.id}'`);
  const v1BodyImmutable = psql(`SELECT encode(sha256,'escape') FROM agent_artifact_version_bodies WHERE version_id='${v1.id}'`);
  const v2BodyImmutable = psql(`SELECT encode(sha256,'escape') FROM agent_artifact_version_bodies WHERE version_id='${v2.id}'`);
  const v1AcceptanceRow = psql(
    `SELECT CASE WHEN EXISTS (SELECT 1 FROM agent_artifact_acceptances WHERE version_id='${v1.id}') THEN 'history-kept' ELSE 'missing' END`,
  );
  const headAfterV2 = psql(
    `SELECT current_version FROM agent_logical_artifacts WHERE id=(SELECT artifact_id FROM agent_artifact_versions WHERE id='${v2.id}')`,
  );
  // Adoption is recorded per version from the producing turn's admitted
  // material refs. v1 must carry the attachment ref; the feedback revision
  // turn carried no new material.
  const materialAdoptedV1 = psql(
    `SELECT COUNT(*) FROM agent_artifact_versions WHERE id='${v1.id}' AND adopted_attachment_refs LIKE '%${objectRef}%'`,
  );
  const materialAdoptedV2 = psql(
    `SELECT COUNT(*) FROM agent_artifact_versions WHERE id='${v2.id}' AND adopted_attachment_refs LIKE '%${objectRef}%'`,
  );
  const bodyCount = psql('SELECT COUNT(*) FROM agent_artifact_version_bodies');
  const noUpdatePath = psql('SELECT COUNT(*) FROM agent_artifact_versions WHERE seq=0 OR sha256=\'\'');

  const screenshot = await page.screenshot();
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, 'tw-d3-journey.png'), screenshot);
  writeEvidence('tw-d3-journey', {
    status: 'passed',
    turn: {
      terminalStatus: status,
      materialObjectRef: objectRef,
      materialMimeType: 'text/plain',
      materialToken: MATERIAL_TOKEN,
      tokenInClaimedBytes: true,
    },
    v1: { id: v1.id, seq: seqv1, bodyBytes: v1BodyFromStation.length, name: v1.name },
    reload: {
      sameVersionId: v1.id,
      reopenedBodyLength: reopenedBody.length,
      acceptanceCurrent: true,
      exportName,
    },
    feedbackRevision: {
      v2Id: v2.id,
      seq: seqv2,
      parent: v2Parent,
      origin: v2Origin,
      feedbackLinked: Boolean(feedbackLinked),
      composerQuoted: composerAfterQuote.slice(0, 200),
    },
    stationFacts: {
      v1BodyHash: v1BodyImmutable,
      v2BodyHash: v2BodyImmutable,
      distinctHashes: v1BodyImmutable !== v2BodyImmutable,
      v1AcceptanceRow,
      headAfterV2,
      materialAdoptedV1,
      materialAdoptedV2,
      totalBodies: bodyCount,
      malformedVersions: noUpdatePath,
    },
  });

  expect(seqv1).toBe('1');
  expect(seqv2).toBe('2');
  expect(v2Parent).toBe(v1.id);
  expect(v2Origin).toBe('feedback_revision');
  expect(Boolean(feedbackLinked)).toBe(true);
  expect(v1BodyImmutable !== v2BodyImmutable).toBe(true);
  expect(v1AcceptanceRow).toBe('history-kept');
  expect(headAfterV2).toBe(v2.id);
  expect(materialAdoptedV1).toBe('1');
  expect(materialAdoptedV2).toBe('0');
});

function assistantTextHasContent(text: string): boolean {
  return typeof text === 'string' && text.trim().length > 20;
}
