# OAuth Login Broker - Module Layout

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-30 | **Updated**: 2026-10-01
> **Owner**: Identity and Access
> **Module**: `apps/oauth2-client/`

---

## 1. Delivered Layout

```text
apps/oauth2-client/
├── api/
│   ├── admin/
│   │   ├── index.go
│   │   └── data/index.go
│   ├── healthz/index.go
│   ├── oauth/<provider>/{start,callback}/index.go
│   └── shared/container.go
├── cmd/
│   ├── server/main.go
│   └── rotate-records/main.go
├── internal/
│   ├── domain/oauth/
│   │   ├── entity/
│   │   ├── repository/
│   │   └── valueobject/
│   ├── application/oauth/
│   │   ├── port/
│   │   └── usecase/
│   ├── infrastructure/
│   │   ├── crypto/
│   │   ├── persistence/github/
│   │   ├── persistence/memory/
│   │   └── provider/
│   ├── interfaces/http/handler/
│   └── bootstrap/
├── config/
└── vercel.json
```

## 2. Ownership

| Path | Owns | Must not own |
|---|---|---|
| `domain/oauth/entity` | durable domain records and invariants | JSON, HTTP, GitHub |
| `domain/oauth/repository` | cohesive store contract and typed errors | Git/file operations |
| `application/oauth/usecase` | start, callback, refresh, admin projection orchestration | provider/GitHub payloads |
| `application/oauth/port` | provider-neutral OAuth gateway contract | persistence |
| `infrastructure/crypto` | key ring and envelope codec | repository paths |
| `infrastructure/persistence/github` | GitHub App auth, Git Data CAS, encrypted records | OAuth redirect behavior |
| `infrastructure/persistence/memory` | deterministic local/test adapter | production durability claims |
| `infrastructure/provider/*` | provider HTTP and token normalization | identity persistence |
| `interfaces/http/handler` | request validation, redirect, Basic auth, sanitized rendering | credential plaintext readback |
| `bootstrap` | environment validation and dependency assembly | domain mutation |
| `cmd/rotate-records` | explicit full-record key rotation | browser/admin mutation |

## 3. Dependency Direction

```text
api/cmd -> bootstrap -> interfaces + infrastructure
interfaces -> application -> domain
infrastructure -> application ports + domain
domain -> standard library only
```

Forbidden:

- domain importing application, infrastructure, or interfaces;
- use cases importing GitHub-specific packages;
- provider adapters importing persistence;
- browser JavaScript calling GitHub or receiving token values;
- memory persistence selected implicitly on Vercel.

## 4. Test Placement

| Concern | Location |
|---|---|
| domain/use-case behavior | adjacent `*_test.go` |
| AES-GCM/key rotation | `internal/infrastructure/crypto` |
| GitHub App/Git Data protocol | `internal/infrastructure/persistence/github` with `httptest.Server` |
| provider exchange/refresh | each provider package with deterministic HTTP endpoints |
| handler/admin security | `internal/interfaces/http/handler` |
| cross-container journey | `internal/bootstrap` or acceptance Gate fixture |
| full-prefix key rotation | GitHub store contract tests plus maintenance command test |

## 5. Cross-Runtime Handoff

| Path | Owns |
|---|---|
| `model/domain/oauth/oauth.proto` | signed broker bridge request and response wrapper |
| `model/domain/oauth/mobile_oauth.proto` | canonical Station OAuth candidate, credential envelope, status, cancellation, and acknowledgement contracts |
| `apps/station/frame/touch/auth/oauth_bridge.go` | assertion verification, one-time consumption, provider identity resolution |
| `apps/station/app/subserver/oauth/` | Access Attempt binding, inactive candidate, encrypted credential delivery, acknowledgement |
| `apps/desktop/src-tauri/src/application/oauth2/` | loopback receiver proof, candidate decryption, durable local commit, acknowledgement |

The bridge handler must delegate session lifecycle work to
`apps/station/app/subserver/oauth/`; it must not create a parallel candidate or
session store.

## 6. Public Surface

Existing start, callback, and health routes remain stable. New public paths are
limited to authenticated read-only administration:

```text
GET /api/admin
GET /api/admin/data
```

There is no public credential read or refresh route in this release.
