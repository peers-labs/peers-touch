# Note Official Applet

This official applet follows the Peers-Touch official applet architecture contract.

Architecture source:

- `docs/architecture/applet-runtime/official-applet-architecture-contract.md`
- `docs/architecture/applet-runtime/note-applet-validation-design.md` when this applet is Note

## Product Unit

```text
apps/applets/note/
  frontend/
  service/
  contracts/
  docs/
  tests/
```

## Identity

- Applet id: `peers.note`
- Service: `note`

## Boundaries

- Frontend uses `@peers-touch/applet-sdk` for Host capabilities.
- Service follows DDD boundaries.
- Proto source stays under `model/domain/note/`.
- Desktop, Mobile, and Web Hosts load built artifacts instead of importing product source.

## Frontend Product State

The current frontend is a ReactLynx applet that lists, creates with user input,
searches with user input, selects, edits, soft-deletes, restores notes, and keeps
local editor drafts through SDK storage. Typed failure states have first-pass UI
classification. Reload persistence is covered by
`pnpm applet:note-reload-persistence-gate`.

## Frontend Verification

Use these commands after frontend changes:

```bash
pnpm --filter @peers-touch/note-official-applet check
pnpm --filter @peers-touch/note-official-applet build
pnpm applet:note-frontend-sdk-gate
pnpm applet:note-forbidden-scan
pnpm applet:note-reload-persistence-gate
```

`pnpm applet:note-frontend-sdk-gate` proves the frontend does not use raw backend URLs, Tauri/Desktop/Mobile/Station private imports, or direct Bridge access, and that formal Note data calls are centralized through `sdk.network.request({ service: "note" })`.
