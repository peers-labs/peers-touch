import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ExperienceDesignError } from './canonical.mjs';
import {
  loadGrammar,
  loadRuleCatalog,
  loadTrustedIssuers,
  validateExperienceCaseValue,
} from './schema.mjs';
import { createFixtureBundle } from './test-fixture.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const RULES_PATH = path.join(
  REPO_ROOT,
  'docs/architecture/engineering/experience-design/rules.json',
);
const GRAMMAR_PATH = path.join(
  REPO_ROOT,
  'docs/client/common/ui-identity/grammar-bindings.json',
);

function inputsFor(issuers) {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'experience-schema-'),
  );
  const issuerPath = path.join(temporaryRoot, 'issuers.json');
  fs.writeFileSync(issuerPath, `${JSON.stringify(issuers)}\n`);
  return {
    temporaryRoot,
    sources: {
      ruleCatalog: loadRuleCatalog(RULES_PATH),
      grammar: loadGrammar(GRAMMAR_PATH),
      trustedIssuers: loadTrustedIssuers(issuerPath),
    },
  };
}

function expectContractError(action, messagePattern) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof ExperienceDesignError);
    assert.equal(error.code, 'ED-CONTRACT-001');
    assert.match(error.message, messagePattern);
    return true;
  });
}

test('accepts one closed, signed, total experience case', (t) => {
  const bundle = createFixtureBundle();
  const { temporaryRoot, sources } = inputsFor(bundle.issuers);
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  const loaded = validateExperienceCaseValue(bundle.experienceCase, sources);

  assert.equal(loaded.case.id, 'fixture.positive.complete-setup');
  assert.match(loaded.digests.case, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    loaded.digests.candidate,
    bundle.experienceCase.sourceAttestations.candidate.digest,
  );
});

test('rejects unknown fields without repairing caller input', (t) => {
  const bundle = createFixtureBundle();
  bundle.experienceCase.candidate.untrustedVerdict = 'passed';
  const { temporaryRoot, sources } = inputsFor(bundle.issuers);
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  expectContractError(
    () => validateExperienceCaseValue(bundle.experienceCase, sources),
    /unknown or missing fields/,
  );
});

test('rejects empty material collections', (t) => {
  const bundle = createFixtureBundle({
    mutate: ({ contract }) => {
      contract.semantics.concepts = [];
    },
  });
  const { temporaryRoot, sources } = inputsFor(bundle.issuers);
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  expectContractError(
    () => validateExperienceCaseValue(bundle.experienceCase, sources),
    /at least 1 item/,
  );
});

test('rejects unresolved internal references', (t) => {
  const bundle = createFixtureBundle({
    mutate: ({ candidate }) => {
      candidate.copyNodes[0].surfaceId = 'surface.missing';
    },
  });
  const { temporaryRoot, sources } = inputsFor(bundle.issuers);
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  expectContractError(
    () => validateExperienceCaseValue(bundle.experienceCase, sources),
    /does not resolve/,
  );
});

test('rejects partial Journey coverage', (t) => {
  const bundle = createFixtureBundle({
    mutate: ({ contract }) => {
      contract.productIntent.journeyIds.push('journey.orphan');
    },
  });
  const { temporaryRoot, sources } = inputsFor(bundle.issuers);
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  expectContractError(
    () => validateExperienceCaseValue(bundle.experienceCase, sources),
    /journey coverage/,
  );
});

test('rejects stale signed digests', (t) => {
  const bundle = createFixtureBundle();
  bundle.experienceCase.contract.productIntent.promisedOutcome =
    'A changed unsigned outcome';
  const { temporaryRoot, sources } = inputsFor(bundle.issuers);
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  expectContractError(
    () => validateExperienceCaseValue(bundle.experienceCase, sources),
    /attestation digest is stale/,
  );
});

test('rejects mismatched attestation authors', (t) => {
  const bundle = createFixtureBundle();
  bundle.experienceCase.sourceAttestations.contract.principal =
    bundle.experienceCase.authorship.candidateAuthor;
  const { temporaryRoot, sources } = inputsFor(bundle.issuers);
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  expectContractError(
    () => validateExperienceCaseValue(bundle.experienceCase, sources),
    /attestations must match declared authors/,
  );
});

test('rejects blind holdouts that contain expectations', (t) => {
  const bundle = createFixtureBundle({ calibration: 'blind' });
  bundle.experienceCase.expected = {
    disposition: 'unproven',
    expectedRuleIds: [],
    expectedFindingIds: [],
  };
  const { temporaryRoot, sources } = inputsFor(bundle.issuers);
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  expectContractError(
    () => validateExperienceCaseValue(bundle.experienceCase, sources),
    /blind cases forbid expectations/,
  );
});

test('rejects evidence artifacts that escape the repository path', (t) => {
  const bundle = createFixtureBundle({
    mutateEvidence: ({ candidate }) => {
      candidate.evidence[0].artifact = '../outside-render.png';
    },
  });
  const { temporaryRoot, sources } = inputsFor(bundle.issuers);
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  expectContractError(
    () => validateExperienceCaseValue(bundle.experienceCase, sources),
    /normalized repository-relative path/,
  );
});
