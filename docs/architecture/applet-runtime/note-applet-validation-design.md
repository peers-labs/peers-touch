# Note Applet Validation Design

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-17
> **Owner**: Architecture Team
> **Module**: `apps/applets/note/`, `model/domain/note/`, `apps/desktop/`, `apps/mobile/`, `apps/station/`

---

## 1. Purpose

Note is the first official applet used to validate the Peers-Touch applet architecture as a real product path. It must prove that an applet can own a frontend and backend service while being injected into Desktop and Mobile through the same Host contract.

Note is not a Desktop page migration exercise. It is an applet runtime validation product.

## 2. Goals

- Build Note as an official applet under `apps/applets/note`.
- Give Note its own DDD-led service.
- Allow the Note service to run as a Station-bundled subserver.
- Keep standalone service deployment as a first-class architecture path.
- Access the Note backend only through applet SDK network service binding.
- Validate Host UI, navigation, events, storage, telemetry, error mapping, and service binding on a real product workflow.

## 3. Non-Goals

- Do not implement Note as `apps/desktop/src/pages/NotesPage.tsx`.
- Do not call existing `notebook_*` Desktop commands from the applet.
- Do not implement Note business rules in Desktop or Mobile.
- Do not store official Note data in applet local storage.
- Do not use raw backend URLs from applet frontend code.
- Do not claim Mobile readiness before a real Mobile Host gate exists.

## 4. Product Unit Layout

```text
apps/applets/note/
├── README.md
├── applet.manifest.json
├── service.manifest.json
├── frontend/
│   ├── package.json
│   ├── rspeedy.config.ts
│   ├── src/
│   │   ├── domain/
│   │   │   └── note.ts
│   │   ├── application/
│   │   │   ├── noteCommands.ts
│   │   │   └── noteQueries.ts
│   │   ├── infrastructure/
│   │   │   └── capability/
│   │   │       └── noteClient.ts
│   │   ├── presentation/
│   │   │   ├── pages/
│   │   │   │   ├── NoteListPage.tsx
│   │   │   │   └── NoteEditorPage.tsx
│   │   │   └── components/
│   │   └── index.tsx
│   └── locales/
├── service/
│   ├── domain/
│   ├── application/
│   ├── infrastructure/
│   ├── transport/
│   ├── stationadapter/
│   └── standalone/
├── contracts/
│   └── README.md
├── docs/
└── tests/
```

Proto source:

```text
model/domain/note/v1/note.proto
```

The `contracts/` directory may document API mapping and generated artifacts, but it does not replace `model/domain`.

## 5. Domain Model

Minimum Note aggregate:

```text
Note
  note_id
  owner_id
  title
  content
  created_at
  updated_at
  deleted_at
```

Minimum domain rules:

- A note belongs to one owner.
- A deleted note is not returned by normal list/search.
- Empty title is allowed only when content is non-empty; UI may derive a display title.
- Update must preserve identity and ownership.
- Search returns owner-scoped notes only.
- Restore returns a soft-deleted note to normal list/search visibility.

Domain events:

```text
note.created
note.updated
note.deleted
```

## 6. Service API

Proto service shape:

```proto
service NoteService {
  rpc ListNotes(ListNotesRequest) returns (ListNotesResponse);
  rpc GetNote(GetNoteRequest) returns (GetNoteResponse);
  rpc CreateNote(CreateNoteRequest) returns (CreateNoteResponse);
  rpc UpdateNote(UpdateNoteRequest) returns (UpdateNoteResponse);
  rpc DeleteNote(DeleteNoteRequest) returns (DeleteNoteResponse);
  rpc RestoreNote(RestoreNoteRequest) returns (RestoreNoteResponse);
  rpc SearchNotes(SearchNotesRequest) returns (SearchNotesResponse);
}
```

HTTP mapping for Host Gateway:

```text
GET    /v1/notes
GET    /v1/notes/{note_id}
POST   /v1/notes
PATCH  /v1/notes/{note_id}
DELETE /v1/notes/{note_id}
POST   /v1/notes/{note_id}:restore
GET    /v1/notes:search?q=
```

