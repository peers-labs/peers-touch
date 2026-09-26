#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createServer as createTcpServer } from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';

import {
  createDevHttpServer,
  DEV_SERVER_KIND,
} from '../../../../apps/dev/server/index.mjs';
import {
  machineDevRoot,
  repoRoot,
  workspaceIdForRoot,
} from '../../../scripts/lib/machine-dev-paths.mjs';

const require = createRequire(
  new URL('../../../../apps/desktop/package.json', import.meta.url),
);
const { chromium } = require('@playwright/test');
const fixtureWorkspaceId = workspaceIdForRoot(repoRoot);

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createTcpServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function workflowSnapshot(port) {
  return {
    kind: 'peers-touch-dev-snapshot',
    observedAt: '2026-09-26T00:00:00.000Z',
    digest: 'a'.repeat(64),
    server: {
      kind: DEV_SERVER_KIND,
      endpoint: `http://127.0.0.1:${port}`,
      startedAt: '2026-09-26T00:00:00.000Z',
      source: {
        workspaceId: fixtureWorkspaceId,
        branch: 'acceptance/fixture',
        head: '1'.repeat(40),
        dirty: true,
        workspaceDigest: `sha256:${'2'.repeat(64)}`,
      },
    },
    authority: 'machine-control-plane',
    verdict: 'HEALTHY',
    continuation: 'CONTINUE',
    findings: [],
    profiles: [
      {
        name: 'dev-one',
        agentControlMode: 'managed',
        stationUrl: 'http://127.0.0.1:18080',
        relayUrl: 'http://127.0.0.1:18081',
        sourceState: 'tracked-clean',
      },
    ],
    registrations: [
      {
        workspaceId: fixtureWorkspaceId,
        name: 'acceptance-fixture',
        branch: 'acceptance/fixture',
      },
    ],
    declarations: [],
    activeLeases: [],
    staleLeaseCount: 0,
    unregisteredObservationCount: 0,
    worktrees: [
      {
        workspaceId: fixtureWorkspaceId,
        name: 'acceptance-fixture',
        branches: ['acceptance/fixture'],
        workState: 'in-progress',
        activity: 'active',
        freshness: {
          state: 'fresh',
          lastReportedAt: '2026-09-26T00:00:00.000Z',
          stateUpdatedAt: '2026-09-26T00:00:00.000Z',
          checkedAt: '2026-09-26T00:00:00.000Z',
          derivedUpdatedAt: '2026-09-26T00:00:00.000Z',
        },
        agentActivity: {
          state: 'looping',
          lastAction: {
            actionId: 'action-1',
            operation: {
              family: 'WRITE',
              label: 'apply_patch',
              targetRef: 'apps/dev/web/app.js',
            },
            result: 'PASS',
            at: '2026-09-26T00:00:00.000Z',
            ageMs: 1000,
          },
          loopCount: 4,
          receiptCount: 7,
        },
        workflow: {
          verdict: 'HEALTHY',
          continuation: 'CONTINUE',
          stages: [
            { id: 'PRODUCT', state: 'done' },
            { id: 'DESIGN', state: 'done' },
            { id: 'PLAN', state: 'done' },
            { id: 'EXECUTE', state: 'active' },
            { id: 'DELIVER', state: 'pending' },
          ],
          plan: {
            id: 'DWF-PEERS-DEV-PRODUCT-20260926',
            status: 'active',
            progress: { completed: 3, total: 5, percentage: 60 },
          },
          task: {
            id: 'DWF-PD04-OBSERVE',
            title: 'Expose three-level progress and reduced agent activity in Peers Dev',
            segments: [
              { id: 'source', label: 'Source', state: 'done' },
              { id: 'functional', label: 'Functional', state: 'active' },
              { id: 'acceptance', label: 'Acceptance', state: 'not_required' },
              { id: 'review', label: 'Review', state: 'pending' },
            ],
          },
          session: { state: 'FUNCTIONAL_RUNNING' },
          review: { state: 'PENDING', reviewedAt: null, reviewId: 'review-1' },
          findings: [],
        },
        environmentHealth: { state: 'ready', issues: [] },
        requirements: [],
        environment: {
          profile: 'dev-one',
          slot: 1,
          agentControlMode: 'managed',
          sourceState: 'tracked-clean',
        },
        resources: {
          station: {
            url: 'http://127.0.0.1:18080',
            deployEnvironment: 'station-one',
            claims: [],
          },
          relay: {
            url: 'http://127.0.0.1:18081',
            deployEnvironment: 'relay-one',
            claims: [],
          },
          databases: [],
          other: [],
        },
        leases: [],
      },
    ],
    occupancy: [
      {
        profile: 'dev-one',
        station: 'http://127.0.0.1:18080',
        agentControlMode: 'managed',
        workspaceIds: [fixtureWorkspaceId],
        slots: [1],
        workItemIds: ['DWF-DEV-PRODUCT-PD04'],
        leaseIds: [],
        state: 'reserved',
      },
    ],
  };
}

