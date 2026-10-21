# Desktop Provider / Model Alignment Plan

## Goal

Move Provider execution, model discovery, catalog ownership, and admission to one Station-owned contract while keeping Desktop as a typed projection and intent client.

## Delivery Order

1. Define typed Provider runtime configuration, adapter capabilities, model metadata, check, and discovery in `provider.proto`.
2. Register structured CLI argv in the Station catalog.
3. Implement bounded CLI check/discovery, normalization, and runtime catalog replacement in Station.
4. Make Provider detail and runtime admission consume the same effective Station catalog.
5. Reject CLI model mutation and remove Desktop-local CLI execution.
6. Split Direct and CLI Settings schemas; keep CLI models read-only and capability-driven.
7. Replace bare model IDs with `(provider_id, model_id)` in all selectors and fallback logic.
8. Verify Station contracts, Desktop projections, rendered Settings geometry, and a real TRAE discovery/Agent journey.

## Required Evidence

- Generated Go and TypeScript contracts are current.
- Station CLI, Provider service, handler, and admission tests pass.
- Desktop typecheck and focused Provider/model tests pass.
- Duplicate model-ID regression tests pass.
- No `model_fetch_remote`, `models_command`, or `model_toggle_all` production path remains.
- Real TRAE discovery reports models and those exact models appear in Provider Settings and Agent selection.
- Settings wide/narrow screenshots show one thin Provider-list scrollbar.
- CLI runtime config save, restore-defaults, enable/disable persistence, check, and discovery are exercised.

## Completion Rule

The change is implementation-complete only after exact-source Native verification. Commit, push, and MR remain blocked until the user has tested the result.
