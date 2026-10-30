# Module 5: Provider and Model Acceptance

Architecture: [Peers Design](peers-design.md). Updated: 2026-10-30.

## Shared management

- Valid live Dashboard administrator sessions can configure shared Providers,
  models, write-only credentials, grants and the personal policy.
- Actor JWTs, revoked administrator sessions and insufficient roles cannot
  perform those mutations.
- Concurrent configuration and grant writes reject stale revisions without
  partial replacement.
- Secrets are encrypted at rest, remain absent from read responses and fail
  closed when the KEK is unavailable.

## Authorized consumption

- No grant means no available shared model.
- Actor-specific and model-specific grants expose exactly the allowed catalog.
- Shared identity takes precedence; denial never uses a private same-named
  Provider.
- Storage UUIDs cannot bypass owner or grant checks.
- Disablement, grant revocation and stale Provider revisions block subsequent
  dispatches and resumed tool continuations.
- One-shot applet completion resolves the Actor's Station default and applies
  the same Provider dispatch authority.

## Personal policy and defaults

- Personal management is disabled by default and rejected by Station.
- Enabling the policy permits only the current Actor's personal resources.
- Defaults persist as a composite Provider/model pair with a CAS revision.
- Switching accounts discards old reads, writes and optimistic rollback.
- Duplicate model IDs remain distinct in default, composer, Agent and Cron
  selection. Bare IDs resolve only when unique.

## CLI installation and runtime

- Dashboard retains all four registered adapters when binaries are missing.
- Option backgrounds show real installation progress. Failed jobs expose retry
  and the official guide; unsupported TRAE installation remains manual.
- Installation deduplicates by adapter; failed upgrades preserve the active
  immutable version.
- Direct calls and CLI invocations consume the effective owner's credentials.
- Machine and managed executables use private Actor HOME, tool state, cache,
  temporary files and workspaces.
- Discovery has its effective-owner scope and Provider revision, preserves
  valid catalogs on failure, and cannot create mutable CLI model records.
- Cancellation and timeout terminate process groups and finish workers before
  retry or shutdown.

## UI and evidence

Ordinary Desktop has authorized read-only shared Provider views, its personal
default and policy-enabled personal editing. It exposes no shared management,
installer or Federation Settings section.

Dashboard AI and Federation pages mount only while active. Provider forms mount
only for the selected Provider. Wide and narrow layouts have no horizontal
overflow; option progress, recovery, official links and secret draft teardown
require rendered observations.

Verification is scoped to affected source tests, frontend/native checks and
real current-source product journeys. Unit regressions and direct CLI output
are supporting evidence. Real installation, shared upstream calls, native
account switching and administrator UI recovery remain unproven until exercised
against the canonical current-source runtime.
