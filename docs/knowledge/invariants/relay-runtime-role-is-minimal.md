---
kind: invariant
title: Relay runtime composition is deny-by-default
status: active
owns:
  - apps/station/app/main.go
  - apps/station/frame/peers.go
  - apps/station/frame/core/plugin/native/node/
  - apps/station/frame/core/plugin/native/subserver/relay/
  - apps/station/frame/core/runtime/role/
  - tooling/docker/
  - tooling/scripts/local-dev/relay-check.sh
  - tooling/scripts/local-dev/relay-dev.sh
  - tooling/scripts/local-dev/relay-status.sh
  - tooling/scripts/local-dev/station-dev.sh
referenced-by: []
related:
  - docs/architecture/platform/station/access/design.md
  - docs/architecture/platform/station/access/decisions.md
  - docs/architecture/shared/federation/integration.md
detected: 2026-10-06
---

# Relay runtime composition is deny-by-default

## What must hold

The Station binary MUST resolve exactly one explicit `PEERS_NODE_ROLE` at its
composition root. The `relay` role MUST exclude Touch routes, application
business subservers, and every native plugin except the Relay plugin. New
plugins are denied until the role allowlist is deliberately updated.

Relay startup MUST fail before storage or listeners initialize when its public
origin, TLS configuration, signing key, operator policy, or quotas are missing.
The only plaintext exception is explicit and loopback-only. Relay operator
routes MUST use a signing key, issuer, audience, and scope that are independent
from Station application JWTs.

## Why this is non-negotiable

Relay is an Internet-facing transport role, not a Station business authority.
Loading Actor, OAuth, Conversation, Social, Agent, OSS, or Federation governance
routes expands its attack surface and creates a second place where business
state can be reached.

Shared application JWTs let any authenticated Station user call Relay operator
routes. Optional TLS silently turns a missing deployment secret into plaintext.
Both failures are configuration mistakes that must stop the process.

## How to verify

- `go test -race -count=1 ./apps/station/frame/core/runtime/role/... ./apps/station/frame/core/plugin/native/subserver/relay/...`
  passes.
- `python3 tooling/scripts/acceptance-run.py --gate relay-role-security-contract`
  passes.
- `rg -n '192\.0\.2\.12:7784' apps/station` returns no matches.
- `tooling/docker/entrypoint.sh` rejects a missing or unknown
  `PEERS_NODE_ROLE`.

## Crosswalks

- Station Access decision `SAL-D11` defines the minimal Relay role.
- `relay-readloop-discipline.md` continues to govern the allowed Relay plugin.
