#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('applet-readiness-evidence/official-applet');
const evidencePath = path.join(evidenceDir, 'official-applet-skill-discovery.json');

function fileIncludes(filePath, terms) {
  if (!existsSync(filePath)) return { exists: false, missing: terms };
  const content = readFileSync(filePath, 'utf8');
  return {
    exists: true,
    missing: terms.filter((term) => !content.includes(term)),
  };
}

function finish(report) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (report.status === 'PASS') {
    process.stdout.write(output);
    return;
  }
  process.stderr.write(output);
  process.exit(1);
}

const checks = [
  {
    name: 'skill-file',
    path: 'tooling/skills/pt-official-applet-development/SKILL.md',
    terms: [
      'name: pt-official-applet-development',
      'apps/applets',
      'official applet scaffolding',
      'service binding',
      'pnpm applet:create-official',
    ],
  },
  {
    name: 'agents-registration',
    path: 'AGENTS.md',
    terms: [
      'pt-official-applet-development',
      'apps/applets',
      'applet architecture contract',
    ],
  },
  {
    name: 'runtime-readme-link',
    path: 'docs/architecture/applet-runtime/README.md',
    terms: [
      'pt-official-applet-development',
      'apps/applets',
    ],
  },
  {
    name: 'contract-link',
    path: 'docs/architecture/applet-runtime/official-applet-architecture-contract.md',
    terms: [
      'pt-official-applet-development',
      'MUST be used',
    ],
  },
];

const results = checks.map((check) => {
  const checkPath = path.resolve(check.path);
  const result = fileIncludes(checkPath, check.terms);
  return {
    name: check.name,
    path: check.path,
    exists: result.exists,
    missingTerms: result.missing,
  };
});

const errors = results.flatMap((result) => {
  const resultErrors = [];
  if (!result.exists) resultErrors.push(`missing ${result.path}`);
  for (const term of result.missingTerms) {
    resultErrors.push(`${result.path} missing term: ${term}`);
  }
  return resultErrors;
});

finish({
  status: errors.length === 0 ? 'PASS' : 'FAIL',
  evidenceClass: 'REAL_PRODUCT_PATH',
  checks: results,
  errors,
});
