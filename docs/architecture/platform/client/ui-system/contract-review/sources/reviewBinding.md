---
kind: pitfall
title: Experience review binding and graph closure
status: active
owns:
  - tooling/scripts/experience-design/
  - tooling/skills/pt-prototype-design/
  - tooling/skills/pt-quality-check/
referenced-by: []
related:
  - docs/architecture/engineering/experience-design/review-result.md
  - docs/architecture/engineering/experience-design/data-model.md
detected: 2026-10-20
---

# Experience review binding and graph closure

## Symptom

A frozen result could enter high fidelity after its case changed. Independent
file hashes could validate an unrelated envelope. Reachable mode branches
escaped drift, recovery declarations could name nonexistent graph steps, and
equivalent graph serialization changed the primary ranking. Promoted fixtures
could lack a reciprocal blind chain; evaluator revisions invalidated immutable
first results.

## Root cause

Reference presence and prior successful checks were treated as current,
executable relationships. Historical integrity was conflated with current
reevaluation.

## Mitigation

Final admission recomputes SourceFence. Envelope, manifest, selected case and
source inventories agree. Graph steps bind source/action/destination and
recovery returns from the blocked source. Ordering is total across explicit
and derived states. Candidate Journey ownership is entry-reachable; grammar
confirmation and platform identity constrain action tuples. Historical blind
chains bind frozen evaluator snapshots, and promotions bind their ledger in
both directions.

## How to detect a recurrence

Run `node --test tooling/scripts/experience-design/*.test.mjs`.
The CLI package tests cover stale admission and unrelated envelopes, graph
tests cover permutations and intermediate recovery, evaluator regressions
cover decision branches and repeated phases, and holdout regressions cover
external roots, snapshot drift and reciprocal promotion. Source checks do not
prove the semantic truth of an independent review or unseen design quality.

## Crosswalks

Current contracts: ReviewResult sections 2, 4, 6, 9, 10 and Experience Case
sections 3, 9, 15. Stable principals establish reviewer non-overlap; no signing
keys or issuer registry is required.
