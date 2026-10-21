# Provider Runtime Strategy

> Status: ACCEPTED
> Updated: 2026-10-18

## 1. Decision

Station owns Provider registration, configuration, credentials, model catalogs,
runtime admission, CLI process execution, and output normalization.

Desktop Rust is a typed transport adapter. It must not execute Provider CLIs,
parse CLI output, maintain a second Provider registry, or infer a model's
Provider from a bare model ID.

## 2. Runtime Kinds

### Direct

Direct providers use Station-owned protocol adapters and actor-scoped
credentials. Their models are actor-scoped persisted records and support custom
create, update, enable, and remove operations.

### CLI

CLI providers are registered Station adapters.

The catalog declares:

- structured execution argv;
- optional structured model-discovery argv;
- default model and timeout;
- workspace policy;
- client-configurable runtime fields;
- adapter capability facts.

Station verifies the registered executable, applies actor-scoped typed runtime
configuration, executes in the approved Agent workspace, bounds process lifetime
and output, and maps failures to typed runtime errors.

Arbitrary executable paths, shell templates, and free-form command strings are
not client inputs.

## 3. CLI Runtime Configuration

`ProviderRuntimeConfig` is the only mutable CLI configuration contract:

```text
default_model
startup_args[]
environment{KEY: VALUE}
timeout_seconds
```

Station validates configuration against `ProviderAdapterCapabilities`.
Station-owned environment keys and secret-like environment entries are
rejected. Credentials remain in Station credential storage.

## 4. Model Discovery

Model discovery is an explicit Station operation:

```text
DiscoverProviderModels(provider_id)
  -> registered model_catalog_argv
  -> bounded process execution
  -> provider-specific normalized metadata
  -> atomic actor-scoped runtime catalog replacement
  -> Provider detail + runtime admission
```

The runtime catalog key is `(actor_ptid, provider_id)`. One actor's CLI profile
must never replace another actor's catalog.

Discovery preserves:

- stable model ID and display name;
- description and context window;
- input/runtime capabilities;
- default and supported reasoning levels;
- supported/visible filtering and source priority.

Failed discovery preserves the last valid snapshot. CLI models are read-only:
no manual add/edit/delete, per-model toggle, hidden-model override, or bulk
toggle is legal.

## 5. Model Identity

The canonical identity is `(provider_id, model_id)`.

- Settings defaults persist both fields.
- Agent profile and conversation selection persist both fields.
- Composer, Cron, and every picker compare both fields.
- A legacy bare model ID may resolve only when exactly one available model has
  that ID. Ambiguous IDs fail closed to the configured composite default.

## 6. Client Projection

Settings renders one mixed Provider list and one selected schema:

- Direct schema: API key, Base URL, check, and custom model CRUD.
- CLI schema: enabled state, typed runtime config, check, restore defaults,
  save, read-only registered command/workspace/capabilities, and read-only model
  catalog with capability-driven Refresh.

AI / Models owns only the global default selector. It does not duplicate the
Provider model directory.

## 7. Failure Semantics

- Missing registered binary: Provider check reports unavailable with install
  guidance.
- Invalid runtime config: update fails before persistence.
- Discovery timeout, invalid output, or process failure: request fails and the
  previous catalog remains authoritative.
- Disabled Provider or unavailable adapter: runtime admission fails before
  execution.
- Ambiguous model ID: no Provider is selected by list order.

## 8. Verification

- Station CLI parser/executor and process-termination tests.
- Actor-scoped runtime catalog isolation test.
- Provider handler mutation rejection tests for CLI models.
- Runtime admission tests over discovered catalogs.
- Desktop transport, schema, and composite-identity tests.
- Exact-source Native Journey for check, discovery, save/restore, Provider
  disable fallback, composer selection, and one real CLI turn.
