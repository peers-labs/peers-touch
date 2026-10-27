import fs from 'node:fs';
import path from 'node:path';

import { canonicalDigest } from './canonical.mjs';

const TS = '2026-10-22T03:00:00.000Z';

function fact(alias, suffix, stateId, fields) {
  return {
    id: `fact.${alias}.${suffix}`,
    stateId,
    statement: fields.statement,
    evidenceIds: [`evidence.${alias}.dynamic`],
    ...(fields.visibleAction === undefined
      ? {}
      : { visibleAction: fields.visibleAction }),
    ...(fields.visibleResponse === undefined
      ? {}
      : { visibleResponse: fields.visibleResponse }),
  };
}

function observation(alias, { successful }) {
  const legId = `leg.${alias}`;
  if (!successful) {
    const entryId = `state.${alias}.entry`;
    const failureId = `state.${alias}.failure`;
    return {
      kind: 'peers-touch-journey-observation',
      schemaVersion: 1,
      id: legId,
      journeyId: 'journey.compare',
      blindedAlias: alias,
      authoredById: `author.observation.${alias}`,
      evidenceAuthorIds: [`author.evidence.${alias}`],
      contextDigest: '',
      evidenceLedgerDigest: '',
      facts: [
        fact(alias, 'act', entryId, {
          statement: 'The user starts the bounded task.',
          visibleAction: 'Start task',
        }),
        fact(alias, 'fail', failureId, {
          statement: 'The task ends in a visible failure.',
          visibleResponse: 'Task failed without recovery',
        }),
      ],
      states: [
        {
          id: entryId,
          kind: 'entry',
          contextId: 'context.task',
          ordinal: 0,
          visibleMeaning: 'Ready to start',
          inScope: true,
        },
        {
          id: failureId,
          kind: 'failure',
          contextId: 'context.task',
          ordinal: 1,
          visibleMeaning: 'The requested outcome is blocked',
          inScope: true,
        },
      ],
      edges: [{
        id: `edge.${alias}.fail`,
        fromStateId: entryId,
        toStateId: failureId,
        actionFactId: `fact.${alias}.act`,
        responseFactId: `fact.${alias}.fail`,
      }],
      observedActions: [{
        id: `action.${alias}.start`,
        edgeId: `edge.${alias}.fail`,
        mutation: 'none',
        decisionCost: 1,
        interruption: 'none',
      }],
      recoveryObservations: [{
        sourceStateId: failureId,
        entryActionVisible: false,
        preservedState: [],
        evidenceIds: [`evidence.${alias}.dynamic`],
      }],
      primaryPathEdgeIds: [`edge.${alias}.fail`],
      evidenceIds: [
        `evidence.${alias}.contract`,
        `evidence.${alias}.dynamic`,
      ],
    };
  }

  const entryId = `state.${alias}.entry`;
  const recoveryId = `state.${alias}.recovery`;
  const successId = `state.${alias}.success`;
  return {
    kind: 'peers-touch-journey-observation',
    schemaVersion: 1,
    id: legId,
    journeyId: 'journey.compare',
    blindedAlias: alias,
    authoredById: `author.observation.${alias}`,
    evidenceAuthorIds: [`author.evidence.${alias}`],
    contextDigest: '',
    evidenceLedgerDigest: '',
    facts: [
      fact(alias, 'act', entryId, {
        statement: 'The user starts the bounded task.',
        visibleAction: 'Start task',
      }),
      fact(alias, 'recover', recoveryId, {
        statement: 'The system keeps the task recoverable.',
        visibleResponse: 'Recovery action remains available',
      }),
      fact(alias, 'continue', recoveryId, {
        statement: 'The user continues from recovery.',
        visibleAction: 'Continue',
      }),
      fact(alias, 'success', successId, {
        statement: 'The requested outcome is visibly complete.',
        visibleResponse: 'Task completed',
      }),
    ],
    states: [
      {
        id: entryId,
        kind: 'entry',
        contextId: 'context.task',
        ordinal: 0,
        visibleMeaning: 'Ready to start',
        inScope: true,
      },
      {
        id: recoveryId,
        kind: 'recovery',
        contextId: 'context.task',
        ordinal: 1,
        visibleMeaning: 'Work is preserved and can continue',
        inScope: true,
      },
      {
        id: successId,
        kind: 'success',
        contextId: 'context.task',
        ordinal: 2,
        visibleMeaning: 'The requested outcome is complete',
        inScope: true,
      },
    ],
    edges: [
      {
        id: `edge.${alias}.recover`,
        fromStateId: entryId,
        toStateId: recoveryId,
        actionFactId: `fact.${alias}.act`,
        responseFactId: `fact.${alias}.recover`,
      },
      {
        id: `edge.${alias}.success`,
        fromStateId: recoveryId,
        toStateId: successId,
        actionFactId: `fact.${alias}.continue`,
        responseFactId: `fact.${alias}.success`,
      },
    ],
    observedActions: [
      {
        id: `action.${alias}.start`,
        edgeId: `edge.${alias}.recover`,
        mutation: 'none',
        decisionCost: 0,
        interruption: 'none',
      },
      {
        id: `action.${alias}.continue`,
        edgeId: `edge.${alias}.success`,
        mutation: 'none',
        decisionCost: 0,
        interruption: 'none',
      },
    ],
    recoveryObservations: [{
      sourceStateId: recoveryId,
      entryActionVisible: true,
      preservedState: ['state.user-work'],
      returnStateId: successId,
      evidenceIds: [`evidence.${alias}.dynamic`],
    }],
    primaryPathEdgeIds: [
      `edge.${alias}.recover`,
      `edge.${alias}.success`,
    ],
    evidenceIds: [
      `evidence.${alias}.contract`,
      `evidence.${alias}.dynamic`,
    ],
  };
}

