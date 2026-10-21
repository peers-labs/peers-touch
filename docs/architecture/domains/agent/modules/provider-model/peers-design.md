# Module 5: Provider and Model Infrastructure

> Status: ACCEPTED
> Updated: 2026-10-18

## 1. Product Contract

Provider Settings presents one mixed Direct/CLI list and mounts exactly one
selected schema.

- Direct connects a model API and owns custom model CRUD.
- CLI configures a Station-registered adapter and reads its discovered catalog.
- Both can be enabled or disabled.
- `Show usable only` is persisted and uses shared Provider readiness.
- AI / Models owns only the global default model.

CLI model CRUD, model toggles, bulk actions, executable-path inputs, and shell
templates are not product capabilities.

## 2. Ownership

```text
Station
  Provider catalog
  actor-scoped Provider config and credentials
  actor-scoped CLI runtime model catalog
  Direct model records
  CLI check/discovery/execution
  runtime admission

Desktop Rust
  authenticated Station proxy only

Desktop Web
  Provider/model projections
  selected-only Direct or CLI schema
  user intent and local form draft
```

Provider/model availability has one Station source consumed by Settings, Agent
defaults, composer selection, and Cron overrides.

## 3. Contracts

`model/domain/agent/provider.proto` defines:

- `ProviderRuntimeConfig`
- `ProviderAdapterCapabilities`
- `ProviderModelInfo`
- Provider check
- Provider model discovery
- legal Direct Provider/model CRUD

Desktop exposes `provider_check` and `model_discover` as thin commands. There is
no Desktop-local CLI discovery or batch mutation command.

## 4. Direct Schema

Direct Provider detail may expose:

- enabled state;
- API key and Base URL;
- Station reachability check;
- custom model create/edit/enable/remove;
- model capability and context metadata.

Direct model mutation refreshes Provider detail and the shared Agent model
projection.

## 5. CLI Schema

CLI Provider detail exposes:

- enabled state and readiness check;
- default model;
- startup arguments, one argv entry per line when supported;
- environment, one `KEY=VALUE` entry per line when supported;
- timeout when supported;
- restore defaults and explicit Save;
- registered command, workspace policy, and capabilities as read-only facts;
- read-only model catalog;
- Refresh only when `model_discovery` is true.

Station validates and persists one complete typed runtime config. Enable/disable
must preserve that config.

## 6. Model Discovery

An explicit Refresh invokes Station discovery. Station executes registered argv,
normalizes bounded output, and atomically replaces the actor-scoped runtime
catalog. The same catalog feeds Provider detail and runtime admission.

Discovery output includes description, context window, capabilities, and
reasoning metadata. The UI must not convert discovered CLI models into mutable
database records.

## 7. Composite Identity

Every selectable model is identified by `(provider_id, model_id)`.

```typescript
interface ModelRef {
  provider: string;
  model: string;
}
```

Select option keys, selected-row checks, default fallback, Agent profile,
composer, and Cron override all compare the pair. A bare model ID resolves only
when unique.

## 8. Store Coordination

`useProviderStore` owns Provider administration and refreshes:

1. Provider list.
2. Selected Provider detail.
3. `useAgentStore.availableModels`.

`useAgentStore` owns the runtime model projection and stores
`defaultProviderId/defaultModel` and
`selectedProviderId/selectedModel` as pairs.

## 9. UI Tree and Scroll Ownership

- Settings page: alive shell.
- Provider section: selected-only lazy schema.
- Provider list: one inner vertical scroll owner with a thin scrollbar.
- Settings section host: overflow hidden for Providers, so it does not create a
  second scrollbar.
- CLI Advanced content mounts only while expanded.

## 10. Security

- Credentials remain Station-owned.
- Desktop never persists secrets to local Provider state.
- CLI environment cannot override Station-owned variables or carry secret-like
  keys.
- Registered argv is structured; no whitespace splitting or shell evaluation is
  used.
- Discovery output and process lifetime are bounded.
