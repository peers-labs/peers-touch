import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { renderArchitectureDocuments } from './document-index.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

function read(relative) {
  return fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

test('architecture module index and reverse references are current', () => {
  const rendered = renderArchitectureDocuments();

  assert.equal(read('docs/architecture/README.md'), rendered.readme);
  assert.equal(
    read('docs/architecture/references.md'),
    rendered.referenceDocument,
  );
  assert.match(rendered.readme, /cross-client-runtime\.reuse-topology/);
  assert.match(rendered.readme, /cross-client-runtime\/architecture\.svg/);
  assert.match(rendered.referenceDocument, /project\.system-context/);
  assert.match(rendered.referenceDocument, /project\.logical-layered-architecture/);
  assert.match(rendered.referenceDocument, /project\.runtime-topology/);
  assert.match(rendered.referenceDocument, /project\.authority-map/);
  assert.match(rendered.referenceDocument, /project\.journey\.cross-station/);
  assert.match(rendered.referenceDocument, /project\.engineering-control-plane/);
  assert.match(rendered.referenceDocument, /architecture\.diagram\.json/);
  assert.doesNotMatch(rendered.referenceDocument, /explicit stable diagram anchor/);
});
