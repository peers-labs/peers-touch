# peers.atelier Contracts

This directory documents the applet product contract. It complements the formal
projection proto source and does not replace Station orchestration models.

## Projection Contract

```text
atelier-projection.contract.json
atelier-projection.schema.generated.json
atelier-malformed-response-fixtures.json
```

This JSON file is the machine-readable source for the current
`atelier-projection/v0` product contract: projection version, event topic,
Host capability methods, Desktop gateway actions, patch kinds, and replay
metadata fields. It also records narrow method payload requirements where the
applet UI directly emits a projection-facing intent, currently
`atelier.project.createFromGoal` with `goal` / explicit `agentIds` and optional
`run.model`,
`atelier.message.send` with `taskId` / `text` and
`atelier.escalation.resolve` with `taskId` / `blockId` / `choice`.
Task lifecycle intents are also recorded: `atelier.task.setStatus` requires
`taskId` / `status` where `status` is `active | archived | deleted`, and
`atelier.task.purge` requires `taskId` after the task has already been marked
`deleted` by Station.

Run:

```bash
pnpm run atelier:projection-codegen
```

to generate `atelier-projection.schema.generated.json`, the official frontend
contract constants in
`apps/applets/atelier/frontend/src/domain/projection.contract.generated.ts`,
and the browser prototype contract constants in
`packages/prototypes/desktop/applets/atelier/src/projection.contract.generated.ts`.
Run `pnpm run atelier:projection-codegen-check` in gates to prove generated
artifacts are up to date. The generated JSON Schema and TS constants remain the
product-unit Host/Gateway contract surface.

`atelier-malformed-response-fixtures.json` holds shared malformed Host response
fixtures that must be consumed by both the official frontend gate and browser
prototype bridge gate. It currently covers provider capability discovery,
non-artifact capability responses for feedback, memory confirmation, rerun
confirmation and workspace open intents, plus artifact body / preview responses.
The shared fixtures prove fail-closed applet/client behavior for non-empty
fields, slash-command prefix, `scope=station-provider`, `readOnly=true`,
`accepted=true`, valid feedback feeds, canonical `pt-workspace://` workspace
URIs, canonical `artifact://` / `atelier-sandbox://` refs, request correlation,
expected hash checks, and Host-owned preview renderer semantics. They do not
grant provider invocation, memory writes, rerun execution, workspace launch,
artifact storage access, Host sandbox rendering, or execution authority.
`atelier:projection-contract-gate` validates the manifest sections, fixture
shape, method ownership, and fixture name uniqueness before the official and
prototype gates execute the fixtures. The same gate also checks that every
manifest section is embedded into `atelier-official-frontend-gate` generated
loops and expanded by `atelier-bridge-runtime-gate` maps, so adding a shared
fixture section without executable official/browser coverage fails the contract
gate.

## Formal Projection Proto

```text
model/domain/atelier/v1/projection.proto
apps/station/app/subserver/agent/model/atelier/projection.pb.go
apps/desktop/src/gen/proto/domain/atelier/v1/projection_pb.ts
```

P2-06 adds the formal projection proto source for Station-produced
snapshot/event/patch types and projection-facing intent responses. It is a type
anchor for the projection surface; it does not grant applet-side execution
authority. The JSON product contract remains responsible for applet manifest
methods, Host capability names, gateway actions, forbidden actions, and
generated frontend constants.

`pnpm run atelier:projection-contract-gate` reads this file and verifies that
the prototype runtime, official frontend guard, Station projection mapper,
Desktop gateway, applet manifest, and shared applet capability registry have not
drifted from it. The gate also runs the JSON codegen freshness check and checks
that the formal projection proto plus Go/TypeScript generated artifacts exist.

## Backend Source

Station agent orchestration remains the runtime source of truth for tasks,
events, checkpoints, resume, artifacts, gates, and provider execution. The
Atelier applet owns only the product-unit projection contract and frontend
consumer.

## Service Binding

```typescript
sdk.network.request({
  service: 'atelier',
  method: 'GET',
  path: '/v1/workspace'
})
```

The applet frontend must not know or construct a backend base URL.

## Capability Transport Matrix

`atelier-projection.contract.json` owns `methodTransports`, the static transport
matrix for every applet-visible Atelier method.

Station-owned applet service methods use the Station-bundled `atelier` service
binding:

```text
atelier.workspace.load           -> GET    /v1/workspace
atelier.project.createFromGoal   -> POST   /v1/projects
atelier.message.send             -> POST   /v1/messages
atelier.escalation.resolve       -> POST   /v1/escalations:resolve
atelier.task.setStatus           -> PATCH  /v1/tasks/{task_id}/status
atelier.task.purge               -> DELETE /v1/tasks/{task_id}
atelier.provider.capabilities    -> POST   /v1/provider/capabilities
atelier.feedback.submit          -> POST   /v1/feedback/submit
atelier.memory.confirmCandidate  -> POST   /v1/memory/confirm-candidate
atelier.feedback.confirmRerun    -> POST   /v1/feedback/confirm-rerun
atelier.artifact.body.fetch      -> POST   /v1/artifact/body/fetch
```

Host-local methods stay behind Desktop Gateway intents and do not become Station
service routes:

```text
atelier.workspace.open           -> handle_atelier_workspace_open
atelier.artifact.preview.open    -> handle_atelier_artifact_preview_open
```

`events.subscribe('atelier.projection.event')` is a Host-local topic
subscription. Desktop's canonical realtime supervisor owns the single
actor-scoped Station `/events/stream` connection, cursor, reconnect, and
`Resync` behavior. The applet owns neither that connection nor provider
execution, artifact production, gate execution, or memory writes.

## HTTP Mapping

```text
GET    /v1/workspace
POST   /v1/projects
POST   /v1/messages
POST   /v1/escalations:resolve
PATCH  /v1/tasks/{task_id}/status
DELETE /v1/tasks/{task_id}
POST   /v1/provider/capabilities
POST   /v1/feedback/submit
POST   /v1/memory/confirm-candidate
POST   /v1/feedback/confirm-rerun
POST   /v1/artifact/body/fetch
```

## Error Mapping

Service errors must be returned through the Station API error envelope. Applet-visible errors are normalized by Host Gateway into typed applet errors with locale message keys.
