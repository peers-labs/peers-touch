/**
 * TW-D4 exact-source Native journey:
 *
 *  1. The Agent writes a workspace file through a fenced device capability
 *     (manual approval), then runs a bounded command that fails (exit 1).
 *  2. A single exact edit applies real before/after bytes; the tool card
 *     renders the worker-generated unified diff and byte digests.
 *  3. The same command reruns and passes (exit 0); command success,
 *     check pass and user acceptance remain distinct facts.
 *  4. The final assistant message is claimed as an immutable artifact
 *     version; the passing command run is bound to that version as a
 *     COMMAND check (Station verifies call ownership, exit code and the
 *     persisted bounded-result digest).
 *
 * Diff/digest/command facts are additionally asserted directly against
 * Station Postgres state, never inferred from the UI alone.
 */
import { expect, test } from '@playwright/test';
import type { TauriPage } from '@srsholmes/tauri-playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
    artifactKind: 'tw-d4-native-journey',
    journeyId: id,
    commit: process.env.PT_EVIDENCE_COMMIT || 'unknown',
    stationUrl: STATION_URL,
    recordedAt: new Date().toISOString(),
    ...payload,
  }, null, 2));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function psql(query: string): Promise<string> {
  // Feed SQL over stdin: JSON.stringify turns newlines into literal "\n",
  // which psql rejects; stdin needs no shell quoting at all.
  return execSync(
    'docker exec -i pt-tw-d1-postgres-1 psql -U peers -d peers_touch_tw_d1 -t -A',
    { encoding: 'utf8', input: query },
  ).trim();
}

const poll = async <T>(page: TauriPage, fn: string, timeoutMs = 240_000, tickMs = 1_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const raw = await page.evaluate(
      `JSON.stringify((()=>{try{return (${fn})}catch(e){return {__error:String(e)}}})())`,
    );
    const value = JSON.parse(raw) as T;
    if (value && typeof value === 'object' && '__error' in value) {
      last = String((value as { __error: string }).__error);
    } else if (value !== null && value !== undefined && value !== false && value !== '') {
      return value;
    }
    await sleep(tickMs);
  }
  throw new Error(`poll timeout (${timeoutMs}ms) ${fn.slice(0, 160)} last=${last}`);
};

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

