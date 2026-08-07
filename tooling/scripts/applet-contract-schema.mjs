#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { APPLET_CONTRACT_JSON_SCHEMA } from '../../packages/applet-contract/dist/index.js';

const output = resolve(import.meta.dirname, '../../packages/applet-contract/dist/applet-contract.schema.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(APPLET_CONTRACT_JSON_SCHEMA, null, 2)}\n`);
const evidenceOutput = resolve(import.meta.dirname, '../../.artifacts/applet-readiness/contract/schema-generation-output.txt');
const message = `PASS applet contract schema generated: ${output}\n`;
mkdirSync(dirname(evidenceOutput), { recursive: true });
writeFileSync(evidenceOutput, message);
process.stdout.write(message);
