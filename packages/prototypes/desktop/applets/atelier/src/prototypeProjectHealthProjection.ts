import {
  ATELIER_PROJECTION_DISPLAY_LIMITS,
} from './projection.contract.generated';
import type { AtelierMilestoneProjection, AtelierProjectProjection } from './types';

export interface PrototypeProjectHealthProjectionView {
  visibleBlockers: AtelierProjectProjection['openBlockers'];
  hiddenBlockerCount: number;
  visibleRisks: AtelierProjectProjection['residualRisks'];
  hiddenRiskCount: number;
  visibleMilestones: AtelierProjectProjection['milestoneTree']['milestones'];
  hiddenMilestoneCount: number;
  visibleMemoryCandidates: AtelierProjectProjection['memoryCandidates'];
  hiddenMemoryCandidateCount: number;
  visiblePolicyRules: NonNullable<AtelierProjectProjection['policy']>['rules'];
  hiddenPolicyRuleCount: number;
  visibleDefects: AtelierProjectProjection['defects'];
  hiddenDefectCount: number;
}

export function derivePrototypeProjectHealthProjectionView(
  project: AtelierProjectProjection,
): PrototypeProjectHealthProjectionView {
  const policyRules = project.policy?.rules ?? [];
  const visibleBlockers = project.openBlockers.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems);
  const visibleRisks = project.residualRisks.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems);
  const visibleMilestones = project.milestoneTree.milestones.slice(
    0,
    ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthMilestones,
  );
  const visibleMemoryCandidates = project.memoryCandidates.slice(
    0,
    ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems,
  );
  const visiblePolicyRules = policyRules.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems);
  const visibleDefects = project.defects.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems);

  return {
    visibleBlockers,
    hiddenBlockerCount: Math.max(0, project.openBlockers.length - visibleBlockers.length),
    visibleRisks,
    hiddenRiskCount: Math.max(0, project.residualRisks.length - visibleRisks.length),
    visibleMilestones,
    hiddenMilestoneCount: Math.max(0, project.milestoneTree.milestones.length - visibleMilestones.length),
    visibleMemoryCandidates,
    hiddenMemoryCandidateCount: Math.max(0, project.memoryCandidates.length - visibleMemoryCandidates.length),
    visiblePolicyRules,
    hiddenPolicyRuleCount: Math.max(0, policyRules.length - visiblePolicyRules.length),
    visibleDefects,
    hiddenDefectCount: Math.max(0, project.defects.length - visibleDefects.length),
  };
}

export function formatPrototypeProjectHealthMilestoneDetail(
  milestone: AtelierMilestoneProjection,
): string {
  const visiblePredicateIds = milestone.acceptancePredicateIds.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.milestoneRefs);
  const hiddenPredicateCount = Math.max(0, milestone.acceptancePredicateIds.length - visiblePredicateIds.length);
  const visibleMilestoneBlockerRefs = milestone.openBlockers
    .slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.milestoneRefs)
    .map((blocker) => blocker.id);
  const hiddenMilestoneBlockerCount = Math.max(0, milestone.openBlockers.length - visibleMilestoneBlockerRefs.length);
  const refs = [
    visiblePredicateIds.length > 0
      ? `Predicate refs: ${visiblePredicateIds.join(', ')}${hiddenPredicateCount > 0 ? ` +${hiddenPredicateCount} more predicate refs` : ''}`
      : '',
    visibleMilestoneBlockerRefs.length > 0
      ? `Blocker refs: ${visibleMilestoneBlockerRefs.join(', ')}${hiddenMilestoneBlockerCount > 0 ? ` +${hiddenMilestoneBlockerCount} more blocker refs` : ''}`
      : '',
  ].filter(Boolean);

  return [
    `${milestone.state} · ${milestone.taskIds.length} tasks · ${milestone.acceptancePredicateIds.length} predicates · ${milestone.openBlockers.length} blockers`,
    ...refs,
  ].join(' · ');
}
