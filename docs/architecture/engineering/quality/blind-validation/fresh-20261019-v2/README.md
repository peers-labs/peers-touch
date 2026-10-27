# Experience Reasoning Fresh Holdout V2

> Status: sealed
> Package: `EDX-HOLDOUT-20261019-V2`
> Run: `EDX-RUN-20261019-V2-01`
> Owner: Quality

## Purpose

This package is the fresh promotion holdout for the Experience Reasoning
Kernel. It tests six previously unexposed current-source journeys. The earlier
`EDX-B01` through `EDX-B06` package is training material and is not promotion
evidence.

The package judges whether the Kernel can:

- select the earliest material visible blocker;
- project trust-sensitive scope meaning without inventing protocol behavior;
- distinguish an exit from a usable recovery path;
- avoid blocking false positives on sound interaction designs;
- keep source, visual, dynamic and runtime evidence claims separate;
- preserve shared product meaning across platform-specific controls.

## Isolation

The blind runner may read only:

- `manifest.json`;
- `rubric.md`;
- `seal.json`;
- one file under `cases/` at a time;
- the exact source files named by that case.

The runner must not read `reviewer-only/`, reports for another case, score
artifacts or promotion decisions. A case is permanently exposed once
`seal.json` exists, even if the run aborts or is invalidated.

## Run Lifecycle

1. Verify `seal.json`, package digests, source HEAD and source blob hashes.
2. Move the run from `sealed` to `running` without changing any package input.
3. Give the runner `rubric.md` and exactly one case.
4. Validate and freeze that case's ReviewResult before revealing the next case.
5. Freeze one report manifest containing every report digest.
6. Move to `scoring`; only then may Quality read `reviewer-only/answer-key.md`.
7. Write the immutable score and promotion decision.
8. Retire or invalidate the run without returning any case to the fresh pool.

The Agent must not tune the Kernel, rubric or case set between reports.

## Promotion Boundary

Promotion requires all of the following:

- score at least `80`;
- zero hard failures;
- all six hidden challenge classes satisfied;
- no blocking false positive on a positive control;
- every Finding report passes canonical ReviewResult validation and exact
  source verification;
- every primary priority tuple is mechanically recomputable;
- all package, report and score hashes verify;
- no case digest was present in an earlier exposure or training entry.

Passing promotes Layer 2 as an admissible input to Layer 3. It does not prove
that any reviewed product surface is production-ready.
