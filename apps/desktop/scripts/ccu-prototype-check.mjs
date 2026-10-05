import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const portalUrl = process.env.PROTOTYPE_URL ?? 'http://localhost:3200/';
const desktopEvidence = path.join(
  repoRoot,
  'docs/architecture/domains/chat/calling/prototype/evidence/ccu-20260922',
);
const mobileEvidence = path.join(
  repoRoot,
  'docs/architecture/platform/client/mobile/prototype/evidence/ccu-20260922',
);
const manifestPath = path.join(
  repoRoot,
  'docs/architecture/domains/chat/lifecycle/prototype-evidence-ccu-20260922.json',
);

function git(...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function selectMobileScenario(page, title) {
  const combo = page.getByRole('combobox').nth(1);
  await combo.click();
  const holder = page.locator('.rc-virtual-list-holder');
  await holder.evaluate((element) => {
    element.scrollTop = 10000;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  await page.getByTitle(title, { exact: true }).click();
  await page.waitForTimeout(200);
}

async function openDesktopChat(page) {
  await page.goto(portalUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '聊天' }).click();
}

async function selectCallState(page, state) {
  await page.getByTitle('Conversation actions').click();
  await page.getByRole('button', { name: state, exact: true }).click();
  await page.waitForTimeout(150);
  requireCondition(
    await page.getByText('Stream call simulator', { exact: true }).count() === 0,
    `diagnostics menu remained open for ${state}`,
  );
}

async function run() {
  const sourceCommit = git('rev-parse', 'HEAD');
  const sourceDirtyBefore = git('status', '--porcelain').length > 0;
  mkdirSync(desktopEvidence, { recursive: true });
  mkdirSync(mobileEvidence, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const checks = [];

  try {
    await openDesktopChat(page);
    await selectCallState(page, 'ringing_all_devices');
    requireCondition(
      await page.getByText('Incoming video call on this Mac and your phone', { exact: true }).isVisible(),
      'ringing_all_devices surface is not visible',
    );
    await page.screenshot({
      path: path.join(desktopEvidence, 'ringing-all-devices.png'),
      fullPage: true,
    });
    checks.push('desktop:ringing_all_devices');

    await page.getByTitle('Accept').click();
    await page.getByRole('combobox', { name: 'Microphone device' })
      .selectOption({ label: 'Studio Display Microphone' });
    await page.getByRole('combobox', { name: 'Camera device' })
      .selectOption({ label: 'Continuity Camera' });
    requireCondition(
      await page.getByRole('combobox', { name: 'Microphone device' }).inputValue()
        === 'Studio Display Microphone',
      'microphone selection did not persist',
    );
    requireCondition(
      await page.getByRole('combobox', { name: 'Camera device' }).inputValue()
        === 'Continuity Camera',
      'camera selection did not persist',
    );
    await page.screenshot({
      path: path.join(desktopEvidence, 'active-here.png'),
      fullPage: true,
    });
    checks.push('desktop:active_here');

    await openDesktopChat(page);
    await selectCallState(page, 'ringing_all_devices');
    await page.getByRole('button', { name: 'Simulate accepted on phone', exact: true }).click();
    requireCondition(
      await page.getByText('Answered on another device', { exact: true }).isVisible(),
      'handled_elsewhere surface is not visible',
    );
    await page.screenshot({
      path: path.join(desktopEvidence, 'handled-elsewhere.png'),
      fullPage: true,
    });
    checks.push('desktop:handled_elsewhere');

    await page.setViewportSize({ width: 1024, height: 800 });
    await openDesktopChat(page);
    await selectCallState(page, 'ringing_all_devices');
    const callModal = page.getByText(
      'Incoming video call on this Mac and your phone',
      { exact: true },
    ).locator('xpath=../..');
    const modalBox = await callModal.boundingBox();
    requireCondition(
      modalBox !== null
        && modalBox.x >= 0
        && modalBox.y >= 0
        && modalBox.x + modalBox.width <= 1024
        && modalBox.y + modalBox.height <= 800,
      'narrow Desktop call modal leaves the viewport',
    );
    await page.screenshot({
      path: path.join(desktopEvidence, 'ringing-all-devices-narrow.png'),
      fullPage: true,
    });
    checks.push('desktop:ringing_all_devices_narrow');

    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(portalUrl, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /mobile\s+Mobile Prototypes/ }).click();
    await page.waitForTimeout(800);
    await selectMobileScenario(page, 'Multi-device: sender companion');
    await page.getByRole('button', { name: /projection arrives/i }).click();
    requireCondition(
      await page.getByText('evt-004', { exact: false }).count() > 0,
      'sender companion projection did not preserve event identity',
    );
    await page.screenshot({
      path: path.join(mobileEvidence, 'sender-companion.png'),
      fullPage: true,
    });
    checks.push('mobile:sender_companion');

    await selectMobileScenario(page, 'Multi-device: read cursor convergence');
    await page.getByRole('button', { name: /read messages/i }).click();
    await page.getByRole('button', { name: /cursor converges/i }).click();
    requireCondition(
      await page.getByText('monotonically non-decreasing', { exact: false }).isVisible(),
      'read cursor convergence contract is not visible',
    );
    await page.screenshot({
      path: path.join(mobileEvidence, 'read-cursor.png'),
      fullPage: true,
    });
    checks.push('mobile:read_cursor');
  } finally {
    await browser.close();
  }

  const result = {
    kind: 'peers-touch-ccu-prototype-evidence',
    schemaVersion: 1,
    sourceCommit,
    sourceDirtyBefore,
    portalUrl,
    viewport: { width: 1440, height: 1100 },
    theme: 'light',
    checks,
    screenshots: [
      'docs/architecture/domains/chat/calling/prototype/evidence/ccu-20260922/ringing-all-devices.png',
      'docs/architecture/domains/chat/calling/prototype/evidence/ccu-20260922/ringing-all-devices-narrow.png',
      'docs/architecture/domains/chat/calling/prototype/evidence/ccu-20260922/active-here.png',
      'docs/architecture/domains/chat/calling/prototype/evidence/ccu-20260922/handled-elsewhere.png',
      'docs/architecture/platform/client/mobile/prototype/evidence/ccu-20260922/sender-companion.png',
      'docs/architecture/platform/client/mobile/prototype/evidence/ccu-20260922/read-cursor.png',
    ],
    result: 'PASS',
  };
  writeFileSync(manifestPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

await run();
