# Review Prompt: Desktop OAuth Pre-Authentication Regression

Review:

- `plan.md`
- `tasks/SAL-OAUTH-01.md`
- `docs/client/desktop/identity-lifecycle.md`
- `apps/desktop/src-tauri/src/application/oauth2/mod.rs`
- `apps/desktop/src-tauri/src/interface/tauri_commands/oauth2.rs`
- `apps/desktop/src-tauri/src/interface/http_gateway/mod.rs`
- `tooling/acceptance/environments/station-access-desktop-oauth-native.yaml`
- `tooling/acceptance/provisioners/station_access_desktop_oauth_native.py`
- `tooling/acceptance/gates/station_access/desktop_oauth_native_e2e.py`

Check:

1. The single closure restores OAuth loopback startup from the unauthenticated
   account gate without changing Station OAuth bridge semantics.
2. `None` and `Some(ptid)` remain distinct login and connector modes.
3. Invalid authenticated ownership fails closed.
4. GitHub and Google are both exercised in a real source-bound native Tauri
   window before any actor session exists.
5. Browser layout evidence is not used as native OAuth functional proof.
6. Every successful layout assertion has affirmative or null detail; a
   failure-only phrase such as `was not proven` cannot appear on `passed=true`.
7. Current-source review evidence includes the complete changed-file inventory,
   all four completion Gates, Gap Detector, and quality evidence.
8. The Gate is reset-free and does not require a protected Station mutation.
9. No provider credentials, callback payloads, or third-party accounts are
   introduced.
10. Checkpoint commit and ordinary push are allowed; force push, rebase, history
   rewrite, and pull-request creation are denied.

Return `PASS`, `CONDITIONAL_PASS`, or `REVISE` with source-backed findings.
