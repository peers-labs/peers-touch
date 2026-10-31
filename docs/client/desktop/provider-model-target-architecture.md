# Desktop Provider and Model Architecture

## Authority

[Provider Control Plane](../../architecture/domains/agent/provider-control-plane.md)
defines shared and personal authority. Station owns catalogs, credentials,
configuration, access, discovery, installation and execution.

Dashboard is the shared management surface. Desktop Rust is an authenticated
transport. Desktop Web renders authorized data and submits personal intent.
Shared installation and private Actor invocation state have separate owners.

## Ordinary Desktop Settings

AI / Models is the only model Settings surface. There is no Provider
navigation, list or Direct/CLI editor in ordinary Desktop. Shared credentials,
commands, grants, installation and administration belong to Dashboard.
Provider identity remains an internal part of the model's composite key and
may be shown as its source name.

The model selector has no runtime-kind badges, health dots or credential
filters. A missing catalog asks the user to obtain access; it does not ask them
to configure a shared credential. Dashboard uses one Provider configuration
surface with DM/CLI selection, CLI installation within its Provider, model
configuration, global AI user policy, model grants and actual-call verification.

AI / Models owns the Actor's composite default through the existing Station
runtime-default API with its observed revision. No app-global
`model-registry.json` or service-slot registry remains.

Settings preserves its alive shell and selected-only model surface. Default
loading and saving have their own lifecycle. Capability-session warmup never
reloads model or Provider catalogs; unrelated Agent loading cannot replace an
established empty model view. Dashboard retains drafts for the selected Provider
across installation polls and refreshes, and discards them on selection or
administrator-session replacement.

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
