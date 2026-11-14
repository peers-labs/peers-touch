# Module 5: Provider and Model Infrastructure

Status: accepted. Updated: 2026-10-30.

## Product and authority

[Provider Control Plane](../../provider-control-plane.md) owns resource and
authorization semantics. Dashboard manages shared Providers, credentials,
models, grants, personal policy and CLI installation through Agent services.

Ordinary Desktop Settings shows authorized Provider/model data and readiness.
AI / Models changes only the account's default model. Personal Provider editing
appears only when Station enables the personal policy. Federation management
is in Dashboard.

The management catalog retains TRAE CLI, Codex, Cursor and Claude Code even when
uninstalled. Missing adapters show installation guidance, installation fills
the option background with progress, and failures offer retry and the official
guide. TRAE remains manual until an accepted installer exists.

## Schemas

Dashboard mounts one selected Provider editor. Direct Providers own Base URL,
write-only credentials and custom model CRUD. CLI Providers own only supported
typed runtime fields, registered adapter facts and discovered model catalogs.
CLI model CRUD, per-model switches, arbitrary executable inputs and shell
templates are invalid.

Desktop shared Provider detail is read only and exposes no credentials,
commands, grants or installation internals. Policy-enabled personal detail
uses a selected-only Direct or CLI schema; CLI runtime overrides remain
capability driven.

## Model identity and discovery

Every model is identified by `(provider_id, model_id)`. Settings defaults,
Agent profiles, composer and Cron selections compare that pair.
Bare model IDs resolve only when unique.

Direct models are effective-owner persistence records. CLI discovery atomically
replaces one effective-owner, Provider-revision-bound snapshot. Failed discovery
preserves the previous valid catalog. Provider detail and admission consume
the same catalog; consumer visibility additionally applies grants.

## Runtime and store coordination

Station resolves owner and revalidates enablement, model access, grants and
snapshots immediately before dispatch. Shared installation is independent of
Actor identity. Invocation state is always private to the requesting Actor.

Desktop `agent-capability` owns Provider/model/default bootstrap and
reconciliation. Provider actions refresh their list, selected detail and
`useAgentStore.availableModels`. The Station default is the only persistent
default authority; Desktop stores only the current Session projection.

Account changes clear projections and fence pending reads, writes and rollback
effects. Dashboard authentication changes clear management state and secret
drafts.

## UI lifetime and security

Settings retains its alive shell and selected-only lazy schemas. The Provider
list owns one inner vertical scroll container. Dashboard mounts one active page
and selected Provider editor; installation polling stops on navigation.

Credentials remain encrypted on Station and are never returned in read
projections. CLI environments cannot override private state or carry secrets.
Structured argv, bounded output and process-group termination protect
execution lifetime.
