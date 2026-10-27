import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { canonicalDigest, equalStringSets } from './canonical.mjs';

const LEVEL_RANK = new Map([
  ['L1_CONTRACT', 1],
  ['L2_VISUAL', 2],
  ['L3_DYNAMIC', 3],
  ['L4_RUNTIME', 4],
]);

function equalViewport(left, right) {
  return (
    left.widthCssPx === right.widthCssPx
    && left.heightCssPx === right.heightCssPx
    && left.devicePixelRatio === right.devicePixelRatio
  );
}

function exactMetricMatch(requirement, observation) {
  if (observation === undefined) return false;
  for (const key of [
    'name',
    'unit',
    'environment',
    'workload',
    'measurementMethod',
    'samplePolicy',
    'percentile',
  ]) {
    if (requirement[key] !== observation[key]) return false;
  }
  if (requirement.comparator === '<=') {
    return observation.value <= requirement.threshold;
  }
  return observation.value >= requirement.threshold;
}

function artifactMatches(record, repoRoot) {
  if (record.level === 'L1_CONTRACT') return true;
  if (
    record.artifact === undefined
    || record.artifactDigest === undefined
    || record.inspectedById === undefined
    || record.observedAt === undefined
  ) {
    return false;
  }
  const resolved = path.resolve(repoRoot, record.artifact);
  if (
    resolved !== repoRoot
    && !resolved.startsWith(`${repoRoot}${path.sep}`)
  ) {
    return false;
  }
  let bytes;
  try {
    const metadata = fs.lstatSync(resolved);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return false;
    const realRepoRoot = fs.realpathSync(repoRoot);
    const realArtifact = fs.realpathSync(resolved);
    if (
      realArtifact !== realRepoRoot
      && !realArtifact.startsWith(`${realRepoRoot}${path.sep}`)
    ) {
      return false;
    }
    bytes = fs.readFileSync(realArtifact);
  } catch {
    return false;
  }
  const actual =
    `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  return actual === record.artifactDigest;
}

export function recordMatchesRequirement(
  requirement,
  record,
  { candidateDigest, repoRoot },
) {
  if (
    record.requirementId !== requirement.id
    || record.level !== requirement.level
    || record.status !== 'observed'
    || record.sourceDigest !== candidateDigest
    || record.platform !== requirement.platform
    || record.runtimeProfile !== requirement.runtimeProfile
    || record.inputMode !== requirement.inputMode
    || record.locale !== requirement.locale
    || !equalViewport(record.viewport, requirement.viewport)
    || record.resolvedTheme !== requirement.resolvedTheme
    || record.contentMode !== requirement.contentMode
    || !equalStringSets(record.stateIds, requirement.stateIds)
    || !equalStringSets(record.assertionIds, requirement.assertionIds)
    || !artifactMatches(record, repoRoot)
  ) {
    return false;
  }
  if (requirement.metric !== undefined) {
    return exactMetricMatch(requirement.metric, record.metricObservation);
  }
  return record.metricObservation === undefined;
}

export function matchEvidenceRequirements(
  contract,
  candidate,
  { candidateDigest, repoRoot },
) {
  const matches = new Map();
  const unmatched = [];
  for (const requirement of contract.requiredEvidence) {
    const record = candidate.evidence.find((candidateRecord) =>
      recordMatchesRequirement(requirement, candidateRecord, {
        candidateDigest,
        repoRoot,
      }));
    if (record === undefined) unmatched.push(requirement.id);
    else matches.set(requirement.id, record.id);
  }
  return {
    matches,
    unmatched,
    digest: canonicalDigest({
      matches: Object.fromEntries([...matches.entries()].sort()),
      unmatched: [...unmatched].sort(),
    }),
  };
}

export function observedEvidenceAtOrAbove(
  contract,
  candidate,
  evidenceRequirementId,
  minimumLevel,
  options,
) {
  const requirement = contract.requiredEvidence.find(
    (item) => item.id === evidenceRequirementId,
  );
  if (
    requirement === undefined
    || LEVEL_RANK.get(requirement.level) < LEVEL_RANK.get(minimumLevel)
  ) {
    return false;
  }
  return candidate.evidence.some(
    (record) =>
      record.requirementId === evidenceRequirementId
      && recordMatchesRequirement(requirement, record, options),
  );
}
