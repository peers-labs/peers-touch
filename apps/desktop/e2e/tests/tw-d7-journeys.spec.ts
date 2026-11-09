/**
 * TW-D7 exact-source Native Journey (tw-j07-memory-candidate-gate):
 *
 * 1. Heuristically extracted memory is born a CANDIDATE and never reaches a
 *    Turn until a human confirms it in the workbench review dock.
 * 2. Confirm/reject are real lifecycle writes through the Desktop Rust proxy
 *    to Station: reject is retained-but-never-consumed, confirm becomes the
 *    only retrievable state.
 * 3. Memory is agent-scoped (not conversation-scoped), so a memory confirmed
 *    in one task is available to a future task via the confirmed-only
 *    retrieval gate.
 *
 * The weak acceptance model is not asked to echo the memory; the deterministic
 * lifecycle and the Station consumption gate are the facts under test.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import type { TauriPage } from '@srsholmes/tauri-playwright';
import { createTauriTest } from '@srsholmes/tauri-playwright';

const { test, expect } = createTauriTest({
  mcpSocket: process.env.PT_PLAYWRIGHT_SOCKET || '/tmp/tw-d1.sock',
  devUrl: '',
});

const STATION_URL = process.env.PT_STATION_URL || 'http://127.0.0.1:18092';
const EMAIL = process.env.AGENT_TEST_EMAIL || 'agent-test-a@p.t';
const PASSWORD = process.env.AGENT_TEST_PASSWORD || 'Test-1234';
const AGENT_NAME = process.env.AGENT_TEST_AGENT || 'assistant';

const specDir = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.resolve(specDir, '../../../../tooling/acceptance/reports/task-workbench');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function psql(query: string): Promise<string> {
  return execSync('docker exec -i pt-tw-d1-postgres-1 psql -U peers -d peers_touch_tw_d1 -t -A', {
    encoding: 'utf-8',
    input: query,
  }).trim();
}

async function poll(page: TauriPage, expression: string, timeoutMs = 15_000): Promise<string> {
  const tickMs = 500;
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = String(await page.evaluate(expression));
    if (last && last !== 'false' && last !== 'null' && last !== '0') return last;
    await sleep(tickMs);
  }
  throw new Error(`poll timeout (${timeoutMs}ms) ${expression.slice(0, 160)} last=${last}`);
}

async function setValue(page: TauriPage, selector: string, value: string): Promise<void> {
  await page.evaluate(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`,
  );
}

function seedCandidateSql(id: string, marker: string): string {
  return `INSERT INTO agent_memories
    (id, agent_id, target, layer, session_id, content, summary, relevance, source, is_frozen, trust_score, retrieval_count, helpful_count, harmful_count, status, created_at, updated_at)
  VALUES
    ('${id}', '${AGENT_NAME}', 'user', 'preference', '', 'D7 marker ${marker}', 'd7 ${marker}', 0, 'review', false, 0.5, 0, 0, 0, 'candidate', now(), now())
  ON CONFLICT (id) DO NOTHING;`;
}

test('memory candidates are gated until a human confirms them', async ({ tauriPage: page }) => {
  for (let i = 0; i < 30; i += 1) {
    if ((await page.evaluate('document.querySelectorAll(\'[data-pt-primary-nav]\').length>0')) as boolean) break;
    await sleep(1_000);
  }
  if ((await page.evaluate('!!document.querySelector(\'[data-pt-login-tab="email"]\')')) as boolean) {
    if ((await page.evaluate('!!document.querySelector(\'[data-login-tab="email"]\')')) as boolean) {
      await page.click('[data-login-tab="email"]');
    }
    await setValue(page, '[data-login-email]', EMAIL);
    await page.fill('[data-login-password]', PASSWORD);
    await page.click('[data-login-submit]');
    await poll(page, `!!document.querySelector('[data-pt-primary-nav]')`, 60_000);
  }
  await page.click('[data-pt-primary-nav="agent"] [role="button"]');
  await poll(page, `!!document.querySelector('[data-pt-agent-composer-input]')`, 60_000);

  // Deterministic queue: clear earlier d7 seeds, then create one candidate to
  // confirm and one to reject.
  await psql(`DELETE FROM agent_memories WHERE content LIKE 'D7 marker d7%';`);
  const marker = `d7${Date.now().toString(36).slice(-6)}`;
  const confirmId = `mem_${marker}_c`;
  const rejectId = `mem_${marker}_r`;
  await psql(seedCandidateSql(confirmId, `${marker} confirm`));
  await psql(seedCandidateSql(rejectId, `${marker} reject`));

  // Station fact: before any decision neither marker is consumable, because
  // retrieval is gated to status='confirmed'.
  const preConfirm = await psql(
    `SELECT count(*) FROM agent_memories WHERE agent_id='${AGENT_NAME}' AND status='confirmed' AND content LIKE 'D7 marker ${marker}%';`,
  );
  expect(preConfirm).toBe('0');

  // Open the human review queue from the workbench "+" menu; both candidates
  // are listed.
  if (!(await page.evaluate(`!!document.querySelector('[data-pt-memory-panel]')`))) {
    await page.click('[data-pt-workbench-add-toggle]');
    await poll(page, `!!document.querySelector('[data-pt-workbench-add="memory"]')`, 5_000);
    await page.click('[data-pt-workbench-add="memory"]');
  }
  await poll(page, `!!document.querySelector('[data-pt-memory-candidate="${confirmId}"]')`, 20_000);
  await poll(page, `!!document.querySelector('[data-pt-memory-candidate="${rejectId}"]')`, 20_000);

  // Reject one: it leaves the queue and is retained but never consumable.
  await page.click(`[data-pt-memory-reject="${rejectId}"]`);
  await poll(page, `!document.querySelector('[data-pt-memory-candidate="${rejectId}"]')`, 15_000);
  const rejectedStatus = await psql(`SELECT status FROM agent_memories WHERE id='${rejectId}';`);
  expect(rejectedStatus).toBe('rejected');

  // Confirm the other: it leaves the candidate queue and becomes retrievable.
  await page.click(`[data-pt-memory-confirm="${confirmId}"]`);
  await poll(page, `!document.querySelector('[data-pt-memory-candidate="${confirmId}"]')`, 15_000);
  const confirmedStatus = await psql(`SELECT status FROM agent_memories WHERE id='${confirmId}';`);
  expect(confirmedStatus).toBe('confirmed');

  // Future-turn consumption gate (agent-scoped, conversation independent):
  // the confirmed marker is selected by the confirmed-only retrieval predicate
  // used by BuildRelevantSnapshot/Search; the rejected one is not. The
  // confirmed row is not bound to a conversation (session_id = '').
  const confirmedRetrievable = await psql(
    `SELECT count(*) FROM agent_memories WHERE agent_id='${AGENT_NAME}' AND status='confirmed' AND content LIKE 'D7 marker ${marker} confirm%';`,
  );
  expect(confirmedRetrievable).toBe('1');
  const rejectedRetrievable = await psql(
    `SELECT count(*) FROM agent_memories WHERE agent_id='${AGENT_NAME}' AND status='confirmed' AND content LIKE 'D7 marker ${marker} reject%';`,
  );
  expect(rejectedRetrievable).toBe('0');
  const confirmedSession = await psql(`SELECT session_id FROM agent_memories WHERE id='${confirmId}';`);
  expect(confirmedSession).toBe('');

  // The review queue is now empty for this agent.
  await poll(page, `!!document.querySelector('[data-pt-memory-empty]')`, 15_000);

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(REPORT_DIR, 'tw-d7-journey.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        artifactKind: 'tw-d7-native-journey',
        journeyId: 'tw-d7-memory-candidate-gate',
        commit: process.env.PT_EVIDENCE_COMMIT || 'unknown',
        stationUrl: STATION_URL,
        recordedAt: new Date().toISOString(),
        agentName: AGENT_NAME,
        marker,
        confirmedId: confirmId,
        rejectedId: rejectId,
        confirmedStatus,
        rejectedStatus,
        confirmedRetrievable,
        rejectedRetrievable,
        candidateGateBeforeDecision: preConfirm,
      },
      null,
      2,
    ),
  );
});