function evidenceLedger(alias) {
  return {
    kind: 'peers-touch-comparison-evidence-ledger',
    schemaVersion: 1,
    id: `ledger.${alias}`,
    legId: `leg.${alias}`,
    authoredByIds: [`author.evidence.${alias}`],
    records: [
      {
        id: `evidence.${alias}.contract`,
        level: 'L1_CONTRACT',
        status: 'observed',
        claimIds: ['outcome.complete', 'outcome.recoverable'],
        sourceDigest: `sha256:${alias === 'A' ? '1' : '2'}${'0'.repeat(63)}`,
      },
      {
        id: `evidence.${alias}.dynamic`,
        level: 'L3_DYNAMIC',
        status: 'observed',
        claimIds: ['outcome.complete', 'outcome.recoverable'],
        sourceDigest: `sha256:${alias === 'A' ? '3' : '4'}${'0'.repeat(63)}`,
        artifact: `computer:///tmp/cer-${alias}.json`,
        artifactDigest: `sha256:${alias === 'A' ? '5' : '6'}${'0'.repeat(63)}`,
        inspectedById: `author.evidence.${alias}`,
        observedAt: TS,
      },
    ],
  };
}

function evaluation(alias, { successful, unproven }) {
  const outcome = unproven ? 'unproven' : successful ? 'met' : 'not-met';
  const recovery = unproven ? 'unproven' : successful ? 'met' : 'not-met';
  function result(id, assertionId, value) {
    return {
      id,
      assertionId,
      result: value,
      factIds:
        value === 'unproven'
          ? []
          : successful
            ? [`fact.${alias}.${assertionId === 'outcome.complete' ? 'success' : 'recover'}`]
            : [`fact.${alias}.fail`],
      evidenceIds:
        value === 'unproven' ? [] : [`evidence.${alias}.dynamic`],
      rationale:
        value === 'unproven'
          ? 'Required dynamic evidence is unavailable.'
          : value === 'met'
            ? 'Observed facts satisfy the Oracle assertion.'
            : 'Observed facts contradict the Oracle assertion.',
    };
  }
  return {
    kind: 'peers-touch-oracle-evaluation',
    schemaVersion: 1,
    id: `evaluation.${alias}`,
    legId: `leg.${alias}`,
    blindedAlias: alias,
    oracleDigest: '',
    contextDigest: '',
    observationDigest: '',
    evidenceLedgerDigest: '',
    authorId: `author.evaluation.${alias}`,
    results: [
      result(`result.${alias}.complete`, 'outcome.complete', outcome),
      result(`result.${alias}.recoverable`, 'outcome.recoverable', recovery),
    ],
  };
}

function legReview(alias, evaluationValue) {
  const hasUnproven = evaluationValue.results.some(
    (result) => result.result === 'unproven',
  );
  return {
    kind: 'peers-touch-comparison-leg-review',
    schemaVersion: 1,
    legId: `leg.${alias}`,
    evaluationDigest: '',
    reviewerId: `reviewer.leg.${alias}`,
    reviewedAt: TS,
    decision: hasUnproven ? 'unproven' : 'accepted',
    reviewNotes: [],
    reviewerFindings: [],
  };
}

