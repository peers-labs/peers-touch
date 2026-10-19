import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ExperienceDesignError,
  canonicalDigest,
} from './canonical.mjs';
import {
  loadGrammar,
  loadRuleCatalog,
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

const sources = {
  ruleCatalog: loadRuleCatalog(RULES_PATH),
  grammar: loadGrammar(GRAMMAR_PATH),
};

function expectContractError(action, messagePattern) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof ExperienceDesignError);
    assert.equal(error.code, 'ED-CONTRACT-001');
    assert.match(error.message, messagePattern);
    return true;
  });
}

test('accepts one closed, identity-bound, total experience case', () => {
  const bundle = createFixtureBundle();

  const loaded = validateExperienceCaseValue(bundle.experienceCase, sources);
  const candidateSource = structuredClone(bundle.experienceCase.candidate);
  delete candidateSource.evidence;

  assert.equal(loaded.case.id, 'fixture.positive.complete-setup');
  assert.match(loaded.digests.case, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    loaded.digests.candidate,
    canonicalDigest(candidateSource),
  );
});

test('rejects unknown fields without repairing caller input', () => {
  const bundle = createFixtureBundle();
  bundle.experienceCase.candidate.untrustedVerdict = 'passed';

  expectContractError(
    () => validateExperienceCaseValue(bundle.experienceCase, sources),
    /unknown or missing fields/,
  );
});

test('rejects the removed source attestation shape', () => {
  const bundle = createFixtureBundle();
  bundle.experienceCase.sourceAttestations = {
    contract: {
      digest: `sha256:${'0'.repeat(64)}`,
      algorithm: 'ed25519',
      signature: 'legacy',
    },
  };

  expectContractError(
    () => validateExperienceCaseValue(bundle.experienceCase, sources),
    /unknown or missing fields/,
  );
});

test('rejects empty material collections', () => {
  const bundle = createFixtureBundle({
    mutate: ({ contract }) => {
      contract.semantics.concepts = [];
    },
  });
  expectContractError(
    () => validateExperienceCaseValue(bundle.experienceCase, sources),
    /at least 1 item/,
  );
});

test('rejects unresolved internal references', () => {
  const bundle = createFixtureBundle({
    mutate: ({ candidate }) => {
      candidate.copyNodes[0].surfaceId = 'surface.missing';
    },
  });
  expectContractError(
    () => validateExperienceCaseValue(bundle.experienceCase, sources),
    /does not resolve/,
  );
});

test('rejects partial Journey coverage', () => {
  const bundle = createFixtureBundle({
    mutate: ({ contract }) => {
      contract.productIntent.journeyIds.push('journey.orphan');
    },
  });
  expectContractError(
    () => validateExperienceCaseValue(bundle.experienceCase, sources),
    /journey coverage/,
  );
});

test('rejects expectation authors that overlap input authors', () => {
  const bundle = createFixtureBundle();
  bundle.experienceCase.authorship.expectationAuthorId =
    bundle.experienceCase.authorship.contractAuthorId;

  expectContractError(
    () => validateExperienceCaseValue(bundle.experienceCase, sources),
    /expectation author must be independent/,
  );
});

test('rejects evidence inspectors outside declared evidence authors', () => {
  const bundle = createFixtureBundle({
    mutateEvidence: ({ candidate }) => {
      candidate.evidence[0].inspectedById = 'undeclared-inspector';
    },
  });

  expectContractError(
    () => validateExperienceCaseValue(bundle.experienceCase, sources),
    /is not an evidence author/,
  );
});

test('rejects blind holdouts that contain expectations', () => {
  const bundle = createFixtureBundle({ calibration: 'blind' });
  bundle.experienceCase.expected = {
    disposition: 'unproven',
    expectedRuleIds: [],
    expectedFindingIds: [],
  };
  expectContractError(
    () => validateExperienceCaseValue(bundle.experienceCase, sources),
    /blind cases forbid expectations/,
  );
});

test('rejects evidence artifacts that escape the repository path', () => {
  const bundle = createFixtureBundle({
    mutateEvidence: ({ candidate }) => {
      candidate.evidence[0].artifact = '../outside-render.png';
    },
  });
  expectContractError(
    () => validateExperienceCaseValue(bundle.experienceCase, sources),
    /normalized repository-relative path/,
  );
});
