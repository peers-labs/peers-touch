# Desktop Provider and Model Architecture

## Authority

[Provider Control Plane](../../architecture/domains/agent/provider-control-plane.md)
defines shared and personal authority. Station owns catalogs, credentials,
configuration, access, discovery, installation and execution.

Dashboard is the shared management surface. Desktop Rust is an authenticated
transport. Desktop Web renders authorized data and submits personal intent.
Shared installation and private Actor invocation state have separate owners.

## Ordinary Desktop Settings

Provider Settings has one authorized Provider list and a selected read-only
`AuthorizedProviderDetail`. Shared credentials, commands, grants, installation
paths and administration are absent.

The authorized list has no runtime-kind badges, health dots or credential
filters. Model rows show a readable model name and its personal default action.
Only chat models offer that action. A missing catalog asks the user to obtain
access; it does not ask them to configure a shared credential.

Personal Provider editing appears only under the Station policy. Its selected
Direct schema handles write-only credentials, Base URL and model CRUD. Its CLI
schema exposes capability-declared runtime overrides and a read-only catalog;
arbitrary executables and mutable CLI models are invalid.

AI / Models owns the Actor's composite default through the existing Station
runtime-default API with its observed revision. No app-global
`model-registry.json` or service-slot registry remains.

Settings preserves its alive shell and selected-only lazy schemas. The Provider
list owns one inner vertical scroll container. Account changes discard form
drafts and pending projection or mutation effects.

The narrow Desktop window stacks the bounded Provider list above its detail.
The list and selected detail own their respective scrolling and recovery
surfaces. List loading, detail loading and default saving do not share a
spinner. Failed detail reads clear the previous content and offer retry.

## Runtime

The `agent-capability` runtime bootstraps and reconciles Provider, model and
default projections. All model selectors compare `(provider_id, model_id)`.
Account or Station replacement clears projections and fences late reads,
writes and rollback by Session epoch.

The Provider store also invalidates reads by request identity and view/reset
generation. Reconciliation refreshes only the selected detail. It retains no
parallel detail cache. Policy withdrawal exits personal editing and invalidates
its in-flight effects. Default reads have their own lifecycle; an unread or
failed default cannot supply an invented revision zero, and a save invalidates
older reads before sending its CAS request.

```text
Desktop intent
  -> authenticated native Station proxy
  -> effective-owner Agent service
  -> current model/grant/revision admission
  -> Station HTTP or CLI dispatch
  -> Station response projection
```

Applet `ai.chat` uses Station QuickCompletion with an explicit pair or the
Actor's default and returns the actual Provider/model identity. Desktop executes
neither upstream HTTP inference nor Provider subprocesses.

## Contracts and verification

`model/domain/agent/provider.proto` and `agent.proto` define the wire contract.
Provider/default/Agent/Session focused tests and native type checks support the
contract. Real shared calls, revocation, account switching, policy changes and
wide/narrow rendering require current-source product observations.

Federation remains an internal read-only context runtime for communication.
All Federation lifecycle management is in Dashboard.
