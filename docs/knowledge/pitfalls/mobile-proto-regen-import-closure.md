---
kind: pitfall
title: Mobile proto regen must include the full import closure
status: active
owns:
  - tooling/scripts/proto-gen-mobile.sh
  - apps/mobile/src/gen/proto/
referenced-by:
  - docs/knowledge/README.md
related:
  - docs/knowledge/invariants/x-config-origins-never-extend-trust.md
detected: 2026-10-24
---

# Mobile proto regen must include the full import closure

## Symptom

During XCFG-D06, adding a newly generated
`apps/mobile/src/gen/proto/domain/x_config/x_config_pb.ts` to mobile web
broke `tsc --noEmit`:

```
error TS2305: Module '"../peer/access_endpoint_pb"' has no exported
member 'PublicEndpointConnectionMaterial'.
error TS2305: ... has no exported member 'SignedPublicStationAdvertisement'.
```

The committed mobile `gen/proto` tree was a stale partial subset; the new
file imported two messages whose generated modules were never present.

## Root cause

`proto-gen-mobile.sh` regenerates every proto into a staging dir and syncs
it, but a single hand-picked generated file carries transitive imports
that the partial committed tree does not satisfy. Regenerating one proto in
isolation produces a file whose import closure is incomplete. A whole-tree
regen also surfaced unrelated drift from other features already merged
into the protos, so a blind full sync is not a safe default either.

## Mitigation

### What was done in code

- Regenerated into a temp output (`PT_MOBILE_WEB_PROTO_OUT=<tmp>`) and
  diffed against the committed tree to separate needed closure files from
  unrelated feature drift.
- Synced the canonical `x_config_pb.ts` plus its missing import
  (`peer/access_endpoint_pb.ts`) only; verified `tsc --noEmit` green.

### What guards against regression

- `pnpm exec tsc --noEmit -p apps/mobile/tsconfig.json` fails on any
  missing exported member in the generated import graph.
- The correct entry point is always the full regen into a staging
  directory followed by an explicit diff review, never a single-file copy.

## How to detect a recurrence

```bash
tmp="$(mktemp -d)"
PT_MOBILE_WEB_PROTO_OUT="$tmp" bash tooling/scripts/proto-gen-mobile.sh web
diff -rq "$tmp" apps/mobile/src/gen/proto
cd apps/mobile && pnpm exec tsc --noEmit -p tsconfig.json
```

Any "Only in" entry for a file imported by a generated module you ship, or
any TS2305 against `gen/proto`, is this bug. Sync the import closure files
alongside the feature file; keep unrelated drift out of the change unless
its owner validates it.

## Crosswalks

- Generated files are never hand-edited (proto-first iron law); fix the
  `.proto` and regenerate, then sync the closure.
