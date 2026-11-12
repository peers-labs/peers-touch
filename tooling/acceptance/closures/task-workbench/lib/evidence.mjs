// Shared JSON evidence writer for task-workbench native closures.
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

export function gitRev(root) {
  try {
    return execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
  } catch {
    return 'unknown';
  }
}

export function writeReport(filePath, report) {
  const enriched = {
    ran_at: new Date().toISOString(),
    mode: 'desktop-native-headless-gateway',
    ...report,
  };
  mkdirSync(new URL('.', new URL(`file://${filePath}`)).pathname, { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(enriched, null, 2)}\n`);
  return enriched;
}

export class CheckCollector {
  constructor() {
    this.results = [];
  }

  record(id, pass, evidence) {
    this.results.push({ id, pass: !!pass, evidence: String(evidence ?? '') });
    const mark = pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`${mark} ${id} — ${evidence}`);
  }

  get passCount() {
    return this.results.filter((r) => r.pass).length;
  }

  get failCount() {
    return this.results.filter((r) => !r.pass).length;
  }
}
