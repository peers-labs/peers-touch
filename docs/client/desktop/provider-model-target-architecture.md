# Desktop Provider + Model Target Architecture

## 1. Authority

Station is the only Provider and model-catalog authority.

- `providers.default.yaml` registers built-in Direct and CLI adapters.
- Actor-scoped Provider records store enabled state, credentials, Direct configuration, and typed CLI runtime overrides.
- Desktop Rust is a transport adapter. It must not execute Provider CLIs, parse model output, or keep a second model catalog.
- Desktop Web renders Station projections and submits explicit user intent.

## 2. Provider Kinds

### 2.1 Direct

Direct providers own:

- An explicit, immutable Provider ID independent of the display name.
- API credential and Base URL.
- Custom model create, update, enable, and remove.
- Provider reachability check through Station.

### 2.2 CLI

CLI providers are registered adapters. Station owns:

- Structured execution argv and model-discovery argv.
- Binary availability checks.
- Isolated workspace policy.
- Model discovery, parsing, normalization, and runtime catalog replacement.
- Runtime admission and execution.

Desktop may edit only capability-declared `ProviderRuntimeConfig` fields:

- `default_model`
- `startup_args`
- `environment`
- `timeout_seconds`

Registered commands and workspace policy are read-only projections. Arbitrary executable paths and shell templates are not client inputs.

## 3. Model Catalog

- Direct model records are actor-scoped persisted configuration.
- CLI models are a Station-discovered, read-only runtime catalog.
- Explicit CLI refresh invokes `POST /agent/provider/model/discover`.
- Discovery replaces the actor-scoped `(actor_ptid, provider_id)` in-memory runtime catalog atomically after successful parsing.
- Failed discovery preserves the last valid catalog.
- Provider detail and Agent runtime admission consume the same effective catalog.
- CLI model CRUD, per-model toggles, and bulk toggles are invalid operations.

Every model reference is the composite identity `(provider_id, model_id)`. A bare model ID may be migrated only when it is unique; ambiguous IDs must never select a Provider by list order.

## 4. Contracts

The canonical wire contract is:

- `model/domain/agent/provider.proto`

Important projections:

- `ProviderRuntimeConfig`
- `ProviderAdapterCapabilities`
- `ProviderModelInfo`
- `CheckProviderRequest/Response`
- `DiscoverProviderModelsRequest/Response`

Desktop commands proxy these Station endpoints without adding Provider semantics:

- `provider_check`
- `model_discover`
- Provider/model CRUD for legal Direct operations

## 5. UI Ownership

Settings uses one mixed Provider list and mounts one selected schema.

- `ProviderDetail.tsx` owns Direct providers.
- `CliProviderDetail.tsx` owns CLI providers.
- CLI model rows are read-only and Refresh is shown only when `model_discovery` is true.
- AI / Models owns only the global default selector.
- The Desktop default is persisted as a composite reference in the existing
  config storage (`model-registry.json`) through the atomic file writer.
  Native restart reloads this file; an unreadable registry fails explicitly.
  It contains preference references only, while Station owns model metadata.
- All model selectors use composite identities.
- The Provider list has one inner vertical scroll owner; the Settings host does not add a second Provider scrollbar.

## 6. Runtime Flow

```text
Desktop Web intent
  -> Desktop Rust proxy
  -> Station Provider handler
  -> typed Provider service / CLI adapter
  -> Station runtime model catalog
  -> Provider detail + runtime admission
```

The Desktop process never becomes an execution or discovery authority.

## 7. Acceptance

- Provider check is executed by Station.
- TRAE model refresh returns normalized metadata from `traecli debug models`.
- A discovery failure does not erase the prior valid catalog.
- CLI configuration survives enable/disable updates.
- CLI model mutation is rejected.
- Direct custom model CRUD remains available.
- Duplicate IDs such as `codex-cli/default` and `trae-cli/default` remain distinct in Settings defaults, Topic overrides, composer selection, and Cron overrides.
- Wide and narrow Settings renders show one thin Provider-list scrollbar and no nested scroll owner.
