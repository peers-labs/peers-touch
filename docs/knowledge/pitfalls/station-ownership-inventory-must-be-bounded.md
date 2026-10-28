---
kind: pitfall
title: Station ownership source inventory must bound filesystem concurrency
status: active
owns:
  - apps/station/app/cmd/station_api_ownership/
related:
  - docs/architecture/engineering/api-governance/design.md
  - docs/architecture/engineering/acceptance/execution-budget.md
detected: 2026-10-22
---

# Station ownership source inventory must bound filesystem concurrency

## Symptom and root cause

The full Gate architecture experiment stopped `station-api-ownership` at its
15-second work deadline. A bounded `go run -x` diagnostic launched the cached
validator directly; compilation was not the pending boundary. An owned Go
stack captured `parseGoFiles -> filepath.WalkDir -> os.ReadDir`, and a
diagnostic overlay showed serial traversal of ordinary Station directories.
Registration and source scanners independently owned serial traversal.
After the directory boundary was removed, a second bounded stack located the
remaining wait in `parseGoFiles -> os.ReadFile`, confirming serial file input.

## Correction

`source_tree.go` owns the scanner used by both inventories. Directory reads
and file reads use a queue with at most 16 workers, and every worker joins before
return. An analysis-owned inventory shares directory results and file bytes
among every assertion consumer. The
existing directory exclusions, source-extension rules, deterministic sorting,
symlink behavior and fail-closed errors remain. No cache can transfer an old
source observation into another Gate.

## How to detect a recurrence

Run the existing validator and scanner regressions under explicit command
deadlines:

```text
go test ./apps/station/app/cmd/station_api_ownership -count=1
go run ./apps/station/app/cmd/station_api_ownership --root . --registry docs/architecture/engineering/api-governance/station-api-capabilities.yaml
```

Check that registration and source inventories both call `sourceTreeFiles`,
that no independent `filepath.WalkDir` remains in this validator, and that all
route, proto, retired-symbol, truth-store and DDD assertions still execute.
An overrun must pause downstream work and trigger diagnosis; do not increase
the Gate threshold or hide ignored source files to obtain success.
