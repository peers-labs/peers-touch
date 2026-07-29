import { describe, expect, it } from 'vitest';
import { ATELIER_PROJECTION_DISPLAY_LIMITS } from './projection.contract.generated';
import {
  derivePrototypeProjectHealthProjectionView,
  formatPrototypeProjectHealthMilestoneDetail,
} from './prototypeProjectHealthProjection';
import type {
  AtelierMilestoneProjection,
  AtelierProjectBlocker,
  AtelierProjectProjection,
} from './types';

function blocker(index: number): AtelierProjectBlocker {
  return {
    id: `blocker-${index}`,
    owner: 'station',
    severity: 'high',
    state: 'open',
    evidenceRef: `evidence-${index}`,
    reason: `Blocker ${index}`,
  };
}

function milestone(input: Partial<AtelierMilestoneProjection> = {}): AtelierMilestoneProjection {
  return {
    id: 'milestone-1',
    title: 'Milestone',
    state: 'running',
    taskIds: ['task-1'],
    acceptancePredicateIds: [],
    openBlockers: [],
    ...input,
  };
}

function project(input: Partial<AtelierProjectProjection>): AtelierProjectProjection {
  return {
    id: 'project-1',
    goal: 'goal',
    title: 'Project',
    state: 'running',
    workspaceRef: 'workspace://peers-touch',
    goalOwnerSignoff: false,
    residualRisks: [],
    openBlockers: [],
    memoryCandidates: [],
    completion: {
      noOpenBlockers: false,
      l0L1AcceptancePassed: false,
      l2HumanSignoffComplete: false,
      residualRisksLogged: false,
      memoryCandidatesGenerated: false,
    },
    milestoneTree: {
      rootId: 'root',
      milestones: [],
      edges: [],
    },
    taskGraph: {
      rootTaskIds: [],
      tasks: [],
      edges: [],
      parallelPolicy: 'serial_only',
    },
    defects: [],
    ...input,
  };
}

describe('prototypeProjectHealthProjection', () => {
  it('uses generated display limits for Project Health compact lists', () => {
    const itemLimit = ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems;
    const milestoneLimit = ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthMilestones;

    const openBlockers = Array.from({ length: itemLimit + 1 }, (_, index) => blocker(index));
    const residualRisks = Array.from({ length: itemLimit + 2 }, (_, index) => ({
      id: `risk-${index}`,
      desc: `Risk ${index}`,
      state: 'open',
      evidenceRef: `risk-evidence-${index}`,
      owner: 'station',
    }));
    const milestones = Array.from({ length: milestoneLimit + 3 }, (_, index) => milestone({ id: `milestone-${index}` }));
    const memoryCandidates = Array.from({ length: itemLimit + 4 }, (_, index) => ({
      id: `memory-${index}`,
      type: 'lesson',
      content: `Memory ${index}`,
      evidenceRefs: [],
      scope: 'project',
      confirmed: false,
      feeds: ['planner'],
    }));
    const policyRules = Array.from({ length: itemLimit + 5 }, (_, index) => ({
      id: `rule-${index}`,
      scope: 'project',
      expr: `rule-${index}`,
      severity: 'warning',
    }));
    const defects = Array.from({ length: itemLimit + 6 }, (_, index) => ({
      id: `defect-${index}`,
      taskId: `task-${index}`,
      source: 'review',
      state: 'open',
      evidenceRef: `defect-evidence-${index}`,
      proposal: {
        summary: `Defect ${index}`,
        expectedChange: 'Fix projection',
        targetRefs: [],
      },
    }));

    expect(derivePrototypeProjectHealthProjectionView(project({
      openBlockers,
      residualRisks,
      milestoneTree: {
        rootId: 'root',
        milestones,
        edges: [],
      },
      memoryCandidates,
      policy: {
        id: 'policy-1',
        rules: policyRules,
        hardDeny: false,
      },
      defects,
    }))).toMatchObject({
      visibleBlockers: openBlockers.slice(0, itemLimit),
      hiddenBlockerCount: 1,
      visibleRisks: residualRisks.slice(0, itemLimit),
      hiddenRiskCount: 2,
      visibleMilestones: milestones.slice(0, milestoneLimit),
      hiddenMilestoneCount: 3,
      visibleMemoryCandidates: memoryCandidates.slice(0, itemLimit),
      hiddenMemoryCandidateCount: 4,
      visiblePolicyRules: policyRules.slice(0, itemLimit),
      hiddenPolicyRuleCount: 5,
      visibleDefects: defects.slice(0, itemLimit),
      hiddenDefectCount: 6,
    });
  });

  it('treats missing policy as an empty read-only projection', () => {
    expect(derivePrototypeProjectHealthProjectionView(project({}))).toMatchObject({
      visiblePolicyRules: [],
      hiddenPolicyRuleCount: 0,
    });
  });

  it('formats milestone predicate and blocker refs with generated ref limits', () => {
    const limit = ATELIER_PROJECTION_DISPLAY_LIMITS.milestoneRefs;
    const acceptancePredicateIds = Array.from({ length: limit + 1 }, (_, index) => `predicate-${index}`);
    const openBlockers = Array.from({ length: limit + 2 }, (_, index) => blocker(index));

    expect(formatPrototypeProjectHealthMilestoneDetail(milestone({
      state: 'blocked',
      taskIds: ['task-1', 'task-2'],
      acceptancePredicateIds,
      openBlockers,
    }))).toBe(
      'blocked · 2 tasks · 3 predicates · 4 blockers · Predicate refs: predicate-0, predicate-1 +1 more predicate refs · Blocker refs: blocker-0, blocker-1 +2 more blocker refs',
    );
  });
});
