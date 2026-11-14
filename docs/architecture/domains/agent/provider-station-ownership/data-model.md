# Provider Station Ownership — Data Model

Status: accepted. Owner: Agent domain. Updated: 2026-10-30.

The wire sources are `model/domain/agent/provider.proto` and
`model/domain/agent/agent.proto`. Persistence types live under
`apps/station/app/subserver/agent/infrastructure/persistence`.

## Owner identity

Every Provider, model and credential record has `scope` and `actor_ptid`.
`scope=station` requires an empty Actor owner. `scope=actor` requires a canonical
PTID. An empty Actor never implicitly selects Station ownership.

`agent_providers` uses UUID storage identity and a logical `name`. Its unique
owner key is `(scope, actor_ptid, name)`. It stores enablement, protocol,
registered adapter metadata, typed runtime configuration, `version` and the
independent `access_revision`.

`agent_models` uses `(scope, actor_ptid, provider_id, model_id)` as the unique
owner key. Direct models are mutable owner-bound records. CLI catalogs are
read-only runtime snapshots keyed by owner, logical Provider and Provider
revision; successful discovery replaces one complete snapshot atomically.

The ownership migration assigns existing private records `scope=actor` without
turning them into shared records. Storage UUID lookup must verify the resolved
owner and logical identity before dispatch.

## Credentials

`agent_providers.key_vaults` stores an encrypted envelope, never a raw API key.
The envelope uses the existing Station KEK provider and authenticates the
Provider record, owner and logical identity as associated data.

The credential pool follows the same owner resolution. An Actor with permission
to use a shared Provider cannot retrieve its credential. Administrator reads
also return status only. Missing or unusable KEK fails closed before mutation.
Credential changes invalidate the Provider configuration revision.

## Policy and access

`agent_provider_policy` contains one Station resource with
`personal_providers_enabled=false` and an optimistic `revision`.

`agent_provider_access_grants` belongs to a Provider storage record.
Each grant chooses a specific `actor_ptid` or `all_actors`, and a specific
`model_id` or `all_models`. Contradictory or empty selectors are invalid.
An empty grant set permits no consumer use.

Grant replacement and the Provider's `access_revision` update occur in one
transaction using the observed revision. Access changes do not bump unrelated
configuration versions; every dispatch validates current grants separately.

## Defaults and projections

`agent_runtime_defaults` is the existing Actor-scoped default selection store.
It persists `(default_provider_id, default_model_id)` and a CAS revision.
Desktop caches this projection in the current Session and never writes an
app-global `model-registry.json`.

Authorized consumer projections carry Provider/model identity, capability,
readiness and relevant revisions. They exclude credentials, commands, private
directories, installation internals and grants. Personal management projections
remain distinct and require the personal policy.

All selectors use the composite `(provider_id, model_id)`. Bare model IDs resolve
only when unique; list order cannot establish identity.
