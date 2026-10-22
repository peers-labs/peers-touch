# X Config Console Prototype

> **Status**: confirmed
> **Version**: v2.1
> **Created**: 2026-10-17 | **Updated**: 2026-10-20
> **Owner**: Client Platform

---

## Purpose

The executable prototype covers:

- catalog and release editing;
- typed validation findings;
- grouped draft diff;
- exact acknowledgement;
- immediate publication;
- publication progress/failure;
- source conflict;
- history and restore-as-new;
- signed-out, empty, wide, narrow, light, and dark states.

It does not model an external approval or separate deployment workflow.

## Source

`packages/prototypes/control/x-config/`

Run through:

```sh
make run-prototype
```

Prototype Portal route: `control` -> `X Config`.

## Design Contract

- Product thesis: one operator publishes one exact reviewed typed revision.
- Surface: dense control console.
- Main subject: draft versus latest signed publication.
- Primary action: `Publish now`.
- Signature feature: revision strip with source/publication state.
- Shared UI Identity applies; there is no dedicated module UI ID.
- Quiet Protocol Minimalism governs density and hierarchy.

## Status

Ledger status: `confirmed`.

The 2026-10-19 product amendment removed approval waiting and changed the
primary action to synchronous direct publication. Prototype source, manifest,
product docs, and production console were updated together.

## Evidence Boundary

Verified on 2026-10-19:

- TypeScript check and production build passed.
- 1440x900 and 390x844 rendered screenshots were inspected.
- Both viewports had zero horizontal overflow.
- Exact-diff acknowledgement -> `Publish now` -> published state passed in a
  real browser interaction.

Failure recovery, conflict recovery, screen-reader behavior, and field
performance remain interaction-level `UNPROVEN` after the amendment.

Prototype evidence proves interaction only. It does not prove OAuth, GitHub
CAS, operator-state persistence, signing-key custody, persisted bytes, Home
deployment, or client signature verification.
