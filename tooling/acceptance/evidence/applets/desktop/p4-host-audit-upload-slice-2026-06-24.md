# P4 Host Audit Upload Slice

> Evidence class: `CONTROLLED_CLIENT_INTEGRATION`
> Plan source: `docs/architecture/platform/applet-runtime/execution-plans/2026-06-23-applet-capability-completion-plan.md`

## Completed

- Exposed the in-memory Host applet audit queue outside test-only code through `drain_audit_records`.
- Added Desktop Rust command:
  - `applets_store_upload_audit`
- Added Desktop TS API wrapper:
  - `api.appletStoreUploadAudit()`
- The upload command maps Host audit records into Station Store audit ingestion payload fields:
  - `audit_id`;
  - `actor_id`;
  - `device_id`;
  - `applet_id`;
  - `capability`;
  - `method`;
  - `decision`;
  - `reason`;
  - `metadata`.
- Empty audit queue returns a local success payload and does not call Station.

## Verification

```bash
cd apps/desktop/src-tauri && cargo check
cd apps/desktop && pnpm run check
```

Result: PASS.

## Not Completed

- Audit upload is command-boundary only; it is not yet scheduled as automatic runtime background sync.
- Failed upload retry/spooling is not implemented.
- Live Station audit ingestion E2E from Desktop is not proven in this slice.
- Gateway policy enforcement still does not consume Store-distributed policy rows.

## Claim

Desktop now has a Host audit upload boundary to Station Store audit ingestion. This is a P4 enabling slice, not complete P4 audit hardening.
