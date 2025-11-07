# peers-touch Proto Schema

This directory contains unified protobuf schemas for the entire project, split by domain and version, with shared common types.

## Quick Start

### Installing Buf

#### macOS (Homebrew)
```bash
brew install bufbuild/buf/buf
```

#### Linux (Binary)
```bash
# Download and install the latest release
curl -sSL \
  https://github.com/bufbuild/buf/releases/latest/download/buf-$(uname -s)-$(uname -m) \
  -o /usr/local/bin/buf && \
  chmod +x /usr/local/bin/buf
```

#### Windows (Chocolatey)
```powershell
choco install buf
```

#### Go Install
```bash
go install github.com/bufbuild/buf/cmd/buf@latest
```

#### Verify Installation
```bash
buf --version
```

## Layout

- `common/v1/` — shared building blocks
  - `base.proto` — `RequestMeta`, `ResponseMeta`
  - `pagination.proto` — `PageRequest`, `PageResponse`
  - `error.proto` — `ErrorDetail`
- `aibox/v1/` — AI Box provider domain
  - `types.proto` — `ProviderConfig`, `AiProvider`, enums
  - `service.proto` — `ProviderService` RPCs and request/response messages
- `touch/v1/` — Social networking features
  - `common.proto` — `SuccessResponse`, `PageData`, `StatusCode`
  - `errors.proto` — `Error`, `ErrorCode`, `ErrorService`
  - `peer.proto` — `PeerService`, `PeerAddressParam`, `PeerAddrInfo`
  - `profile.proto` — `ProfileService`, `ProfileGetResponse`, `ProfileUpdateParams`
  - `webfinger.proto` — `WebFingerService`, `WebFingerResponse`, `WebFingerActivityPubActor`
  - `activitypub_endpoint.proto` — `ActivityPubEndpointService`, `ActivityPubEndpointInfo`
  - `actor/` — Actor related services
    - `actor.proto` — `ActorService`, `Actor`, `ActorAuthResponse`
    - `follow.proto` — `FollowService`, `Follow`, `FollowParams`
    - `inbox.proto` — `InboxService`, `InboxMessage`, `InboxListResponse`
    - `outbox.proto` — `OutboxService`, `OutboxMessage`, `SendMessageParams`
    - `liked.proto` — `LikeService`, `Like`, `LikeParams`
    - `facade.proto` — `FacadeService`, `Activity`, `ItemCollection`
    - `options.proto` — `ActorOptionsService`, `ActorOptions`

## Conventions

- Use `proto3` with snake_case field names.
- Prefer `google.protobuf.Timestamp` for time fields.
- Use `optional` for fields that require presence semantics in updates.
- Reserve field numbers when removing fields to avoid reuse.
- Keep domain types separate from service definitions.

## Code Generation

We recommend using [Buf](https://buf.build/) with grouped generation support:

### Grouped Generation

We support generating code for specific groups to improve development efficiency:

#### Generate All Groups (Default)
```sh
cd peers-touch/proto
buf generate
```

#### Generate Station Group Only (Backend Go Code)
```sh
buf generate --config buf.gen.station.yaml
```

#### Generate Desktop Group Only (Desktop App Dart Code)
```sh
buf generate --config buf.gen.desktop.yaml
```

#### Generate Mobile Group Only (Mobile App Dart Code)
```sh
buf generate --config buf.gen.mobile.yaml
```

### Output Directories

- **Station (Go)**: `peers-touch/station/frame/touch/proto_gen/` and `peers-touch/station/app/subserver/ai-box/proto_gen/`
- **Desktop (Dart)**: `peers-touch/desktop/lib/generated/proto/`
- **Mobile (Dart)**: `peers-touch/mobile/lib/generated/proto/`

### Manual protoc Commands (Alternative)

If you prefer `protoc` directly:

```sh
# Generate Go code for station
protoc -I. --go_out=paths=source_relative:../peers-touch/station/frame/touch/proto_gen \
  --go-grpc_out=paths=source_relative:../peers-touch/station/frame/touch/proto_gen \
  common/v1/*.proto aibox/v1/*.proto touch/v1/*.proto

# Generate Dart code for desktop
protoc -I. --dart_out=grpc:../peers-touch/desktop/lib/generated/proto \
  common/v1/*.proto aibox/v1/*.proto touch/v1/*.proto

# Generate Dart code for mobile
protoc -I. --dart_out=grpc:../peers-touch/mobile/lib/generated/proto \
  common/v1/*.proto aibox/v1/*.proto touch/v1/*.proto
```

## JSON Mapping

- The station backend should use `protojson` for HTTP JSON mapping.
- Frontends can parse with Dart `GeneratedMessage.mergeFromProto3Json(...)` (ignore unknown fields).
- Avoid emitting sensitive fields (e.g., `ProviderConfig.api_key`) in responses.

## Versioning & Stability

- Use package-level versioning (e.g., `aibox.v1`, `touch.v1`).
- Only add new fields; avoid changing types or semantics of existing fields.
- Declare `reserved` numbers/names when deprecating.

## Module Structure

We use a modular approach with three main modules:

- **common**: Shared types and utilities
- **aibox**: AI-related services
- **touch**: Social networking features

Each module can be generated independently using the grouped generation approach above.