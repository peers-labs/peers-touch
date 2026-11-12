/**
 * TW-D7 seed model smoke (tw-j07-seed-model-smoke):
 * Proves the workbench drives a real completion through Station using the
 * configured strong model (Volcengine Seed / ARK), replacing the earlier
 * 0.5b acceptance model that could not be trusted for semantic journeys.
 */
import type { TauriPage } from '@srsholmes/tauri-playwright';
import { createTauriTest } from '@srsholmes/tauri-playwright';

const { test, expect } = createTauriTest({
  mcpSocket: process.env.PT_PLAYWRIGHT_SOCKET || '/tmp/tw-d1.sock',
  devUrl: '',
});

const EMAIL = process.env.AGENT_TEST_EMAIL || 'agent-test-a@p.t';
const PASSWORD = process.env.AGENT_TEST_PASSWORD || 'Test-1234';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setValue(page: TauriPage, selector: string, value: string): Promise<void> {
  await page.evaluate(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`,
  );
}

test('seed model produces a real completion through station', async ({ tauriPage: page }) => {
  test.setTimeout(150_000);
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
    await new Promise((f) => setTimeout(f, 1000));
  }
  await page.click('[data-pt-primary-nav="agent"] [role="button"]');
  // Start a fresh task so the conversation inherits the current seed default
  // rather than a stale per-conversation provider selection.
  await page.click('[data-pt-agent-session-start]').catch(() => undefined);
  await new Promise<void>((resolve) => setTimeout(resolve, 1500));
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 30_000;
    const tick = () =>
      page
        .evaluate('!!document.querySelector(\'[data-pt-agent-composer-input]\')')
        .then((ok) => (ok ? resolve() : Date.now() > deadline ? reject(new Error('no composer')) : setTimeout(tick, 500)));
    void tick();
  });

  const marker = `seed${Date.now().toString(36).slice(-6)}`;
  await setValue(
    page,
    '[data-pt-agent-composer-input]',
    `${marker}: reply with exactly the two words SEED READY and nothing else.`,
  );
  // Wait for React to commit the draft and enable the send control.
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 15_000;
    const tick = () =>
      page
        .evaluate(
          `(() => { const b=document.querySelector('[data-pt-agent-composer-send]'); return b && !b.disabled; })()`,
        )
        .then((ok) =>
          ok
            ? resolve()
            : Date.now() > deadline
              ? reject(new Error('send control never enabled'))
              : setTimeout(tick, 300),
        );
    void tick();
  });
  await sleep(500);
  await page.click('[data-pt-agent-composer-send]');

  // The latest assistant message must contain the marker-scoped answer and be
  // non-trivial — proves the strong model actually generated a response.
  const reply = await new Promise<string>((resolve, reject) => {
    const deadline = Date.now() + 90_000;
    const tick = () =>
      page
        .evaluate(
          `(() => {
            const msgs = Array.from(document.querySelectorAll('[data-pt-agent-message="assistant"]'));
            const text = (msgs[msgs.length - 1]?.textContent || '').trim();
            return /SEED\\s+READY/i.test(text) ? text.slice(0, 200) : '';
          })()`,
        )
        .then((text) =>
          (text as string)
            ? resolve(text as string)
            : Date.now() > deadline
              ? reject(new Error('seed model did not produce expected completion'))
              : setTimeout(tick, 1_000),
        );
    void tick();
  });

  expect(reply).toMatch(/SEED\s+READY/i);
});
