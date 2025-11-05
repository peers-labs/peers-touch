# peers-touch Proto Schema

This directory contains unified protobuf schemas for the entire project, split by domain and version, with shared common types.

## Layout

- `common/v1/` — shared building blocks
  - `base.proto` — `RequestMeta`, `ResponseMeta`
  - `pagination.proto` — `PageRequest`, `PageResponse`
  - `error.proto` — `ErrorDetail`
- `aibox/v1/` — AI Box provider domain
  - `types.proto` — `ProviderConfig`, `AiProvider`, enums
  - `service.proto` — `ProviderService` RPCs and request/response messages

## Conventions

- Use `proto3` with snake_case field names.
- Prefer `google.protobuf.Timestamp` for time fields.
- Use `optional` for fields that require presence semantics in updates.
- Reserve field numbers when removing fields to avoid reuse.
- Keep domain types separate from service definitions.

## Code Generation

We recommend using [Buf](https://buf.build/):

```sh
cd peers-touch/proto
buf lint
buf generate
```

Outputs (adjust paths in `buf.gen.yaml` as needed):

- Go: `peers-touch/station/proto/gen/`
- Dart (desktop): `peers-touch/desktop/lib/generated/proto/`
- Dart (mobile): `peers-touch/mobile/lib/generated/proto/`

If you prefer `protoc` directly:

```sh
protoc -I. --go_out=paths=source_relative:../peers-touch/station/proto/gen \
  --go-grpc_out=paths=source_relative:../peers-touch/station/proto/gen \
  common/v1/*.proto aibox/v1/*.proto

protoc -I. --dart_out=grpc:../peers-touch/desktop/lib/generated/proto \
  common/v1/*.proto aibox/v1/*.proto

protoc -I. --dart_out=grpc:../peers-touch/mobile/lib/generated/proto \
  common/v1/*.proto aibox/v1/*.proto
```

## JSON Mapping

- The station backend should use `protojson` for HTTP JSON mapping.
- Frontends can parse with Dart `GeneratedMessage.mergeFromProto3Json(...)` (ignore unknown fields).
- Avoid emitting sensitive fields (e.g., `ProviderConfig.api_key`) in responses.

## Versioning & Stability

- Use package-level versioning (e.g., `aibox.v1`).
- Only add new fields; avoid changing types or semantics of existing fields.
- Declare `reserved` numbers/names when deprecating.