async function setValue(page: TauriPage, selector: string, value: string) {
  // The agent surface cold bootstrap can block the renderer main thread
  // long enough for the bridge's fixed 30s eval timeout to fire once.
  // Retry the cheap set instead of treating that stall as a failure.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.evaluate(
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('missing ' + ${JSON.stringify(selector)});
          const descriptor = Object.getOwnPropertyDescriptor(
            el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
            'value',
          );
          if (!descriptor || !descriptor.set) throw new Error('value setter unavailable');
          descriptor.set.call(el, ${JSON.stringify(value)});
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        })()`,
      );
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await sleep(10_000);
    }
  }
}

async function bindAndLogin(page: TauriPage): Promise<void> {
  if (await page.evaluate(
    `JSON.stringify(document.querySelectorAll('[data-pt-primary-nav]').length > 0)`,
  )) return;
  await page.click('[data-station-picker-trigger]').catch(() => undefined);
  await sleep(1_000);
  if (await page.evaluate(
    `!!document.querySelector('input[aria-label="common.stationPicker.inputLabel"]')`,
  )) {
    await setValue(page, 'input[aria-label="common.stationPicker.inputLabel"]', STATION_URL);
    await page.click('button[aria-label="common.stationPicker.addLabel"]');
    await sleep(3_000);
  }
  await page.click('[data-login-tab="email"]');
  await sleep(500);
  await page.fill('[data-login-email]', EMAIL);
  await page.fill('[data-login-password]', PASSWORD);
  await page.click('[data-login-submit]');
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await page.evaluate(
      `document.querySelectorAll('[data-pt-primary-nav]').length > 0`,
    )) return;
    const pin = await page.evaluate(
      `!!(document.querySelector('[data-login-pin-skip]') && document.querySelector('[data-login-pin-skip]').offsetParent !== null)`,
    );
    if (pin) await page.click('[data-login-pin-skip]').catch(() => undefined);
    await sleep(1_500);
  }
  throw new Error('primary shell did not appear');
}

async function gotoAgent(page: TauriPage): Promise<void> {
  await poll(page, `(() => !!document.querySelector('[data-pt-primary-nav="agent"] [role="button"]'))()`, 30_000);
  await page.click('[data-pt-primary-nav="agent"] [role="button"]');
  await poll(page, `(() => document.querySelector('[data-pt-agent-composer-input]') instanceof HTMLTextAreaElement ? 1 : null)()`, 60_000);
}

async function beginNewTopic(page: TauriPage): Promise<void> {
  await page.click('[data-pt-agent-session-start]');
  await poll(page, `(() => { const c = document.querySelector('[data-pt-agent-composer-input]'); return c instanceof HTMLTextAreaElement && c.value === '' ? 1 : null; })()`, 15_000);
}

async function sendPrompt(page: TauriPage, text: string): Promise<void> {
  await setValue(page, '[data-pt-agent-composer-input]', text);
  await page.click('[data-pt-agent-composer-send]');
}

// Approve every manual tool decision until the latest assistant message
// reaches a terminal state. Returns the terminal status.
async function approveAndSettle(
  page: TauriPage,
  timeoutMs = 240_000,
): Promise<{ status: string; approved: number }> {
  const deadline = Date.now() + timeoutMs;
  let approved = 0;
  let lastStatus = '';
  const snapshot = async (): Promise<string> =>
    page.evaluate(
      `JSON.stringify((() => {
        const msgs = Array.from(document.querySelectorAll('[data-pt-agent-message="assistant"]'));
        const statuses = msgs.map((m) => m.getAttribute('data-pt-agent-terminal-status') || '');
        const last = msgs[msgs.length - 1];
        return {
          msgs: msgs.length,
          statuses,
          lastStatus: last?.getAttribute('data-pt-agent-terminal-status') || '',
          pending: document.querySelectorAll('[data-pt-agent-tool-decision="approve"]:not([disabled])').length,
          approveButtons: document.querySelectorAll('[data-pt-agent-tool-decision="approve"]').length,
        };
      })())`,
    ) as Promise<string>;
  while (Date.now() < deadline) {
    const pendingCount = await page.evaluate(
      `document.querySelectorAll('[data-pt-agent-tool-decision="approve"]:not([disabled])').length`,
    );
    for (let i = 0; i < (pendingCount as number); i += 1) {
      try {
        await page.click('[data-pt-agent-tool-decision="approve"]:not([disabled])');
        approved += 1;
      } catch {
        // The card can disappear between query and click; the next tick retries.
      }
      await sleep(400);
    }
    const statusRaw = await page.evaluate(
      `JSON.stringify((() => {
        const msgs = Array.from(document.querySelectorAll('[data-pt-agent-message="assistant"]'));
        const last = msgs[msgs.length - 1];
        return last?.getAttribute('data-pt-agent-terminal-status') || '';
      })())`,
    );
    lastStatus = JSON.parse(statusRaw as string) as string;
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(lastStatus)) {
      // Give late-arriving approval cards a short window to drain.
      let pendingNow = 0;
      for (let i = 0; i < 8; i += 1) {
        await sleep(1_000);
        pendingNow = await page.evaluate(
          `document.querySelectorAll('[data-pt-agent-tool-decision="approve"]:not([disabled])').length`,
        ) as number;
        if (pendingNow === 0) break;
      }
      // A completed turn cannot have a pending decision: any still-enabled
      // card is stale UI, not new work.
      return { status: lastStatus, approved };
    }
    await sleep(1_000);
  }
  throw new Error(`turn did not settle within timeout; approved=${approved}; lastStatus=${lastStatus}; snapshot=${await snapshot()}`);
}

async function toolTurn(
  page: TauriPage,
  prompt: string,
  expectReady?: (page: TauriPage) => Promise<unknown>,
  attempts = 6,
): Promise<{ status: string; approved: number }> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await beginNewTopic(page);
    // Weak models respond better to short, imperative retries than to an
    // ever-growing instruction stack; rotate phrasing to break skip streaks.
    const retrySuffixes = [
      ' Emit that exact tool call now (args must be JSON strings, not objects). Do not reply before calling it; after it returns reply only: DONE.',
      ' Call the tool first, then reply DONE. Do not answer from memory.',
      ' Invoke the tool immediately with the JSON shown above. After it returns reply DONE.',
      ' Tool call required now — no preamble, no plan, no reading files first. Then reply DONE.',
      ' Use the named tool right now with the exact arguments shown. After it returns, reply DONE.',
    ];
    await sendPrompt(page, attempt === 0 ? prompt : `${prompt}${retrySuffixes[(attempt - 1) % retrySuffixes.length]}`);
    let settled: { status: string; approved: number } | null = null;
    try {
      // The 0.5b acceptance model can idle minutes between LLM legs;
      // the turn is only terminal after its final leg settles.
      settled = await approveAndSettle(page, 300_000);
      if (settled.status !== 'completed' || settled.approved === 0) {
        throw new Error(`unexpected settle ${JSON.stringify(settled)}`);
      }
      if (expectReady) {
        await expectReady(page);
      }
      return settled;
    } catch (error) {
      // Model emits wrong argument shapes or skips the call on a weak model;
      // retry on a fresh topic with diagnostics.
      console.warn(`toolTurn attempt ${attempt + 1}/${attempts} failed: ${String(error)}`);
    }
  }
  throw new Error(`tool turn failed after ${attempts} attempts: ${prompt.slice(0, 80)}`);
}

tauriTest('files/commands/diffs/checks: modify inside root, run command fail→fix→retest, bind command check to version', async ({ tauriPage: page }) => {
  tauriTest.setTimeout(3_000_000);
  await bindAndLogin(page);
  await gotoAgent(page);

  // Short lowercase token: weak tokenizers insert spaces/case breaks into
  // long uppercase base36 ids.
  const marker = `d4${Date.now().toString(36).slice(-6)}`;

  // 1. Write the initial file (approval required).
  await toolTurn(
    page,
    `Call the local_file_write tool now to create a file named ${marker}.txt with exactly this content and a trailing newline: status=fail\n`
      + `Use tool arguments path="${marker}.txt" and content="status=fail\n". Do not use any other tool.`,
  );

  // 2. Bounded command that must fail: grep for the ok marker.
  await toolTurn(
    page,
    `Call the local_shell_exec tool with exactly this arguments JSON object: `
      + `{"command":"grep","args":["status=ok","${marker}.txt"]}. `
      + `The args field is an array of plain JSON strings, never objects. `
      + `The expected exit code is 1 because the marker is absent. Do not use any other tool.`,
    async (readyPage) => {
      await poll(
        readyPage,
        `(() => {
          const tags = Array.from(document.querySelectorAll('[data-pt-tool-exit-code]'));
          return tags.some((el) => el.getAttribute('data-pt-tool-exit-code') === '1') ? 'fail-seen' : null;
        })()`,
        90_000,
      );
    },
  );

  // 3. Exact edit that changes the bytes.
  await toolTurn(
    page,
    `Call the local_file_edit tool with exactly this arguments JSON object: `
      + `{"path":"${marker}.txt","old_string":"status=fail","new_string":"status=ok"}. `
      + `The file path field is named "path". Do not use any other tool.`,
    async (readyPage) => {
      await poll(
        readyPage,
        `(() => {
          const el = document.querySelector('[data-pt-tool-diff]');
          if (!el) return null;
          const text = el.textContent || '';
          return text.includes('-status=fail') && text.includes('+status=ok') ? text : null;
        })()`,
        90_000,
      );
    },
  );
  const diffSeen = await poll(
    page,
    `(() => {
      const el = document.querySelector('[data-pt-tool-diff]');
      if (!el) return null;
      const text = el.textContent || '';
      return text.includes('-status=fail') && text.includes('+status=ok') ? text : null;
    })()`,
    30_000,
  ) as string;
  expect(diffSeen).toContain('+status=ok');

  // 4. Same command now passes.
  await toolTurn(
    page,
    `Call the local_shell_exec tool with exactly this arguments JSON object: `
      + `{"command":"grep","args":["status=ok","${marker}.txt"]}. `
      + `The args field is an array of plain JSON strings, never objects. `
      + `The expected exit code is 0. Do not use any other tool.`,
    async (readyPage) => {
      await poll(
        readyPage,
        `(() => {
          const tags = Array.from(document.querySelectorAll('[data-pt-tool-exit-code]'));
          const zero = tags.filter((el) => el.getAttribute('data-pt-tool-exit-code') === '0');
          return zero.length >= 1 ? zero.length : null;
        })()`,
        90_000,
      );
    },
  );
  const exitZeroTag = await poll(
    page,
    `(() => {
      const tags = Array.from(document.querySelectorAll('[data-pt-tool-exit-code]'));
      const zero = tags.filter((el) => el.getAttribute('data-pt-tool-exit-code') === '0');
      return zero.length >= 1 ? zero.length : null;
    })()`,
    30_000,
  ) as number;
  expect(exitZeroTag).toBeGreaterThanOrEqual(1);

  // 5. Claim the last assistant message as an artifact version. The
  // tool-call leg has an empty body and cannot back a version; the latest
  // message's more menu holds the substantive save-as-artifact entry.
  await openLatestMessageMoreMenu(page);
  await poll(
    page,
    `(() => document.querySelector('[data-pt-artifact-save-new]') ? 1 : null)()`,
    30_000,
  );
  await page.evaluate(
    `(() => {
      document.querySelector('[data-pt-artifact-save-new]')?.click();
    })()`,
  );
  await poll(page, `(() => document.querySelector('[data-pt-artifact-panel]') ? 1 : null)()`, 20_000);

  // 6. Bind the most recent passing command run as a COMMAND check.
  const passButtons = await poll(
    page,
    `(() => {
      const buttons = Array.from(document.querySelectorAll('[data-pt-command-check-pass]'));
      return buttons.length > 0 ? buttons.length : null;
    })()`,
    30_000,
  ) as number;
  expect(passButtons).toBeGreaterThanOrEqual(1);
  const lastPassSelector = await page.evaluate(
    `JSON.stringify((() => {
      const buttons = Array.from(document.querySelectorAll('[data-pt-command-check-pass]'));
      const last = buttons[buttons.length - 1];
      const id = last.getAttribute('data-pt-command-check-pass');
      return '[data-pt-command-check-pass="' + id + '"]';
    })())`,
  ).then((raw) => JSON.parse(raw) as string);
  await page.click(lastPassSelector);
  const commandCheck = await poll(
    page,
    `(() => {
      const tags = Array.from(document.querySelectorAll('[data-pt-artifact-check-type="3"]'));
      const passed = tags.find((el) => el.getAttribute('data-pt-artifact-check-result') === 'passed');
      return passed ? passed.getAttribute('data-pt-artifact-check') : null;
    })()`,
    20_000,
  ) as string;

  // ── Station facts ────────────────────────────────────────────────────
  const shellCalls = await psql(
    `SELECT c.id || '|' || c.status || '|' || COALESCE(r.status::text,'')
       FROM agent_tool_calls c LEFT JOIN agent_tool_results r ON r.tool_call_id = c.tool_call_id
      WHERE c.tool_name='local_shell_exec' AND c.created_at > now() - interval '30 minutes'
      ORDER BY c.created_at`,
  );
  const zeroCall = await psql(
    `SELECT c.id FROM agent_tool_calls c
       JOIN agent_tool_results r ON r.tool_call_id = c.tool_call_id
      WHERE c.tool_name='local_shell_exec' AND c.created_at > now() - interval '30 minutes'
        AND position('"exit_code":0' in convert_from(r.bounded_result,'UTF8')) > 0
      ORDER BY c.created_at DESC LIMIT 1`,
  );
  expect(zeroCall, 'a succeeded zero-exit shell call must exist').not.toBe('');

  const diffFacts = await psql(
    `SELECT change_type || '|' || COALESCE(length(before_sha256)::text,'') || '|' || COALESCE(length(unified_diff)::text,'') || '|' || diff_truncated
       FROM agent_turn_artifacts WHERE tool_call_id IN (
         SELECT tool_call_id FROM agent_tool_calls WHERE tool_name='local_file_edit'
           AND created_at > now() - interval '30 minutes') ORDER BY created_at DESC LIMIT 1`,
  );
  expect(diffFacts.startsWith('modified|64|')).toBe(true);
  expect(diffFacts.endsWith('|false')).toBe(true);

  const checkFacts = await psql(
    `SELECT source_tool_call_id || '|' || command || '|' || command_exit_code || '|' || length(command_output_sha)
       FROM agent_artifact_checks WHERE id='${commandCheck}'`,
  );
  expect(checkFacts).toBe(`${zeroCall}|grep|0|64`);
  // The acceptance DB has no pgcrypto; hash the persisted bounded-result
  // bytes in-process with the same sha256 the Station applies at verify.
  const persistedResultHex = await psql(
    `SELECT encode(bounded_result, 'hex') FROM agent_tool_results WHERE tool_call_id =
       (SELECT tool_call_id FROM agent_tool_calls WHERE id='${zeroCall}')`,
  );
  const persistedResultSha = createHash('sha256')
    .update(Buffer.from(persistedResultHex, 'hex'))
    .digest('hex');
  const storedCheckSha = (await psql(
    `SELECT command_output_sha FROM agent_artifact_checks WHERE id='${commandCheck}'`,
  )).trim();
  expect(storedCheckSha).toBe(persistedResultSha);

  writeEvidence('tw-d4-journey', {
    marker,
    shellCalls: shellCalls.split('\n'),
    zeroExitCall: zeroCall,
    diffFacts,
    commandCheckId: commandCheck,
    checkFacts,
    outputHashMatches: storedCheckSha === persistedResultSha,
    persistedResultSha,
    diffPreview: diffSeen.slice(0, 400),
    commandCheck,
  });
});