async function assertViewport(page, endpoint, viewport, screenshot) {
  await page.setViewportSize(viewport);
  await page.goto(endpoint, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => window.__PEERS_DEV_READY__ === true);
  await page.locator(`[data-workspace-id="${fixtureWorkspaceId}"]`).waitFor();
  assert.equal(await page.locator('.stage-rail .segment').count(), 5);
  assert.equal(await page.locator('.task-segments .segment').count(), 4);
  assert.equal(
    await page.locator('[role="progressbar"]').getAttribute('aria-valuenow'),
    '60',
  );
  assert.equal(
    await page
      .locator(`[data-workspace-id="${fixtureWorkspaceId}"]`)
      .getAttribute('data-activity-state'),
    'looping',
  );
  const geometry = await page.evaluate(() => {
    const outside = [...document.querySelectorAll('body *')]
      .map((node) => ({ node, box: node.getBoundingClientRect() }))
      .filter(({ box }) =>
        box.width > 0 && (box.left < -1 || box.right > window.innerWidth + 1))
      .map(({ node, box }) => ({
        tag: node.tagName,
        className: node.className,
        left: box.left,
        right: box.right,
        text: node.textContent?.trim().slice(0, 80),
      }));
    return {
      bodyWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      overlaps: outside.some((item) =>
        String(item.className).includes('worktree')),
      outside,
    };
  });
  assert.ok(
    geometry.bodyWidth <= geometry.viewportWidth,
    JSON.stringify(geometry),
  );
  assert.equal(geometry.overlaps, false);
  await page.screenshot({ path: screenshot, fullPage: true });
}

async function main() {
  const port = await freePort();
  const endpoint = `http://127.0.0.1:${port}`;
  const identity = workflowSnapshot(port).server;
  const server = createDevHttpServer({
    envRepo: repoRoot,
    identity,
    buildSnapshot: async () => workflowSnapshot(port),
    brokerOptions: { intervalMs: 100, keepAliveMs: 500 },
  });
  const artifactRoot = path.join(
    machineDevRoot(),
    'workspaces',
    fixtureWorkspaceId,
    'workflow',
    'browser-e2e',
  );
  mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  const browser = await chromium.launch({ headless: true });
  const consoleErrors = [];
  try {
    await listen(server, port);
    const desktopContext = await browser.newContext({
      baseURL: endpoint,
      viewport: { width: 1440, height: 1000 },
    });
    const desktop = await desktopContext.newPage();
    desktop.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await assertViewport(
      desktop,
      endpoint,
      { width: 1440, height: 1000 },
      path.join(artifactRoot, 'desktop.png'),
    );
    await desktopContext.close();

    const narrowContext = await browser.newContext({
      baseURL: endpoint,
      viewport: { width: 390, height: 844 },
    });
    const narrow = await narrowContext.newPage();
    narrow.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await assertViewport(
      narrow,
      endpoint,
      { width: 390, height: 844 },
      path.join(artifactRoot, 'narrow.png'),
    );
    await narrowContext.close();

    const recoveryContext = await browser.newContext({
      baseURL: endpoint,
      viewport: { width: 390, height: 844 },
    });
    const recovery = await recoveryContext.newPage();
    let eventRequests = 0;
    let statusRequests = 0;
    await recovery.route('**/api/events', async (route) => {
      eventRequests += 1;
      if (eventRequests === 1) {
        await route.abort('connectionrefused');
        return;
      }
      await route.continue();
    });
    recovery.on('request', (request) => {
      if (request.url().endsWith('/api/status')) statusRequests += 1;
    });
    await recovery.goto(endpoint, { waitUntil: 'domcontentloaded' });
    await recovery.locator('#transport[data-state="polling"]').waitFor();
    const pollingDeadline = Date.now() + 5_000;
    while (statusRequests === 0 && Date.now() < pollingDeadline) {
      await recovery.waitForTimeout(50);
    }
    assert.ok(statusRequests > 0, 'SSE failure did not start polling');
    await recovery.locator('#transport[data-state="live"]').waitFor({
      timeout: 15_000,
    });
    assert.ok(eventRequests >= 2, 'SSE did not reconnect after the first failure');
    const requestsAtRecovery = statusRequests;
    await recovery.waitForTimeout(6_000);
    assert.equal(
      statusRequests,
      requestsAtRecovery,
      'polling continued after SSE recovered',
    );
    await recoveryContext.close();

    const disconnectContext = await browser.newContext({
      baseURL: endpoint,
      viewport: { width: 390, height: 844 },
    });
    const disconnect = await disconnectContext.newPage();
    await disconnect.route('**/api/events', (route) => route.abort());
    await disconnect.goto(endpoint, { waitUntil: 'domcontentloaded' });
    await disconnect.waitForFunction(() => window.__PEERS_DEV_READY__ === true);
    await disconnect.locator('#transport[data-state="polling"]').waitFor();
    server.snapshotBroker.close();
    await close(server);
    await disconnect.locator('#refresh').click();
    await disconnect.locator('#transport[data-state="stale"]').waitFor();
    assert.equal(
      await disconnect
        .locator(`[data-workspace-id="${fixtureWorkspaceId}"]`)
        .count(),
      1,
    );
    await disconnectContext.close();
    assert.deepEqual(consoleErrors, []);
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        viewports: ['1440x1000', '390x844'],
        screenshots: [
          '~/.peers-touch/dev/workspaces/<workspaceId>/workflow/browser-e2e/desktop.png',
          '~/.peers-touch/dev/workspaces/<workspaceId>/workflow/browser-e2e/narrow.png',
        ],
        disconnectFallback: 'PASS',
        sseRecovery: 'PASS',
      })}\n`,
    );
  } finally {
    await browser.close();
    if (server.listening) {
      server.snapshotBroker.close();
      await close(server);
    }
  }
}

await main();
