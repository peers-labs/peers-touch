#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { validateManifest } from '../../packages/applet-contract/dist/index.js';

const packageDir = process.argv[2];

function fail(message, details = []) {
  process.stderr.write(`${['FAIL', message, ...details].join('\n')}\n`);
  process.exit(1);
}

if (!packageDir) fail('usage: pnpm applet:validate <package-dir>');

const manifestPath = path.join(packageDir, 'manifest.json');
if (!existsSync(manifestPath)) fail('missing manifest.json');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const result = validateManifest(manifest);
if (!result.valid || !result.manifest) fail('manifest validation failed', result.errors);

const errors = [];
for (const [file, expected] of Object.entries(result.manifest.integrity.files)) {
  const filePath = path.join(packageDir, file);
  if (!existsSync(filePath)) {
    errors.push(`missing integrity file: ${file}`);
    continue;
  }
  const digest = `sha256:${createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
  if (expected !== digest) errors.push(`integrity mismatch for ${file}`);
}

if (errors.length > 0) fail('package validation failed', errors);

process.stdout.write(`PASS applet package validated: ${result.manifest.id}@${result.manifest.version}\n`);
