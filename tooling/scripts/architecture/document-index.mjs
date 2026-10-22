#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverDiagramSpecs } from './diagram-render.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const REGISTRY_PATH =
  'docs/architecture/engineering/architecture-governance/architecture-modules.json';
const README_PATH = 'docs/architecture/README.md';
const REFERENCES_PATH = 'docs/architecture/references.md';
const INDEX_START = '### Active Module Index';
const INDEX_END = '## 3. 物理目录与所有权';
const MARKDOWN_LINK_PATTERN = /\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function repoPath(...parts) {
  return path.join(REPO_ROOT, ...parts);
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function read(relative) {
  return fs.readFileSync(repoPath(relative), 'utf8');
}

function write(relative, content) {
  fs.writeFileSync(repoPath(relative), content, 'utf8');
}

function escapeTable(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function markdownFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...markdownFiles(absolute));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(toPosix(path.relative(REPO_ROOT, absolute)));
    }
  }
  return files.sort();
}

function parseRegistry() {
  const registry = JSON.parse(read(REGISTRY_PATH));
  if (
    registry.kind !== 'peers-touch-architecture-module-registry'
    || !Array.isArray(registry.modules)
  ) {
    throw new Error(`${REGISTRY_PATH} is not an architecture module registry`);
  }
  return registry;
}

