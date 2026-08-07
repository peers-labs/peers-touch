#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const evidenceDir = path.resolve('.artifacts/applet-readiness/desktop');
const outputPath = path.join(evidenceDir, 'http-gateway-gate-output.txt');
mkdirSync(evidenceDir, { recursive: true });

const tests = [
  {
    name: 'applets create/invoke dispatch',
    filter: 'applet_commands_route_through_http_gateway_dispatch',
  },
  {
    name: 'authenticated applet context',
    filter: 'applet_http_gateway_requires_authenticated_context',
  },
];

const sections = [];
let failed = false;

for (const test of tests) {
  const result = spawnSync(
    'cargo',
    [
      'test',
      '--manifest-path',
      'apps/desktop/src-tauri/Cargo.toml',
      test.filter,
      '--',
      '--nocapture',
    ],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  if (result.status !== 0) failed = true;
  sections.push([
    `## ${test.name}`,
    `filter: ${test.filter}`,
    `status: ${result.status === 0 ? 'PASS' : 'FAIL'}`,
    result.stdout.trim(),
    result.stderr.trim(),
  ].filter(Boolean).join('\n\n'));
}

writeFileSync(outputPath, `${sections.join('\n\n---\n\n')}\n`);

if (failed) {
  process.stderr.write(`FAIL Desktop HTTP Gateway applet gate. See ${outputPath}\n`);
  process.exit(1);
}

process.stdout.write(`PASS Desktop HTTP Gateway applet gate. Evidence written to ${outputPath}\n`);
