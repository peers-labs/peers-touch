# Cross-Runtime Logging Guide

> **Status**: active
> **Updated**: 2026-10-17
> **Scope**: Station, Desktop, Mobile, and native capability adapters

---

## 1. Invariants

- Never log credentials, tokens, cookies, private keys, OAuth verifier/nonce,
  plaintext private content, raw provider payloads, or unrestricted file paths.
- Prefer stable domain operation, request/command ID, Station/PTID/device scope
  digest, lifecycle generation, result code, and duration.
- Log at the owner that can explain the failure. Adapters add platform context
  but do not restate business outcomes.
- Errors retain cause and operation context.
- Unknown or partial outcomes are not logged as success.
- Production code does not call `console.log`, `print`, `println!`,
  `fmt.Println`, Android `Log.*`, or equivalent debug output.
- User-visible errors come from typed/i18n projections, not log strings.

## 2. Data Classification

| Data | Logging policy |
|---|---|
| Stable operation/capability ID | allowed |
| Request/command/event ID | allowed when not a credential |
| Station/PTID/device identifier | redact or hash unless the owning security contract explicitly allows it |
| URL | log only origin or a redacted form; never userinfo, query, fragment, token, or signed parameters |
| File path | log an owned logical reference; avoid user-home and provider paths |
| Error | include typed code and sanitized cause |
| Payload/body/header | denied by default |
| Private content or secret | denied |

Redaction happens before data crosses a frontend/native logging boundary.

## 3. Station

Station Go code uses:

```text
apps/station/frame/core/logger/
```

Pass `context.Context` so request and trace metadata remain attached. Do not
use the Go standard logger or `fmt.Print*` in production paths.

```go
logger.Infof(ctx, "conversation command accepted command_id=%s", commandID)
logger.Errorf(ctx, "conversation command failed command_id=%s: %v", commandID, err)
```

Handlers log transport mapping; domain/application owners log the business
operation. Do not log the same failure as independent outcomes at every layer.

## 4. Desktop

Desktop TypeScript uses:

```text
apps/desktop/src/utils/logger.ts
```

The logger batches typed entries through `frontend_log_batch` and falls back to
the single-entry command. Callers use stable tags and structured redacted data:

```ts
log.warn('stationRuntime', 'route reconciliation deferred', {
  commandId,
  reason: errorCode,
});
```

Desktop Rust uses `tracing` through the initialized infrastructure logger:

```rust
tracing::warn!(command_id = %command_id, error = %error, "reconciliation deferred");
```

Keep the non-blocking writer guard alive for the application lifetime. Tauri
commands must sanitize frontend-supplied fields before writing them.

## 5. Mobile

Mobile Rust currently uses the `log` facade:

```rust
log::warn!("mobile messaging worker cycle failed: {error}");
```

Messages must identify the owning runtime/operation and remain redacted.
Platform-specific adapters report typed errors to Rust; Kotlin/Swift do not
become separate business logging owners.

Mobile TypeScript has no canonical general-purpose frontend logger today.
New production logging must first add or reuse a reviewed Mobile logging port;
it must not introduce direct console output as the de facto API. Error
boundaries may project a sanitized typed failure while the Rust/runtime owner
records operational detail.

Android adapters use the project plugin logging boundary rather than `Log.*`.
iOS adapters use the project plugin logging boundary rather than `print`.
Platform log APIs may sit behind that boundary when privacy and release-level
filtering are explicit.

## 6. Lifecycle And Async Work

- Start/finish logs share one operation ID.
- Retry logs include attempt, maximum/budget, and final disposition.
- Cancellation, timeout, denial, unsupported, stale generation, and overload
  are distinct outcomes.
- Background work identifies its durable owner and cleanup result.
- A swallowed callback or cleanup failure is forbidden; report it through the
  owning typed result and logger.
- High-frequency event and rendering paths use bounded sampling/aggregation,
  not per-frame or per-message debug spam.

## 7. Review Checklist

- No secret or private-content field reaches logs.
- No raw debug-print API was introduced.
- Every error log names the stable operation and sanitized cause.
- Adapter logs do not claim business success.
- Async work logs terminal state and cleanup.
- Android and iOS use the same semantic event names where they implement one
  Mobile capability.
- Runtime/Acceptance artifacts apply the same redaction policy.

## 8. Related Sources

- [Security Guide](./security.md)
- [Cross-Client Runtime](../../../architecture/platform/client/cross-client-runtime/README.md)
- [Android Host Guide](../mobile/android.md)
- [iOS Host Guide](../mobile/ios.md)
