# P4 Gateway Policy and Audit Flush Slice

> Evidence class: CONTROLLED_LOCAL_UPSTREAM
> Plan source: `docs/architecture/applet-runtime/execution-plans/2026-06-23-applet-capability-completion-plan.md`

## Scope Completed

- Store-backed validation policy now uses `big-a` for third-party validation and `peers.note` for internal official validation.
- Station Store publish now persists all `manifest.integrity.files` assets, not only the desktop entry bundle.
- Desktop Store materialization now receives Station asset integrity metadata and materializes every declared asset under the local Store bundle cache.
- Desktop Gateway keeps inline manifest/session/permission/quota/timeout enforcement before capability dispatch.
- Desktop audit upload now requeues records when Station upload fails, preventing drain-before-fail record loss.
- Desktop API now schedules a delayed audit flush after applet Gateway commands (`applets_create_session`, `applets_invoke`, `applets_action`).

## Evidence

- `pnpm applet:station-backed-launch-gate`: PASS
- `cd apps/station/app && go test ./subserver/applet_store/...`: PASS
- `cd apps/station/app && go test ./...`: PASS
- `cd apps/desktop/src-tauri && cargo fmt && cargo check`: PASS
- `cd apps/desktop && pnpm run check`: PASS
- `cd apps/desktop/src-tauri && cargo test domain::applets::tests::requeue_audit_records_restores_failed_upload_batch_before_new_records`: PASS

## Gate Outputs

- `tooling/acceptance/evidence/applets/station-backed-launch/station-backed-launch-gate.json`
- `tooling/acceptance/evidence/applets/station-backed-launch/station-backed-launch-gate.md`

## Not Covered

- This slice does not claim full live authenticated Station deployment coverage.
- This slice does not claim Mobile native Lynx runtime E2E completion.
- This slice does not replace release manual acceptance.

## Claim

- P3 Store-backed package materialization is validated for `big-a` and `peers.note` in a controlled local Store fixture.
- P4 Gateway hardening has a minimum enforce-and-flush slice: inline policy checks remain active, and audit records now have automatic flush plus failure requeue.
