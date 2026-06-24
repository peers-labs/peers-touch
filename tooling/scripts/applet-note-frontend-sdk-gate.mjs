#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const appletDir = path.resolve('apps/applets/note');
const frontendDir = path.join(appletDir, 'frontend');
const evidenceDir = path.resolve('applet-readiness-evidence/official-applet');
const evidencePath = path.join(evidenceDir, 'note-frontend-sdk-gate.json');

function collectFiles(dirPath) {
  if (!existsSync(dirPath)) return [];
  const files = [];
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', '.rspeedy'].includes(entry.name)) continue;
      files.push(...collectFiles(entryPath));
      continue;
    }
    files.push(entryPath);
  }
  return files;
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.resolve(relativePath), 'utf8'));
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
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

function main() {
  const errors = [];
  const warnings = [];

  if (!existsSync(frontendDir)) {
    errors.push('missing apps/applets/note/frontend');
  }

  const packageJson = readJson('apps/applets/note/frontend/package.json');
  if (packageJson.dependencies?.['@peers-touch/applet-sdk'] !== 'workspace:*') {
    errors.push('frontend/package.json must depend on @peers-touch/applet-sdk through workspace:*');
  }

  const appletManifest = readJson('apps/applets/note/applet.manifest.json');
  const noteService = Array.isArray(appletManifest.services)
    ? appletManifest.services.find((service) => service?.id === 'note')
    : null;
  if (!noteService) {
    errors.push('applet.manifest.json must declare services[] entry for note');
  }
  if (!Array.isArray(appletManifest.permissions) || !appletManifest.permissions.includes('network.request')) {
    errors.push('applet.manifest.json must include network.request permission');
  }
  if (!Array.isArray(appletManifest.platformPermissions) || !appletManifest.platformPermissions.includes('network:service:note')) {
    errors.push('applet.manifest.json must include platform permission network:service:note');
  }

  const sourceFiles = collectFiles(path.join(frontendDir, 'src')).filter((filePath) => /\.(ts|tsx|js|jsx)$/.test(filePath));
  const scannedFiles = sourceFiles.map(relative);
  const forbiddenTerms = [
    'apps/desktop',
    'apps/mobile',
    'apps/station',
    '@tauri-apps/api',
    'NativeModules',
    'invoke(',
    'notebook_',
    'fetch(',
    'XMLHttpRequest',
    'axios',
    'baseUrl',
    'http://',
    'https://',
    'localhost',
    '127.0.0.1',
  ];

  const networkRequestFiles = [];
  for (const filePath of sourceFiles) {
    const content = readFileSync(filePath, 'utf8');
    const relativePath = relative(filePath);
    for (const term of forbiddenTerms) {
      if (content.includes(term)) {
        errors.push(`forbidden frontend term "${term}" in ${relativePath}`);
      }
    }
    if (content.includes('sdk.network.request')) {
      networkRequestFiles.push(relativePath);
    }
    if (filePath.endsWith('.tsx')) {
      const literalTextMatches = content.match(/<text\b[^>]*>\s*[^<{]*[A-Za-z\u4e00-\u9fff][^<{]*\s*<\/text>/g) ?? [];
      for (const match of literalTextMatches) {
        if (!match.includes('t(')) {
          errors.push(`hardcoded JSX text node in ${relativePath}: ${match.replace(/\s+/g, ' ').trim()}`);
        }
      }
    }
  }

  const serviceClientPath = 'apps/applets/note/frontend/src/infrastructure/capability/serviceClient.ts';
  if (networkRequestFiles.length === 0) {
    errors.push('Note frontend must call sdk.network.request through its service client');
  }
  for (const requestFile of networkRequestFiles) {
    if (requestFile !== serviceClientPath) {
      errors.push(`sdk.network.request must stay inside ${serviceClientPath}, found in ${requestFile}`);
    }
  }

  const serviceClient = readFileSync(path.resolve(serviceClientPath), 'utf8');
  if (!/sdk\.network\.request\s*\(\s*\{[\s\S]*service:\s*['"]note['"]/m.test(serviceClient)) {
    errors.push('serviceClient must call sdk.network.request with service: "note"');
  }
  for (const pathLiteral of ['/v1/notes', '/v1/notes:search']) {
    if (!serviceClient.includes(pathLiteral)) {
      errors.push(`serviceClient missing public Note service path ${pathLiteral}`);
    }
  }

  const pageSource = readFileSync(path.resolve('apps/applets/note/frontend/src/presentation/pages/NoteAppletPage.tsx'), 'utf8');
  const requiredPageKeys = [
    'note.title',
    'note.action.create',
    'note.action.search',
    'note.action.edit',
    'note.action.saveChanges',
    'note.action.restore',
    'note.action.delete',
    'note.editor.createTitle',
    'note.editor.editTitle',
    'note.editor.draftLoaded',
    'note.section.deleted',
  ];
  for (const requiredKey of requiredPageKeys) {
    if (!pageSource.includes(`t('${requiredKey}')`) && !pageSource.includes(`t("${requiredKey}")`)) {
      errors.push(`NoteAppletPage must render locale key ${requiredKey}`);
    }
  }

  const locales = ['en', 'zh-CN'].map((locale) => ({
    locale,
    messages: readJson(`apps/applets/note/frontend/locales/${locale}.json`),
  }));
  const localeKeys = new Set(Object.keys(locales[0].messages));
  for (const { locale, messages } of locales) {
    for (const key of localeKeys) {
      if (typeof messages[key] !== 'string' || messages[key].length === 0) {
        errors.push(`locale ${locale} missing non-empty key ${key}`);
      }
    }
  }
  for (const { locale, messages } of locales) {
    for (const key of Object.keys(messages)) {
      if (!localeKeys.has(key)) {
        warnings.push(`locale ${locale} has extra key ${key}`);
      }
    }
  }

  finish({
    status: errors.length === 0 ? 'PASS' : 'FAIL',
    evidenceClass: 'REAL_PRODUCT_PATH',
    appletId: appletManifest.id ?? null,
    service: 'note',
    scannedFiles,
    networkRequestFiles,
    checks: {
      sdkDependency: packageJson.dependencies?.['@peers-touch/applet-sdk'] ?? null,
      manifestServiceBinding: Boolean(noteService),
      localizedUi: errors.every((error) => !error.startsWith('hardcoded JSX text node')),
    },
    warnings,
    errors,
  });
}

try {
  main();
} catch (error) {
  finish({
    status: 'FAIL',
    evidenceClass: 'REAL_PRODUCT_PATH',
    appletId: null,
    service: 'note',
    scannedFiles: [],
    networkRequestFiles: [],
    checks: {},
    warnings: [],
    errors: [error.message],
  });
}
