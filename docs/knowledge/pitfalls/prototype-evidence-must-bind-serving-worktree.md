---
kind: pitfall
title: Prototype evidence must bind the serving worktree before interaction
status: active
owns:
  - tooling/scripts/ui-system/evaluate-specimens.mjs
  - tooling/scripts/ui-system/suites/
related:
  - docs/knowledge/playbooks/ui-primitive-promotion.md
  - docs/knowledge/invariants/worktree-observation-is-diagnostic.md
detected: 2026-11-07
owner: Client Platform / UI System
review-cadence: on-change
---

# Prototype evidence must bind the serving worktree before interaction

## Symptom and root cause

The Portal at `localhost` can listen on IPv6 while another worktree owns the
same port on IPv4. A probe targeting `127.0.0.1` then exercises the other
worktree. Reading current local files for evidence digests does not establish
which code the browser actually rendered.

The original probe recorded `branchMentioned=false` but enforced it only
through an optional environment variable, after all scenarios. Unrelated
menus, media and geometry were consequently reported as implementation failures.

## Current owner and mitigation

`evaluate-specimens.mjs` probes the original Portal before any interaction.
The Portal suites set `specimen.requireWorktreeIdentity=true`; both the branch
and the Portal's full serving-worktree title must match the evidence worktree.
A mismatch produces a failed service gate and executes no scenarios or craft
checks. The environment variable may strengthen another suite, but cannot
disable an explicitly required binding.

Use `make -w run-prototype VITE_PROTOTYPE_PORT=<isolated-port>` and the URL
actually printed by the canonical owner. Check the exact listening process
when localhost aliases produce different observations. Preserve other-worktree
servers. Portal evidence remains presentation observation, never Native proof.

## How to detect a recurrence

- Run the selected original Portal suite against the current isolated service;
  source root and branch must match before its scenarios run.
- Point the same selection at a controlled different-worktree service. Expect
  `service.branch-identity` or `service.worktree-identity`, nonzero exit and an
  empty scenario list. Never interpret that failed run as UI regression evidence.
- A changed source or required binding invalidates the affected evidence.