function diagramLink(fromDocument, diagram) {
  const relative = path.posix.relative(
    path.posix.dirname(fromDocument),
    diagram.outputPath,
  );
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function documentLink(fromDocument, targetDocument) {
  const relative = path.posix.relative(
    path.posix.dirname(fromDocument),
    targetDocument,
  );
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function renderModuleIndex(registry, diagrams) {
  const rows = [...registry.modules]
    .sort((left, right) => compareStrings(left.root, right.root))
    .map((module) => {
      const diagram = diagrams.find(
        (candidate) =>
          candidate.module === module.id
          && ['module-map', 'reuse-topology'].includes(candidate.viewpoint),
      );
      const design = `${module.root}/design.md`;
      const architecture = diagram
        ? `[${diagram.id}](${diagramLink(README_PATH, diagram)})`
        : `[design.md](${documentLink(README_PATH, design)})`;
      const taxonomy = module.root.split('/')[2] ?? 'unknown';
      const governed = `[${module.governedPaths.length}](${documentLink(
        README_PATH,
        REGISTRY_PATH,
      )})`;
      return `| \`${escapeTable(module.id)}\` | ${escapeTable(taxonomy)} | ${escapeTable(module.owner)} | ${architecture} | ${governed} |`;
    });

  return [
    INDEX_START,
    '',
    '| Module ID | Taxonomy | Owner | Primary architecture | Governed paths |',
    '|---|---|---|---|---:|',
    ...rows,
  ].join('\n');
}

function replaceGeneratedIndex(source, rendered) {
  const start = source.indexOf(INDEX_START);
  const end = source.indexOf(INDEX_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${README_PATH} is missing architecture index markers`);
  }
  return [
    source.slice(0, start).trimEnd(),
    rendered,
    source.slice(end).trimStart(),
  ].join('\n\n');
}

function resolveMarkdownTarget(sourceDocument, rawTarget) {
  const target = rawTarget.replace(/^<|>$/g, '');
  if (
    target.startsWith('#')
    || /^[a-z][a-z0-9+.-]*:/i.test(target)
  ) {
    return null;
  }
  const documentPart = target.split('#', 1)[0].split('?', 1)[0];
  if (documentPart.length === 0) return null;
  const absolute = path.resolve(
    REPO_ROOT,
    path.posix.dirname(sourceDocument),
    decodeURIComponent(documentPart),
  );
  const document = toPosix(path.relative(REPO_ROOT, absolute));
  if (document.startsWith('../') || path.isAbsolute(document)) return null;
  return document;
}

function collectReferences(files, diagrams, virtualSources = new Map()) {
  const byTarget = new Map(
    diagrams.map((diagram) => [diagram.outputPath, []]),
  );

  for (const file of files) {
    if (file === REFERENCES_PATH) continue;
    const source = virtualSources.get(file) ?? read(file);
    for (const match of source.matchAll(MARKDOWN_LINK_PATTERN)) {
      const resolved = resolveMarkdownTarget(file, match[1]);
      if (resolved === null) continue;
      if (byTarget.has(resolved)) {
        const references = byTarget.get(resolved);
        if (!references.includes(file)) references.push(file);
      }
    }
  }

  for (const references of byTarget.values()) {
    references.sort();
  }
  return byTarget;
}

function renderReferences(diagrams, references) {
  const indexRows = diagrams.map((diagram) => {
    const count = references.get(diagram.outputPath).length;
    return `| \`${diagram.id}\` | \`${diagram.module}\` | \`${diagram.viewpoint}\` | [source](${diagramLink(REFERENCES_PATH, diagram)}) | ${count} |`;
  });

  const details = diagrams.flatMap((diagram) => {
    const inbound = references.get(diagram.outputPath);
    return [
      `## \`${diagram.id}\``,
      '',
      `- Module: \`${diagram.module}\``,
      `- Viewpoint: \`${diagram.viewpoint}\``,
      `- Diagram spec: [${diagram.source}](${documentLink(
        REFERENCES_PATH,
        diagram.source,
      )})`,
      `- SVG asset: [${diagram.outputPath}](${diagramLink(
        REFERENCES_PATH,
        diagram,
      )})`,
      '- Referenced by:',
      ...(inbound.length === 0
        ? ['  - None']
        : inbound.map(
          (source) =>
            `  - [${source}](${documentLink(REFERENCES_PATH, source)})`,
        )),
      '',
    ];
  });

  return [
    '# Architecture Diagram References',
    '',
    '> Generated by `tooling/scripts/architecture/document-index.mjs`.',
    '> Do not edit this file manually.',
    '',
    'Each diagram is a standalone generated SVG asset. Only Markdown links or',
    'image embeds targeting that exact asset are counted as diagram references.',
    '',
    '## Diagram Index',
    '',
    '| Diagram ID | Module | Viewpoint | Diagram | Referenced by |',
    '|---|---|---|---|---:|',
    ...indexRows,
    '',
    ...details,
  ].join('\n');
}

export function renderArchitectureDocuments() {
  const registry = parseRegistry();
  const files = markdownFiles(repoPath('docs'));
  const diagrams = discoverDiagramSpecs();
  const readme = replaceGeneratedIndex(
    read(README_PATH),
    renderModuleIndex(registry, diagrams),
  );
  const virtualSources = new Map([[README_PATH, readme]]);
  const references = collectReferences(files, diagrams, virtualSources);
  const referenceDocument = renderReferences(diagrams, references);
  return { readme, referenceDocument };
}

function main() {
  const check = process.argv.slice(2).includes('--check');
  const unexpected = process.argv
    .slice(2)
    .filter((argument) => argument !== '--check');
  if (unexpected.length > 0) {
    throw new Error(`unsupported arguments: ${unexpected.join(', ')}`);
  }

  const rendered = renderArchitectureDocuments();
  if (check) {
    const stale = [];
    if (read(README_PATH) !== rendered.readme) stale.push(README_PATH);
    if (
      !fs.existsSync(repoPath(REFERENCES_PATH))
      || read(REFERENCES_PATH) !== rendered.referenceDocument
    ) {
      stale.push(REFERENCES_PATH);
    }
    if (stale.length > 0) {
      throw new Error(`architecture document index is stale: ${stale.join(', ')}`);
    }
    process.stdout.write('architecture document index is current\n');
    return;
  }

  write(README_PATH, rendered.readme);
  write(REFERENCES_PATH, rendered.referenceDocument);
  process.stdout.write(`${README_PATH}\n${REFERENCES_PATH}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
