---
kind: pitfall
title: Station protobuf errors must decode before display
status: active
owns:
  - apps/desktop/src-tauri/src/application/station_runtime/client.rs
referenced-by: []
related:
  - docs/architecture/platform/runtime/node-connectivity/design.md
  - docs/architecture/platform/station/access/design.md
detected: 2026-10-31
owner: Client Platform Team
review-cadence: annual
next-review: 2027-10-31
---

# Station protobuf errors must decode before display

## Symptom

An unsuccessful email login displayed square/control characters before
`user not found`. The response was a valid Protobuf error body:
`08 01 12 0e` followed by the readable message.

## Root cause

`StationClient::buffer_response` converted every non-success body through
`String::from_utf8_lossy`, bypassing the existing `StationErrorBody` decoder.
Valid UTF-8 can still include Protobuf tags, lengths and control characters;
lossy conversion cannot determine the response protocol.

## Mitigation

The unified buffered response entry now reuses `peers_failure_error` before
building the status-specific error. The decoded message becomes the display
body, while protocol details and safe HTTP error headers remain available.
HTTP header codes take precedence, and session revocation keeps its existing
typed behavior. Successful response bytes are not transformed.

## What guards against regression

The owning Rust module includes:

- `buffered_protobuf_failure_keeps_readable_message_and_error_headers`
- `buffered_protobuf_session_revocation_keeps_session_error_kind`
- `buffered_text_failure_and_success_payload_keep_existing_semantics`

The first case uses the original wire bytes and checks both readable text and
absence of control characters. The unfixed response entry fails that case.
Development Native verification also submitted a nonexistent email through
the actual login form against Station; its visible error was
`Access gate submit failed: station returned 400: user not found`.

## How to detect a recurrence

Run the focused module checks in the supported native SDK:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml \
  --bin peers-touch-desktop application::station_runtime::client::tests::buffered_
```

In an isolated Native runtime, submit an unregistered email from Email Login.
The login card must show the server reason without Protobuf controls or
replacement characters and must remain unauthenticated.

Plain text and JSON fallbacks are still valid for their own response formats;
do not remove them or change transport, session, or replay policy to fix display.
