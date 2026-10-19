import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const SKILLS = {
  product: 'tooling/skills/pt-product-design-methodology/SKILL.md',
  prototype: 'tooling/skills/pt-prototype-design/SKILL.md',
  quality: 'tooling/skills/pt-quality-check/SKILL.md',
};

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function assertMarkers(source, markers, context) {
  for (const marker of markers) {
    assert.ok(source.includes(marker), `${context} must cite ${marker}`);
  }
}

test('Product, Prototype, and Quality are thin canonical consumers', () => {
  const product = read(SKILLS.product);
  const prototype = read(SKILLS.prototype);
  const quality = read(SKILLS.quality);

  assertMarkers(
    product,
    [
      'docs/client/common/interaction-design-methodology.md',
      'docs/architecture/engineering/experience-design/data-model.md',
      'experience-design.mjs validate-sources',
    ],
    'Product Design',
  );
  assertMarkers(
    prototype,
    [
      'docs/client/common/interaction-design-methodology.md',
      'docs/architecture/engineering/experience-design/data-model.md',
      'experience-design.mjs validate <case.json>',
      'experience-design.mjs evaluate',
      'review-verify <review-result.json>',
      'review-admission <review-result.json>',
      'ready-for-independent-review',
      'independent review receipt',
    ],
    'Prototype Design',
  );
  assertMarkers(
    quality,
    [
      'docs/client/common/interaction-design-methodology.md',
      'experience-design.mjs check',
      'experience-design.mjs evaluate',
      'review-verify <review-result.json>',
      'review-admission <review-result.json>',
      'validate-review <case.json> <result.json> <receipt.json>',
      'ready-for-independent-review',
    ],
    'Quality Check',
  );
  for (const [name, source] of Object.entries({
    product,
    prototype,
    quality,
  })) {
    assert.doesNotMatch(
      source,
      /\bED-(?:CONTRACT|SEM|IA|PATH|STATE|ACTION|GRAMMAR|TRACE|EVIDENCE|DRIFT)-\d{3}\b/,
      `${name} Skill must not copy the Rule Catalog`,
    );
    assert.doesNotMatch(
      source,
      /"actionRoles"\s*:/,
      `${name} Skill must not copy UI Grammar`,
    );
  }
});

test('module registry exposes one evaluator capability and all consumers', () => {
  const registry = JSON.parse(
    read(
      'docs/architecture/engineering/architecture-governance/architecture-modules.json',
    ),
  );
  const module = registry.modules.find((item) => item.id === 'experience-design');
  assert.ok(module);
  const capability = module.capabilities.find(
    (item) => item.id === 'experience.design.evaluate',
  );
  assert.ok(capability);
  assert.deepEqual(
    [...capability.consumers].sort(),
    Object.values(SKILLS).sort(),
  );
  for (const governedPath of [
    'tooling/scripts/experience-design',
    ...Object.keys(SKILLS).map((key) =>
      path.posix.dirname(SKILLS[key])),
  ]) {
    assert.ok(module.governedPaths.includes(governedPath), governedPath);
  }
});

test('canonical control-plane entrypoints and sources exist', () => {
  for (const relativePath of [
    'docs/architecture/engineering/experience-design/rules.json',
    'docs/client/common/ui-identity/grammar-bindings.json',
    'tooling/scripts/experience-design/experience-design.mjs',
    'tooling/scripts/experience-design/calibration.mjs',
    'tooling/scripts/experience-design/review-receipt.mjs',
    'tooling/scripts/experience-design/holdout.mjs',
    'tooling/scripts/experience-design/review-result-schema.mjs',
    'tooling/scripts/experience-design/validator.mjs',
    'tooling/scripts/experience-design/source-fence.mjs',
  ]) {
    assert.equal(
      fs.lstatSync(path.join(REPO_ROOT, relativePath)).isFile(),
      true,
      relativePath,
    );
  }
  assert.equal(
    fs.existsSync(
      path.join(
        REPO_ROOT,
        'tooling/scripts/experience-design/experience-review.mjs',
      ),
    ),
    false,
    'ReviewResult commands must use the canonical control-plane CLI',
  );
});