export function createComparativeFixture({
  successfulA = false,
  successfulB = true,
  unprovenA = false,
  unprovenB = false,
} = {}) {
  const comparisonContext = {
    kind: 'peers-touch-comparison-context',
    schemaVersion: 1,
    id: 'context.compare',
    journeyId: 'journey.compare',
    actorArchetype: 'A returning knowledge worker',
    startingState: 'Signed in with the same task data',
    taskPrompt: 'Complete the bounded task and recover if it fails.',
    platform: 'desktop',
    locale: 'en-US',
    viewport: {
      widthCssPx: 1440,
      heightCssPx: 900,
      devicePixelRatio: 2,
    },
    inputMode: 'keyboard-and-pointer',
    dataFixtureDigest: `sha256:${'a'.repeat(64)}`,
    accountState: 'Standard paid account with matching permissions',
    capabilityAvailability: ['capability.compare'],
    networkProfile: 'stable-50ms',
    timeBudgetMs: 30000,
  };
  const oracle = {
    kind: 'peers-touch-outcome-oracle',
    schemaVersion: 1,
    id: 'oracle.compare',
    journeyId: 'journey.compare',
    productThesisDigest: `sha256:${'b'.repeat(64)}`,
    comparisonContextDigest: '',
    assertions: [
      {
        id: 'outcome.complete',
        promisedOutcome: 'The user visibly completes the bounded task.',
        criticality: 'blocking',
        observableStateKinds: ['success'],
        requiredEvidenceLevels: ['L3_DYNAMIC'],
        disallowedSubstitutes: ['A static screenshot of the entry state'],
      },
      {
        id: 'outcome.recoverable',
        promisedOutcome: 'Failure preserves work and exposes recovery.',
        criticality: 'required',
        observableStateKinds: ['recovery'],
        requiredEvidenceLevels: ['L3_DYNAMIC'],
        disallowedSubstitutes: ['Close and reopen without preserved state'],
      },
    ],
    authoredById: 'author.oracle',
    frozenAt: TS,
  };
  const observations = {
    A: observation('A', { successful: successfulA }),
    B: observation('B', { successful: successfulB }),
  };
  const evidenceLedgers = {
    A: evidenceLedger('A'),
    B: evidenceLedger('B'),
  };
  const evaluations = {
    A: evaluation('A', { successful: successfulA, unproven: unprovenA }),
    B: evaluation('B', { successful: successfulB, unproven: unprovenB }),
  };
  const legReviews = {
    A: legReview('A', evaluations.A),
    B: legReview('B', evaluations.B),
  };
  const pair = {
    kind: 'peers-touch-paired-experience-case',
    schemaVersion: 1,
    id: 'pair.compare',
    journeyId: 'journey.compare',
    oracle: { path: 'oracle.json', digest: '' },
    comparisonContext: { path: 'comparison-context.json', digest: '' },
    legs: ['A', 'B'].map((alias) => ({
      id: `leg.${alias}`,
      blindedAlias: alias,
      sourceKind: 'prototype',
      observation: {
        path: `legs/${alias}/journey-observation.json`,
        digest: '',
      },
      evidenceLedger: {
        path: `legs/${alias}/evidence-ledger.json`,
        digest: '',
      },
      oracleEvaluation: {
        path: `legs/${alias}/oracle-evaluation.json`,
        digest: '',
      },
      legReview: {
        path: `legs/${alias}/leg-review.json`,
        digest: '',
      },
    })),
    pairingAuthorId: 'author.pairing',
  };
  return {
    oracle,
    comparisonContext,
    observations,
    evidenceLedgers,
    evaluations,
    legReviews,
    pair,
  };
}

function writeJson(root, relative, value) {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
}

export function bindComparativeFixture(bundle) {
  const contextDigest = canonicalDigest(bundle.comparisonContext);
  bundle.oracle.comparisonContextDigest = contextDigest;
  const oracleDigest = canonicalDigest(bundle.oracle);
  for (const alias of ['A', 'B']) {
    const ledger = bundle.evidenceLedgers[alias];
    const observationValue = bundle.observations[alias];
    observationValue.contextDigest = contextDigest;
    observationValue.evidenceLedgerDigest = canonicalDigest(ledger);
    const evaluationValue = bundle.evaluations[alias];
    evaluationValue.oracleDigest = oracleDigest;
    evaluationValue.contextDigest = contextDigest;
    evaluationValue.observationDigest = canonicalDigest(observationValue);
    evaluationValue.evidenceLedgerDigest = canonicalDigest(ledger);
    bundle.legReviews[alias].evaluationDigest =
      canonicalDigest(evaluationValue);
    const descriptor = bundle.pair.legs.find(
      (leg) => leg.blindedAlias === alias,
    );
    descriptor.observation.digest = canonicalDigest(observationValue);
    descriptor.evidenceLedger.digest = canonicalDigest(ledger);
    descriptor.oracleEvaluation.digest = canonicalDigest(evaluationValue);
    descriptor.legReview.digest = canonicalDigest(bundle.legReviews[alias]);
  }
  bundle.pair.oracle.digest = oracleDigest;
  bundle.pair.comparisonContext.digest = contextDigest;
  return bundle;
}

export function writeComparativePackage(root, bundle) {
  bindComparativeFixture(bundle);
  writeJson(root, 'oracle.json', bundle.oracle);
  writeJson(root, 'comparison-context.json', bundle.comparisonContext);
  for (const alias of ['A', 'B']) {
    writeJson(
      root,
      `legs/${alias}/journey-observation.json`,
      bundle.observations[alias],
    );
    writeJson(
      root,
      `legs/${alias}/evidence-ledger.json`,
      bundle.evidenceLedgers[alias],
    );
    writeJson(
      root,
      `legs/${alias}/oracle-evaluation.json`,
      bundle.evaluations[alias],
    );
    writeJson(
      root,
      `legs/${alias}/leg-review.json`,
      bundle.legReviews[alias],
    );
  }
  writeJson(root, 'paired-case.json', bundle.pair);
  return path.join(root, 'paired-case.json');
}
