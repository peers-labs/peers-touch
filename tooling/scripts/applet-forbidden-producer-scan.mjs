#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const configPath = path.resolve('tooling/config/applet-forbidden-producer-terms.txt');
const evidenceDir = path.resolve('applet-readiness-evidence/producer-independence');
mkdirSync(evidenceDir, { recursive: true });

if (!existsSync(configPath)) {
  writeFileSync(path.join(evidenceDir, 'forbidden-producer-scan-output.txt'), 'FAIL forbidden producer term config is required.\n');
  process.exit(1);
}

const terms = readFileSync(configPath, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
if (terms.length === 0) {
  writeFileSync(path.join(evidenceDir, 'forbidden-producer-scan-output.txt'), 'FAIL forbidden producer term config must not be empty.\n');
  process.exit(1);
}

const scanRoots = [
  'applet-readiness-evidence/package',
  'apps/desktop/src/applet',
  'packages/applet-contract',
  'packages/applet-sdk',
  'tooling/scripts',
];
const result = spawnSync('rg', ['-n', '-f', configPath, ...scanRoots], { encoding: 'utf8' });
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
writeFileSync(path.join(evidenceDir, 'forbidden-producer-scan-output.txt'), output || 'PASS no forbidden producer terms found.\n');
if (result.status === 0) process.exit(1);
