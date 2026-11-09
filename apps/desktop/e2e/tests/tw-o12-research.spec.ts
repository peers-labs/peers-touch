/**
 * TW-O12 exact-source Native Journey — research/doc (tw-o12-research-memory).
 *
 * Ordinary user path (make-desktop acceptance cell, real Station + real
 * Volcengine Seed strong model, no Harness state injection). One continuous
 * story on the current source:
 *
 *   material upload -> strong model consumes bytes -> deliverable claimed v1
 *   -> selection feedback -> v2 -> structural check + accept -> reload/reopen
 *   -> (memory) a real turn heuristically yields a CANDIDATE, human confirms
 *   -> a SECOND task asks for the fact cold; the confirmed memory is the only
 *   source, the strong model recalls it, and Station records the confirmed
 *   memory as retrieved for that exact turn.
 *
 * The cross-task recall is the O12 increment that the old 0.5b model could
 * not prove: the code token never appears in the second task's prompt, so the
 * answer can only originate from the confirmed-only memory snapshot injected
 * into the strong model's system prompt.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import type { TauriPage } from '@srsholmes/tauri-playwright';
import { createTauriTest } from '@srsholmes/tauri-playwright';

const SOCKET = process.env.PT_PLAYWRIGHT_SOCKET || '/tmp/tw-d1.sock';
const STATION_URL = process.env.PT_STATION_URL || 'http://127.0.0.1:18092';
const EMAIL = process.env.AGENT_TEST_EMAIL || 'agent-test-a@p.t';
const PASSWORD = process.env.AGENT_TEST_PASSWORD || 'Test-1234';
const AGENT_NAME = process.env.AGENT_TEST_AGENT || 'assistant';

const { test: tauriTest, expect } = createTauriTest({ mcpSocket: SOCKET, devUrl: '' });

const __dir = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.resolve(__dir, '../../../../tooling/acceptance/reports/task-workbench');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function psql(query: string): string {
  return execSync(
    `docker exec pt-tw-d1-postgres-1 psql -U peers -d peers_touch_tw_d1 -t -A -c ${JSON.stringify(query)}`,
    { encoding: 'utf8' },
  ).trim();
}

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
      const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
}

async function bindAndLogin(page: TauriPage): Promise<void> {
  if (await page.evaluate<boolean>("document.querySelectorAll('[data-pt-primary-nav]').length > 0")) return;
  await page.click('[data-station-picker-trigger]').catch(() => undefined);
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
    await setValue(page, '[data-login-email]', EMAIL);
    await page.fill('[data-login-password]', PASSWORD);
    await page.click('[data-login-submit]');
    await sleep(2_000);
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await page.evaluate<boolean>("document.querySelectorAll('[data-pt-primary-nav]').length > 0")) return;
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
      return msgs[msgs.length - 1]?.textContent?.trim() ?? '';
    })()`,
  );
}

// Send a prompt and wait for a NEW assistant message to reach a terminal
// status. Post-reload the agent surface cold-boot can swallow one synthetic
// draft (the send control stays disabled), so admission is confirmed by the
// appearance of the new USER message and the set+click is retried if dropped.
// Only after admission do we await the (possibly very slow) assistant turn.
async function sendAndAwaitNewTurn(page: TauriPage, text: string, terminalTimeoutMs = 200_000): Promise<string> {
  const counts = async (): Promise<{ u: number; a: number }> =>
    page.evaluate<{ u: number; a: number }>(
      `JSON.stringify({
        u: document.querySelectorAll('[data-pt-agent-message="user"]').length,
        a: document.querySelectorAll('[data-pt-agent-message="assistant"]').length,
      })`,
    ).then((raw) => JSON.parse(raw as unknown as string) as { u: number; a: number });

  const before = await counts();
  let admitted = false;
  for (let attempt = 0; attempt < 3 && !admitted; attempt += 1) {
    await setValue(page, '[data-pt-agent-composer-input]', text);
    await sleep(500);
    // Dispatch the click: the acceptance WebKit's trusted click rejects the
    // icon-only antd send button (center hit-target is an inner <span>),
    // which silently swallowed the post-reload submit.
    await page.evaluate(
      `(() => {
        const b = document.querySelector('[data-pt-agent-composer-send]');
        if (!b || b.disabled) return false;
        ['mousedown', 'mouseup', 'click'].forEach((type) =>
          b.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })));
        return true;
      })()`,
    );
    try {
      await poll(page,
        `(() => document.querySelectorAll('[data-pt-agent-message="user"]').length > ${before.u} ? 1 : null)()`,
        15_000, 1_500);
      admitted = true;
    } catch {
      // Draft/click was dropped during cold render; re-set and resend.
    }
  }
  if (!admitted) throw new Error('prompt was not admitted into a new turn');

  return poll(page,
    `(() => {
      const m = document.querySelectorAll('[data-pt-agent-message="assistant"]');
      if (m.length <= ${before.a}) return null;
      const last = m[m.length - 1];
      const status = last.getAttribute('data-pt-agent-terminal-status') || '';
      return ['completed', 'failed', 'cancelled', 'interrupted'].includes(status) ? status : null;
    })()`,
    terminalTimeoutMs, 3_000);
}

async function openVersionSelect(page: TauriPage): Promise<void> {
  await page.evaluate(
    `(() => {
      const sel = document.querySelector('[data-pt-artifact-version-select]');
      const target = sel?.querySelector('.ant-select-content') || sel;
      if (!target) return;
      ['mousedown', 'mouseup', 'click'].forEach((type) => target.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, view: window }),
      ));
    })()`,
  );
  await sleep(500);
}

async function chooseVersion(page: TauriPage, label: string): Promise<void> {
  await openVersionSelect(page);
  await page.evaluate(
    `(() => {
      const option = Array.from(document.querySelectorAll('.ant-select-item-option'))
        .find((el) => (el.textContent || '').trim() === ${JSON.stringify(label)});
      if (!option) return;
      ['mousedown', 'mouseup', 'click'].forEach((type) => option.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, view: window }),
      ));
    })()`,
  );
  await sleep(500);
}

tauriTest.describe.configure({ mode: 'serial' });

tauriTest('TW-O12 research/doc: material deliverable, feedback revision, recall via confirmed memory', async ({ tauriPage }) => {
  tauriTest.setTimeout(1_500_000);
  const page = tauriPage as unknown as TauriPage;

  const suffix = Date.now().toString(36).toUpperCase();
  const marker = `O12R${suffix}`;
  const MATERIAL_TOKEN = `O12-MAT-${suffix}-TOKEN`;
  const MATERIAL_PROOF = 'harbor ledger rooms are painted indigo on tuesdays';
  const probeHit = (text: string) =>
    [MATERIAL_TOKEN.toLowerCase(), MATERIAL_PROOF].some((p) => text.toLowerCase().includes(p));
  const materialBytes = Buffer.from(
    ['# TW-O12 Material', '', `Material token: ${MATERIAL_TOKEN}`, `Note: ${MATERIAL_PROOF}.`, ''].join('\n'),
    'utf-8',
  );

  // The remembered fact deliberately avoids the word "project" so extraction
  // yields exactly one identity candidate, and shares plain tokens with the
  // later recall query ("internal codename").
  const CODE = `ZEPHYR-${suffix}`;
  const codeFlat = CODE.replace(/[^A-Z0-9]/g, '');
  const rememberText = `Remember the following fact: my internal codename is ${CODE}. `
    + 'Do not call any tool or function (none are bound); just reply with one short plain-text sentence confirming you noted it.';
  const recallText = 'What is my internal codename? Reply with only the codename token and nothing else. Do not call any tool or function; answer directly.';

  await bindAndLogin(page);
  await gotoAgent(page);
  await beginNewTopic(page);

  // Station keys memory by the agent's canonical id (turn pipeline and review
  // dock must agree); resolve it from the roster name used by the UI.
  const AGENT_ID = psql(`SELECT id FROM agents WHERE name='${AGENT_NAME}'`);
  expect(AGENT_ID.length).toBeGreaterThan(0);
  // Deterministic queue: drop O12 codename candidates left by earlier runs so
  // the review dock shows only this run's candidate.
  psql(`DELETE FROM agent_memories WHERE agent_id='${AGENT_ID}' AND content LIKE '%internal codename is ZEPHYR-%';`);

  // ── 1. Material upload (OSS admission, one cold-failure reselect) ────────
  const stageMaterial = async (): Promise<string> => {
    let ref = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.setInputFiles('[data-pt-agent-attachment-input]', [{
        name: 'tw-o12-material.txt',
        mimeType: 'text/plain',
        buffer: materialBytes,
      }]);
      try {
        ref = await poll<string>(page,
          `(() => document.querySelector('[data-pt-agent-composer-attachment-status="ready"]')
            ?.getAttribute('data-pt-agent-composer-attachment-object-ref') || null)()`,
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
    if (!ref) throw new Error('material attachment never became ready');
    return ref;
  };
  let objectRef = await stageMaterial();

  // ── 2. Strong model consumes the material -> deliverable ────────────────
  // Seed occasionally ignores the no-tool instruction and emits a
  // local_file_read (fail-closed -> interrupted); treat that as retryable and
  // re-stage the material with an explicit anti-tool directive.
  let assistantText = '';
  let lastStatus = '';
  for (let turnAttempt = 0; turnAttempt < 3; turnAttempt += 1) {
    const antiTool = turnAttempt === 0
      ? ''
      : ' The material is ALREADY PASTED into this message; do NOT emit any tool call, '
        + 'especially local_file_read (it is unbound and will abort the turn). Answer solely from the pasted text. ';
    await setValue(page, '[data-pt-agent-composer-input]',
      `${marker} Read the attached material and write a short markdown report titled exactly "${marker} Report". `
      + `The full material text is included directly in this message under its filename; do NOT call any tool or read any file (no local_file_read), use the included text as-is. `
      + antiTool
      + `You MUST copy this line verbatim into the report: "Material token: ${MATERIAL_TOKEN}". `
      + 'Keep the whole report under 14 lines and output only the report.');
    await page.click('[data-pt-agent-composer-send]');
    const status = await settleLatest(page);
    if (!['completed', 'failed', 'interrupted', 'cancelled'].includes(status)) {
      throw new Error(`unexpected report turn status: ${status}`);
    }
    lastStatus = status;
    assistantText = await latestAssistantText(page);
    if (status === 'completed' && probeHit(assistantText)) break;
    if (turnAttempt < 2) objectRef = await stageMaterial();
  }
  expect(lastStatus).toBe('completed');
  expect(probeHit(assistantText)).toBe(true);

  // ── 3. Claim the deliverable as immutable v1 ────────────────────────────
  await poll(page, "document.querySelector('[data-pt-artifact-save-new]') ? 1 : null", 30_000);
  // Re-issue the native click until the panel mounts (the WebKit trusted
  // click occasionally misses the antd button's inner span).
  await poll(page,
    `(() => {
      if (document.querySelector('[data-pt-artifact-panel]')) return 1;
      document.querySelector('[data-pt-artifact-save-new]')?.click();
      return null;
    })()`,
    30_000, 1_000);
  const v1 = await poll<{ id: string; body: string }>(page,
    `(() => {
      const panel = document.querySelector('[data-pt-artifact-panel]');
      const id = panel?.getAttribute('data-pt-artifact-version') || '';
      const body = document.querySelector('[data-pt-artifact-body]')?.textContent?.trim() || '';
      return id && body.length > 0 ? { id, body } : null;
    })()`,
    45_000);
  const v1StationBody = psql(
    `SELECT convert_from(b.body,'UTF8') FROM agent_artifact_version_bodies b WHERE b.version_id='${v1.id}'`,
  );
  expect(probeHit(v1StationBody)).toBe(true);

  // ── 4. Selection feedback -> v2 ─────────────────────────────────────────
  await page.click('[data-pt-artifact-quote-selection]');
  await poll(page, "document.querySelector('[data-pt-artifact-feedback-pending]') ? 1 : null", 15_000);
  const quoted = await page.evaluate<string>("document.querySelector('[data-pt-agent-composer-input]').value");
  expect(quoted.length).toBeGreaterThan(0);
  const revisionDirective = `${marker} revise: append exactly one final line "Revision: applied". `
    + 'Do not call any tool or read any file; revise the quoted text directly. '
    + 'Output only the revised report, keep it under 15 lines, do not repeat explanations.';
  await setValue(page, '[data-pt-agent-composer-input]', `${quoted}\n${revisionDirective}`);
  await page.click('[data-pt-artifact-panel] [data-pt-artifact-close]');
  let revisionStatus = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.click('[data-pt-agent-composer-send]');
    revisionStatus = await settleLatest(page, 320_000);
    if (revisionStatus === 'completed') break;
    if (attempt === 0) await setValue(page, '[data-pt-agent-composer-input]', revisionDirective);
  }
  expect(revisionStatus).toBe('completed');

  await poll(page, "document.querySelector('[data-pt-artifact-save-version]') ? 1 : null", 30_000);
  const saveVersionSelector = await page.evaluate<string>(
    `document.querySelector('[data-pt-artifact-save-version]')?.getAttribute('data-pt-artifact-save-version') || ''`,
  );
  expect(saveVersionSelector.length).toBeGreaterThan(0);
  await page.click(`[data-pt-artifact-save-version="${saveVersionSelector}"]`);
  const v2 = await poll<{ id: string }>(page,
    `(() => {
      const panel = document.querySelector('[data-pt-artifact-panel]');
      const id = panel?.getAttribute('data-pt-artifact-version') || '';
      const selected = document.querySelector('[data-pt-artifact-version-select]')?.textContent || '';
      const pendingGone = !document.querySelector('[data-pt-artifact-feedback-pending]');
      return id && pendingGone && selected.includes('v2') ? { id } : null;
    })()`,
    20_000);
  expect(v2.id).not.toBe(v1.id);

  // ── 5. Structural check + accept v2 ─────────────────────────────────────
  await page.click('[data-pt-artifact-check-structural]');
  await poll(page,
    `Array.from(document.querySelectorAll('[data-pt-artifact-check-result]')).filter((el)=>el.closest('[data-pt-artifact-panel]') && el.getAttribute('data-pt-artifact-check-result')==='passed').length >= 1 ? 1 : null`,
    15_000);
  await page.click('[data-pt-artifact-accept]');
  await poll(page, "document.querySelector('[data-pt-artifact-accepted]') ? 1 : null", 15_000);

  // ── 6. Station artifact facts ───────────────────────────────────────────
  const seqv1 = psql(`SELECT seq FROM agent_artifact_versions WHERE id='${v1.id}'`);
  const seqv2 = psql(`SELECT seq FROM agent_artifact_versions WHERE id='${v2.id}'`);
  const v2Parent = psql(`SELECT parent_version_id FROM agent_artifact_versions WHERE id='${v2.id}'`);
  const v2Origin = psql(`SELECT origin FROM agent_artifact_versions WHERE id='${v2.id}'`);
  const feedbackLinked = psql(`SELECT resulting_version_id FROM agent_artifact_feedback WHERE resulting_version_id='${v2.id}'`);
  const v1Hash = psql(`SELECT sha256 FROM agent_artifact_version_bodies WHERE version_id='${v1.id}'`);
  const v2Hash = psql(`SELECT sha256 FROM agent_artifact_version_bodies WHERE version_id='${v2.id}'`);
  const v2StationBody = psql(
    `SELECT convert_from(b.body,'UTF8') FROM agent_artifact_version_bodies b WHERE b.version_id='${v2.id}'`,
  );
  const headId = psql(
    `SELECT current_version FROM agent_logical_artifacts WHERE id=(SELECT artifact_id FROM agent_artifact_versions WHERE id='${v2.id}')`,
  );
  const adoptedV1 = psql(`SELECT COUNT(*) FROM agent_artifact_versions WHERE id='${v1.id}' AND adopted_attachment_refs LIKE '%${objectRef}%'`);
  const adoptedV2 = psql(`SELECT COUNT(*) FROM agent_artifact_versions WHERE id='${v2.id}' AND adopted_attachment_refs LIKE '%${objectRef}%'`);
  expect(seqv1).toBe('1');
  expect(seqv2).toBe('2');
  expect(v2Parent).toBe(v1.id);
  expect(v2Origin).toBe('feedback_revision');
  expect(Boolean(feedbackLinked)).toBe(true);
  expect(v1Hash).not.toBe(v2Hash);
  expect(v2StationBody).toContain('Revision: applied');
  expect(headId).toBe(v2.id);
  expect(adoptedV1).toBe('1');
  expect(adoptedV2).toBe('0');

  // ── 7. Refresh / reopen: current accepted v2 rehydrates ─────────────────
  await page.click('[data-pt-artifact-panel] [data-pt-artifact-close]').catch(() => undefined);
  await page.reload();
  await sleep(4_000);
  await poll(page, "document.querySelectorAll('[data-pt-primary-nav]').length > 0 ? 1 : null", 60_000);
  await gotoAgent(page);
  await poll(page, "document.querySelector('[data-pt-artifact-open]') ? 1 : null", 30_000);
  await page.click('[data-pt-artifact-open]');
  await poll(page,
    `(() => {
      const id = document.querySelector('[data-pt-artifact-panel]')?.getAttribute('data-pt-artifact-version');
      const body = document.querySelector('[data-pt-artifact-body]')?.textContent?.trim() || '';
      return id === ${JSON.stringify(v2.id)} && body.length > 0 ? 1 : null;
    })()`,
    45_000);
  await poll(page, "document.querySelector('[data-pt-artifact-accepted]') ? 1 : null", 15_000);
  // Close the artifact panel and verify it is gone so it cannot overlay the
  // floating memory review dock (the confirm control must be hit-testable).
  await page.evaluate(`(() => {
    document.querySelector('[data-pt-artifact-panel] [data-pt-artifact-close]')?.click();
  })()`);
  await poll(page, `!document.querySelector('[data-pt-artifact-panel]') ? 1 : null`, 15_000);

  // ── 8. A FOLLOW-UP TASK yields a CANDIDATE memory ───────────────────────
  // Start a fresh task: the just-reloaded same-conversation composer can drop
  // the first synthetic submit while its stream re-hydrates. The memory is
  // agent-scoped, so learning it in a follow-up task and recalling it cold in
  // the next one still proves cross-task memory.
  await beginNewTopic(page);
  const rememberStatus = await sendAndAwaitNewTurn(page, rememberText, 120_000);
  expect(rememberStatus).toBe('completed');

  // Extraction is an async post-turn goroutine; poll Station for the row.
  let candidateId = '';
  const extractDeadline = Date.now() + 30_000;
  while (Date.now() < extractDeadline) {
    candidateId = psql(
      `SELECT id FROM agent_memories WHERE agent_id='${AGENT_ID}' AND status='candidate' AND content LIKE '%${CODE}%' ORDER BY created_at DESC LIMIT 1`,
    );
    if (candidateId) break;
    await sleep(1_000);
  }
  expect(candidateId.length).toBeGreaterThan(0);
  // Candidate gate: before a human decision it is not retrievable/confirmed.
  const confirmedBefore = psql(
    `SELECT count(*) FROM agent_memories WHERE agent_id='${AGENT_ID}' AND status='confirmed' AND content LIKE '%${CODE}%'`,
  );
  expect(confirmedBefore).toBe('0');
  const retrievalsBefore = psql(`SELECT retrieval_count FROM agent_memories WHERE id='${candidateId}'`);
  expect(retrievalsBefore).toBe('0');

  // Human confirms through the workbench review dock (real proxy -> Station).
  if (!(await page.evaluate(`!!document.querySelector('[data-pt-memory-panel]')`))) {
    await page.click('[data-pt-workbench-add-toggle]');
    await poll(page, `!!document.querySelector('[data-pt-workbench-add="memory"]')`, 5_000);
    await page.click('[data-pt-workbench-add="memory"]');
  }
  await poll(page, `!!document.querySelector('[data-pt-memory-candidate="${candidateId}"]')`, 20_000);
  // The dock's poll-driven refresh briefly unmounts controls, and the
  // acceptance WebKit trusted click rejects the antd button. Repeatedly
  // dispatch the confirm React onClick until Station records the decision.
  let confirmedStatus = '';
  const confirmDeadline = Date.now() + 25_000;
  while (Date.now() < confirmDeadline) {
    await page.evaluate(`(() => {
      const b = document.querySelector(${JSON.stringify(`[data-pt-memory-confirm="${candidateId}"]`)});
      if (b) ['mousedown', 'mouseup', 'click'].forEach((type) =>
        b.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })));
    })()`);
    confirmedStatus = psql(`SELECT status FROM agent_memories WHERE id='${candidateId}'`);
    if (confirmedStatus === 'confirmed') break;
    await sleep(700);
  }
  expect(confirmedStatus).toBe('confirmed');

  // ── 9. SECOND task: cold recall; the confirmed memory is the only source ─
  await beginNewTopic(page);
  // Seed with the injected memory snapshot can reason for >2 minutes here;
  // the assistant node commits near completion, so allow a generous bound.
  const recallStatus = await sendAndAwaitNewTurn(page, recallText, 240_000);
  expect(recallStatus).toBe('completed');
  const recallReply = await latestAssistantText(page);

  // Station fact: the confirmed memory was retrieved for the recall turn.
  const retrieveDeadline = Date.now() + 15_000;
  let retrievalsAfter = '0';
  while (Date.now() < retrieveDeadline) {
    retrievalsAfter = psql(`SELECT retrieval_count FROM agent_memories WHERE id='${candidateId}'`);
    if (Number(retrievalsAfter) >= 1) break;
    await sleep(500);
  }
  expect(Number(retrievalsAfter)).toBeGreaterThanOrEqual(1);

  // The strong model can only know the code from the injected memory snapshot.
  const replyFlat = recallReply.toUpperCase().replace(/[^A-Z0-9]/g, '');
  expect(replyFlat).toContain(codeFlat);

  // ── Evidence ────────────────────────────────────────────────────────────
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, 'tw-o12-research-journey.png'), await page.screenshot());
  fs.writeFileSync(path.join(REPORT_DIR, 'tw-o12-research-journey.json'), JSON.stringify({
    schemaVersion: 1,
    artifactKind: 'tw-o12-native-journey',
    journeyId: 'tw-o12-research-memory',
    commit: process.env.PT_EVIDENCE_COMMIT || 'unknown',
    stationUrl: STATION_URL,
    model: 'volcengine-ark/doubao-seed (ep-20260623145021-n4xdm)',
    recordedAt: new Date().toISOString(),
    agentName: AGENT_NAME,
    agentId: AGENT_ID,
    marker,
    material: {
      objectRef,
      token: MATERIAL_TOKEN,
      proofPhrase: MATERIAL_PROOF,
      consumedIntoV1Bytes: probeHit(v1StationBody),
    },
    artifact: {
      v1: { id: v1.id, seq: seqv1 },
      v2: { id: v2.id, seq: seqv2, parent: v2Parent, origin: v2Origin, feedbackLinked: Boolean(feedbackLinked) },
      distinctHashes: v1Hash !== v2Hash,
      currentVersion: headId,
      adoptedV1,
      adoptedV2,
      reopenedAcceptedVersion: v2.id,
    },
    memoryRecall: {
      code: CODE,
      memoryId: candidateId,
      confirmedViaDock: confirmedStatus === 'confirmed',
      retrievalsBefore: Number(retrievalsBefore),
      retrievalsAfter: Number(retrievalsAfter),
      recallTurnStatus: recallStatus,
      recallReply: recallReply.slice(0, 200),
      modelEchoedCode: replyFlat.includes(codeFlat),
    },
  }, null, 2));
});
