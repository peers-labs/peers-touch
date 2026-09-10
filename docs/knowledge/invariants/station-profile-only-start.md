---
kind: invariant
title: Station starts through profile pipeline only
status: active
owns:
  - apps/station/app/
  - tooling/scripts/local-dev/station-dev.sh
  - tooling/docker/compose.yml
referenced-by: []
related:
  - AGENTS.md  # §5 Iron Laws — "Station Runs Through Profile Only"
detected: 2026-09-10
---

# Station starts through profile pipeline only

## What must hold

Station MUST be started exclusively via `make station`. The active profile
(`make profile <name>`) determines mode, host, ports, database, and all
runtime parameters. Direct `go run`, `go build` + manual execution, or
`docker compose up` outside of `make station` are forbidden.

## Why this is non-negotiable

The profile pipeline (`station-dev.sh`) enforces:

1. **Host consistency guard** — validates that the deploy env's target host
   matches the profile's declared Station URL before deploying. Without this,
   a stale or cross-profile deploy env silently deploys code to the wrong
   remote machine.

2. **Compose project isolation** — each profile gets its own compose project
   name and database, preventing data collision between profiles.

3. **Health-check contract** — the pipeline waits for Station to pass its
   health endpoint before declaring success, catching schema panics and
   configuration errors immediately.

Bypassing the pipeline has caused: silent deployment to wrong hosts (profile
`four` deploying to `fiveArm`'s machine), CA-W5 schema panics on stale
databases, and port conflicts between worktrees.

## How to verify

- `rg 'go run.*station\|go build.*station' tooling/ apps/ --glob '*.sh' --glob '*.mk'` — must return zero hits outside of `station-dev.sh`'s `start_source_station` function.
- `rg 'docker compose.*up.*station' tooling/ --glob '*.sh'` — must return zero hits outside of `station-dev.sh`'s `start_compose_station` function.
- All Station startup in CI/scripts routes through `make station` or `station-dev.sh`.

## Crosswalks

- See pitfall `pitfalls/deploy-env-host-mismatch.md` for the bug that revealed this need (once written).
- AGENTS.md §5 "Station Runs Through Profile Only" is the agent-facing declaration of this invariant.