Station-bundled route may be mounted under an internal prefix such as `/applets/note/v1`; Gateway exposes only service binding semantics to applet code.

## 7. Applet SDK Usage

The Note frontend accesses backend data through the service name:

```typescript
await sdk.network.request({
  service: 'note',
  method: 'POST',
  path: '/v1/notes',
  body: {
    title,
    content
  }
})
```

Required SDK capabilities:

| Capability | Note usage | Framework requirement |
|------------|------------|-----------------------|
| `network.request` | CRUD/search | service binding, identity injection, error mapping |
| `ui.showToast` | save/delete feedback | Host-level localized feedback |
| `ui.confirm` | delete confirmation | Host-level modal contract |
| `ui.showLoading` | list/save pending state | Host-level feedback |
| `navigation.navigateTo/back` | list/editor flow | applet-internal navigation |
| `events.emit/subscribe` | list refresh after edit | real Host event channel |
| `storage.get/set/remove` | local draft only | applet/account/station scoped storage |
| `telemetry.track/reportError` | metadata-only product metrics | real sink or explicit not-ready status |
| `app.getRuntimeContext` | diagnostics and session awareness | no token exposure |

## 8. Runtime Flow

Create note:

```text
NoteEditorPage
  -> application create command
  -> noteClient.createNote
  -> sdk.network.request(service=note, path=/v1/notes)
  -> Lynx Bridge
  -> Desktop/Mobile Host Gateway
  -> service permission check
  -> identity context injection
  -> Station bundled Note subserver or standalone Note service
  -> Note application service
  -> repository
  -> response normalized through Gateway
  -> sdk.ui.showToast(messageKey=note.saved)
  -> sdk.events.emit(note.updated)
  -> sdk.navigation.back()
```

The same frontend code must work when the service binding target changes from Station-bundled to standalone.

## 9. Desktop Injection

Desktop responsibilities:

- discover Note applet artifact.
- validate `applet.manifest.json`.
- create Lynx Host session.
- inject SDK bridge.
- dispatch SDK calls to Rust Host Gateway.
- bind `service: note` to the active service target.
- emit audit records.

Desktop must not contain:

- Note page implementation.
- Note store.
- Note API client.
- Note repository.
- calls to existing `notebook_*` commands from the applet path.

## 10. Mobile Injection

Mobile uses the same applet artifact and manifest contract:

```text
Note artifact
  -> Mobile applet registry
  -> LynxView / Tauri Mobile Host
  -> Mobile BridgeAdapter
  -> Mobile Gateway
  -> Note service binding
```

Mobile may initially be documented as planned if the real Host gate is not implemented. The design must still keep Note free from Desktop-only APIs.

## 11. Validation Gates

Required real gates:

| Gate | Must prove |
|------|------------|
| Note package contract | manifest, bundle, integrity, locale assets are valid |
| SDK dependency scan | Note frontend uses SDK and does not import Desktop/Mobile internals |
| Raw network scan | Note frontend has no raw backend URL access |
| Station bundled service test | Note service works as Station subserver |
| Standalone service smoke | Same service contract works outside Station when enabled |
| Gateway binding test | `service=note` reaches real Note service |
| Desktop live host smoke | Desktop Host loads Note and performs CRUD through Gateway |
| Failure-path test | permission denied, service unavailable, invalid note id, timeout |
| Evidence classifier | output labels real, controlled, mocked, not implemented |

Mocked SDK or gateway harnesses can be used during development, but cannot satisfy the real readiness gate.

## 12. Readiness Target

The Note validation target is:

```text
L3 OFFICIAL_APPLET_DESKTOP_READY
```

Definition:

- Desktop Host runs Note as an applet.
- Note backend is not Desktop code.
- CRUD/search are real and persistent.
- Gateway service binding is enforced.
- failure paths are typed and observable.
- evidence shows no mock backend in the product path.

Mobile support can remain:

```text
L2 MOBILE_CONTRACT_READY
```

until the Mobile Host executes the same Note flow.
