/**
 * TW-O12 exact-source Native Journey — code/services (tw-o12-ops-failfix).
 *
 * Ordinary user path (acceptance cell, real Station + real Volcengine Seed
 * model, manually approved device capabilities; no Harness state injection):
 *
 *   authorize work root (existing filesystem/shell binding)
 *     -> Seed writes a workspace file (local_file_write, approved)
 *     -> bounded check command FAILS (grep, exit 1)
 *     -> failure feedback: Seed applies an exact edit (local_file_edit);
 *        the worker-generated unified diff renders -fail/+ok
 *     -> the SAME command is re-run and PASSES (exit 0)
 *     -> final result claimed as an immutable artifact, structural + COMMAND
 *        checks pass (bound to the persisted passing bounded result), accepted
 *
 * The strong model drives every tool call; the human only approves each
 * fenced operation. Fail/pass, diff, check and acceptance facts are asserted
 * directly against Station Postgres, never inferred from the UI.
 *
 * The long-running Terminal service lifecycle and the Chrome(CDP) Browser
 * verification device legs are proven on this same source by tw-d5 and tw-d6.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { TauriPage } from '@srsholmes/tauri-playwright';
import { createTauriTest } from '@srsholmes/tauri-playwright';

const SOCKET = process.env.PT_PLAYWRIGHT_SOCKET || '/tmp/tw-d1.sock';
const STATION_URL = process.env.PT_STATION_URL || 'http://127.0.0.1:18092';
const EMAIL = process.env.AGENT_TEST_EMAIL || 'agent-test-a@p.t';
const PASSWORD = process.env.AGENT_TEST_PASSWORD || 'Test-1234';

const { test: tauriTest, expect } = createTauriTest({ mcpSocket: SOCKET, devUrl: '' });

const __dir = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.resolve(__dir, '../../../../tooling/acceptance/reports/task-workbench');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function psql(query: string): Promise<string> {
  return execSync(
    'docker exec -i pt-tw-d1-postgres-1 psql -U peers -d peers_touch_tw_d1 -t -A',
    { encoding: 'utf8', input: query },
  ).trim();
}

async function poll<T>(page: TauriPage, fn: string, timeoutMs = 240_000, tickMs = 1_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const raw = await page.evaluate<string>(
      `JSON.stringify((()=>{try{return (${fn})}catch(e){return {__error:String(e)}}})())`,
    );
    const value = JSON.parse(raw) as T | { __error: string };
    if (value && typeof value === 'object' && '__error' in value) {
      last = String((value as { __error: string }).__error);
    } else if (value !== null && value !== undefined && value !== false && value !== '') {
      return value as T;
    }
    await sleep(tickMs);
  }
  throw new Error(`poll timeout (${timeoutMs}ms) ${fn.slice(0, 160)} last=${last}`);
}

// Artifact claim entries live inside the message "more" menu; open the latest
// assistant message's menu so its probes mount into the DOM.
async function openLatestMessageMoreMenu(page: TauriPage): Promise<void> {
  await poll(page,
    `(() => {
      const triggers = Array.from(document.querySelectorAll('[data-pt-message-actions-more]'));
      if (!triggers.length) return null;
      triggers[triggers.length - 1].click();
      return 1;
    })()`,
    30_000);
  await sleep(500);
}

async function setValue(page: TauriPage, selector: string, value: string): Promise<void> {
  await page.evaluate(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('missing ' + ${JSON.stringify(selector)});
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
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
    await page.fill('[data-login-email]', EMAIL);
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
    60_000);
}

async function beginNewTopic(page: TauriPage): Promise<void> {
  await page.click('[data-pt-agent-session-start]');
  await poll(page,
    "(()=>{const c=document.querySelector('[data-pt-agent-composer-input]');return c instanceof HTMLTextAreaElement && c.value==='' ? 1 : null;})()",
    15_000);
}

// Approve every pending manual tool decision until the latest assistant
// message reaches a terminal state.
async function approveAndSettle(page: TauriPage, timeoutMs = 240_000): Promise<{ status: string; approved: number }> {
  const deadline = Date.now() + timeoutMs;
  let approved = 0;
  let lastStatus = '';
  while (Date.now() < deadline) {
    const pending = await page.evaluate<number>(
      `document.querySelectorAll('[data-pt-agent-tool-decision="approve"]:not([disabled])').length`,
    );
    for (let i = 0; i < pending; i += 1) {
      try {
        await page.click('[data-pt-agent-tool-decision="approve"]:not([disabled])');
        approved += 1;
      } catch {
        // Card can disappear between query and click; retry next tick.
      }
      await sleep(400);
    }
    lastStatus = await page.evaluate<string>(
      `JSON.stringify((() => {
        const m = Array.from(document.querySelectorAll('[data-pt-agent-message="assistant"]'));
        return m[m.length - 1]?.getAttribute('data-pt-agent-terminal-status') || '';
      })())`,
    ).then((raw) => JSON.parse(raw) as string);
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(lastStatus)) {
      for (let i = 0; i < 8; i += 1) {
        await sleep(1_000);
        const stillPending = await page.evaluate<number>(
          `document.querySelectorAll('[data-pt-agent-tool-decision="approve"]:not([disabled])').length`,
        );
        if (stillPending === 0) break;
      }
      return { status: lastStatus, approved };
    }
    await sleep(1_000);
  }
  throw new Error(`turn did not settle; approved=${approved} last=${lastStatus}`);
}

async function toolTurn(page: TauriPage, prompt: string, expectReady?: (p: TauriPage) => Promise<unknown>): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await beginNewTopic(page);
    await setValue(page, '[data-pt-agent-composer-input]', attempt === 0 ? prompt : `${prompt} Invoke that exact tool call now with the JSON args given; after it returns reply only DONE.`);
    await page.click('[data-pt-agent-composer-send]');
    try {
      const settled = await approveAndSettle(page, 240_000);
      if (settled.status !== 'completed' || settled.approved === 0) {
        throw new Error(`unexpected settle ${JSON.stringify(settled)}`);
      }
      if (expectReady) await expectReady(page);
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      // eslint-disable-next-line no-console
      console.warn(`toolTurn ${attempt + 1}/3 failed: ${String(error)}`);
    }
  }
}

tauriTest.describe.configure({ mode: 'serial' });

tauriTest('TW-O12 ops: file write, failing check, feedback edit/diff, retest pass, checked+accepted', async ({ tauriPage }) => {
  tauriTest.setTimeout(1_800_000);
  const page = tauriPage as unknown as TauriPage;
  const marker = `o12${Date.now().toString(36).slice(-6)}`;

  await bindAndLogin(page);
  await gotoAgent(page);

  // 1. Seed writes the initial file (approved, inside the granted root).
  await toolTurn(page,
    `Call the local_file_write tool now with exactly this arguments JSON object: `
    + `{"path":"${marker}.txt","content":"status=fail\\n"}. Do not use any other tool. After it returns reply only DONE.`);

  // 2. Bounded check that must fail: grep for the absent ok marker (exit 1).
  await toolTurn(page,
    `Call the local_shell_exec tool with exactly this arguments JSON object: `
    + `{"command":"grep","args":["status=ok","${marker}.txt"]}. The args field is an array of JSON strings. `
    + `The expected exit code is 1 because the marker is absent. Do not use any other tool.`,
    async (p) => poll(p,
      `(() => {
        const tags = Array.from(document.querySelectorAll('[data-pt-tool-exit-code]'));
        return tags.some((el) => el.getAttribute('data-pt-tool-exit-code') === '1') ? 'fail-seen' : null;
      })()`,
      90_000),
  );

  // 3. Failure feedback -> exact fix; the diff must render -fail/+ok.
  await toolTurn(page,
    `The check failed because ${marker}.txt contains status=fix placeholder set to fail. `
    + `Call the local_file_edit tool with exactly this arguments JSON object to fix it: `
    + `{"path":"${marker}.txt","old_string":"status=fail","new_string":"status=ok"}. Do not use any other tool.`,
    async (p) => poll(p,
      `(() => {
        const el = document.querySelector('[data-pt-tool-diff]');
        const text = el?.textContent || '';
        return text.includes('-status=fail') && text.includes('+status=ok') ? text : null;
      })()`,
      90_000),
  );
  const diffSeen = await poll<string>(page,
    `(() => {
      const el = document.querySelector('[data-pt-tool-diff]');
      const text = el?.textContent || '';
      return text.includes('-status=fail') && text.includes('+status=ok') ? text : '';
    })()`,
    30_000);
  expect(diffSeen).toContain('+status=ok');

  // 4. Same check re-run after the fix -> exit 0.
  await toolTurn(page,
    `Now verify the fix: call the local_shell_exec tool with exactly this arguments JSON object: `
    + `{"command":"grep","args":["status=ok","${marker}.txt"]}. The expected exit code is 0. Do not use any other tool.`,
    async (p) => poll(p,
      `(() => {
        const zero = Array.from(document.querySelectorAll('[data-pt-tool-exit-code]'))
          .filter((el) => el.getAttribute('data-pt-tool-exit-code') === '0');
        return zero.length >= 1 ? zero.length : null;
      })()`,
      90_000),
  );

  // 5. Claim the substantive final message as an immutable artifact.
  await openLatestMessageMoreMenu(page);
  await poll(page,
    `(() => document.querySelector('[data-pt-artifact-save-new]') ? 1 : null)()`,
    30_000);
  await page.evaluate(
    `(() => {
      document.querySelector('[data-pt-artifact-save-new]')?.click();
    })()`,
  );
  const versionId = await poll<string>(page,
    `(() => document.querySelector('[data-pt-artifact-panel]')?.getAttribute('data-pt-artifact-version') || null)()`,
    30_000);
  expect(versionId.length).toBeGreaterThan(0);

  // 6. Structural check, then bind the passing command run as a COMMAND check,
  // then accept. Re-issue native clicks until the panel reflects each result
  // (antd controls occasionally swallow a single dispatched click).
  await poll(page,
    `(() => {
      const hits = Array.from(document.querySelectorAll('[data-pt-artifact-check-result]'))
        .filter((el) => el.closest('[data-pt-artifact-panel]')
          && el.getAttribute('data-pt-artifact-check-result') === 'passed');
      if (hits.length >= 1) return 1;
      document.querySelector('[data-pt-artifact-panel] [data-pt-artifact-check-structural]')?.click();
      return null;
    })()`,
    20_000, 1_000);
  // Human review must also pass before acceptance persists.
  await poll(page,
    `(() => {
      const n = Array.from(document.querySelectorAll('[data-pt-artifact-check-result]'))
        .filter((el) => el.closest('[data-pt-artifact-panel]')
          && el.getAttribute('data-pt-artifact-check-result') === 'passed').length;
      if (n >= 2) return n;
      document.querySelector('[data-pt-artifact-panel] [data-pt-artifact-check-human-pass]')?.click();
      return null;
    })()`,
    15_000, 1_000);
  const commandCheckId = await poll<string>(page,
    `(() => {
      const passed = Array.from(document.querySelectorAll('[data-pt-artifact-check-type="3"]'))
        .find((el) => el.getAttribute('data-pt-artifact-check-result') === 'passed');
      if (passed) return passed.getAttribute('data-pt-artifact-check');
      const buttons = Array.from(document.querySelectorAll('[data-pt-command-check-pass]'));
      buttons[buttons.length - 1]?.click();
      return null;
    })()`,
    30_000, 1_000);
  expect(commandCheckId.length).toBeGreaterThan(0);
  await poll(page,
    `(() => {
      if (document.querySelector('[data-pt-artifact-accepted]')) return 1;
      document.querySelector('[data-pt-artifact-panel] [data-pt-artifact-accept]')?.click();
      return null;
    })()`,
    15_000, 1_000);

  // ── Station facts ───────────────────────────────────────────────────────
  const failCall = await psql(
    `SELECT c.id FROM agent_tool_calls c JOIN agent_tool_results r ON r.tool_call_id=c.tool_call_id
      WHERE c.tool_name='local_shell_exec' AND position('"exit_code":1' in convert_from(r.bounded_result,'UTF8')) > 0
        AND c.created_at > now() - interval '30 minutes' ORDER BY c.created_at DESC LIMIT 1`);
  const passCall = await psql(
    `SELECT c.id FROM agent_tool_calls c JOIN agent_tool_results r ON r.tool_call_id=c.tool_call_id
      WHERE c.tool_name='local_shell_exec' AND position('"exit_code":0' in convert_from(r.bounded_result,'UTF8')) > 0
        AND c.created_at > now() - interval '30 minutes' ORDER BY c.created_at DESC LIMIT 1`);
  expect(failCall.length).toBeGreaterThan(0);
  expect(passCall.length).toBeGreaterThan(0);
  expect(passCall).not.toBe(failCall);

  const diffFacts = await psql(
    `SELECT change_type || '|' || COALESCE(length(before_sha256)::text,'') || '|' || COALESCE(length(unified_diff)::text,'') || '|' || diff_truncated
       FROM agent_turn_artifacts WHERE tool_call_id IN (
         SELECT tool_call_id FROM agent_tool_calls WHERE tool_name='local_file_edit'
           AND created_at > now() - interval '30 minutes') ORDER BY created_at DESC LIMIT 1`);
  expect(diffFacts.startsWith('modified|64|')).toBe(true);
  expect(diffFacts.endsWith('|false')).toBe(true);

  const checkFacts = await psql(
    `SELECT source_tool_call_id || '|' || command || '|' || command_exit_code || '|' || length(command_output_sha)
       FROM agent_artifact_checks WHERE id='${commandCheckId}'`);
  expect(checkFacts).toBe(`${passCall}|grep|0|64`);
  const persistedResultHex = await psql(
    `SELECT encode(bounded_result,'hex') FROM agent_tool_results
      WHERE tool_call_id=(SELECT tool_call_id FROM agent_tool_calls WHERE id='${passCall}')`);
  const persistedResultSha = createHash('sha256').update(Buffer.from(persistedResultHex, 'hex')).digest('hex');
  const storedCheckSha = (await psql(
    `SELECT command_output_sha FROM agent_artifact_checks WHERE id='${commandCheckId}'`)).trim();
  expect(storedCheckSha).toBe(persistedResultSha);

  const accepted = await psql(
    `SELECT CASE WHEN EXISTS (SELECT 1 FROM agent_artifact_acceptances WHERE version_id='${versionId}') THEN 'accepted' ELSE 'missing' END`);
  const headVersion = await psql(
    `SELECT current_version FROM agent_logical_artifacts WHERE id=(SELECT artifact_id FROM agent_artifact_versions WHERE id='${versionId}')`);
  expect(accepted).toBe('accepted');
  expect(headVersion).toBe(versionId);

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, 'tw-o12-ops-journey.png'), await page.screenshot());
  fs.writeFileSync(path.join(REPORT_DIR, 'tw-o12-ops-journey.json'), JSON.stringify({
    schemaVersion: 1,
    artifactKind: 'tw-o12-native-journey',
    journeyId: 'tw-o12-ops-failfix',
    commit: process.env.PT_EVIDENCE_COMMIT || 'unknown',
    stationUrl: STATION_URL,
    model: 'volcengine-ark/doubao-seed (ep-20260623145021-n4xdm)',
    recordedAt: new Date().toISOString(),
    marker,
    failCallId: failCall,
    passCallId: passCall,
    distinctFailThenPass: passCall !== failCall,
    diffFacts,
    diffPreview: diffSeen.slice(0, 300),
    commandCheckId,
    checkFacts,
    outputHashMatches: storedCheckSha === persistedResultSha,
    artifact: { versionId, accepted, currentVersion: headVersion },
  }, null, 2));
});
