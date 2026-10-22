#!/usr/bin/env node
// Build-time generator for the architecture diagram readers.
//
// Source of truth:  apps/official-site/architecture/<slug>.<locale>.json
//                   (archify candidate JSON, authored and reviewed in git)
// Generated output: apps/official-site/public/architecture-assets/<slug>.<locale>.html
//                   (self-contained readers, gitignored; Astro copies public/ into dist/)
//
// The standalone HTML readers are deliberately NOT committed: they are large
// generated artifacts (~0.8MB each) produced by the vendored archify renderer.
// This script runs before `astro build` and can also be run directly:
//   node tools/render-architecture.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const sourceDir = join(appRoot, 'architecture');
const outputDir = join(appRoot, 'public', 'architecture-assets');
const archifyBin = join(appRoot, 'tools', 'archify', 'bin', 'archify.mjs');

const SLUGS = [
  'product-world',
  'architecture',
  'desktop-center',
  'mobile-center',
  'station-center',
  'federation-center',
  'connectivity',
  'authority',
  'agent-execution',
  'applet-runtime',
  'contracts',
  'deployment',
  'journey-access-route',
  'journey-same-station',
  'journey-device-messaging',
  'journey-federation-governance',
  'journey-cross-station',
  'journey-agent-execution',
];
const LOCALES = ['en', 'zh'];

// The authored candidates carry source-evidence anchors pinned to a specific
// repository revision. Those revisions are not present in every build
// environment (and never in immutable historical builds), while the website
// readers present the diagrams rather than run evidence verification. Strip
// evidence so the renderer is pure and deterministic at build time.
function stripEvidence(node) {
  if (Array.isArray(node)) return node.map(stripEvidence);
  if (node && typeof node === 'object') {
    const dropped = new Set([
      'sources',
      'source',
      'repository',
      'revision',
      'evidence',
      'sourceRefs',
    ]);
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => !dropped.has(key))
        .map(([key, value]) => [key, stripEvidence(value)]),
    );
  }
  return node;
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
const tmpDir = mkdtempSync(join(tmpdir(), 'archify-candidates-'));

let rendered = 0;
try {
  const supportedTypes = new Set([
    'architecture',
    'sequence',
    'workflow',
    'dataflow',
    'lifecycle',
  ]);
  for (const locale of LOCALES) {
    for (const slug of SLUGS) {
      const candidate = JSON.parse(
        readFileSync(join(sourceDir, `${slug}.${locale}.json`), 'utf8'),
      );
      const diagramType = candidate.diagram_type || 'architecture';
      if (!supportedTypes.has(diagramType)) {
        throw new Error(
          `${slug}.${locale}.json uses unsupported diagram_type: ${diagramType}`,
        );
      }
      const sanitizedPath = join(tmpDir, `${slug}.${locale}.json`);
      writeFileSync(sanitizedPath, JSON.stringify(stripEvidence(candidate)));
      execFileSync(
        process.execPath,
        [
          archifyBin,
          'render',
          diagramType,
          sanitizedPath,
          join(outputDir, `${slug}.${locale}.html`),
          '--quality',
          'showcase',
        ],
        { stdio: ['ignore', 'ignore', 'inherit'] },
      );
      rendered += 1;
    }
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

console.log(
  `rendered ${rendered} architecture readers -> public/architecture-assets`,
);
