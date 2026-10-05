---
name: "pt-prototype-sync-guardian"
description: "Keeps product implementation and prototypes aligned. Invoke when implementation changes UI/UX, flows, states, copy, or product behavior covered by a prototype."
---

# Prototype Sync Guardian

Project-wide Peers-Touch guardrail for preventing product / prototype
split-brain during implementation. It applies to any user-facing Desktop,
Mobile, Station Dashboard, applet, or web surface with prototype coverage.

## Invoke When

Invoke this skill when implementing, integrating, or fixing a product area and
any of the following happens:

- The product UI, interaction, navigation, information hierarchy, layout, copy,
  empty/error/loading state, permission state, or status flow differs from the
  confirmed or current prototype.
- A real runtime constraint forces the implementation to change behavior shown
  in the prototype.
- A backend / Station / Desktop / Mobile / Applet contract changes what the user
  can see or do in the prototype.
- A component, capability, or flow covered by `packages/prototypes/**` changes
  meaning during implementation.
- The agent is about to report a product implementation as done while the
  corresponding prototype has not been checked.

Do not invoke for invisible refactors, pure backend internals, tests, generated
code, or formatting unless they alter visible product behavior.

## Core Rule

If visible product behavior changes, do one of these in the same workstream:

- Update the matching prototype and docs.
- Fix the product implementation to match the prototype.
- Mark the drift as `UNSYNCED` with owner-visible reason, affected surface, and
  next action.

Never silently let product code and prototype describe different products.

When editing prototype source, also follow `pt-prototype-design`.

## Workflow

### 1. Locate Coverage

Check these sources:

- Product files being changed.
- `docs/architecture/engineering/prototypes/README.md`
- `packages/prototypes/**/prototype.manifest.ts`
- `packages/prototypes/<site>/<area>/<id>/`
- `docs/architecture/<taxonomy>/<module>/prototype/README.md`
- Relevant `docs/architecture/**` and `docs/client/**` contracts.

Surface mapping:

- Desktop surface -> `packages/prototypes/desktop/**`
- Mobile surface -> `packages/prototypes/mobile/**`
- Station Dashboard surface -> `packages/prototypes/dashboard/**`
- Applet surface -> usually `packages/prototypes/desktop/applets/<applet-id>/`

If no prototype exists for a clearly user-facing surface, create or register
one. Ask only when ownership, site, or product intent is ambiguous.

### 2. Classify Drift

Use one of:

- `Prototype bug`: prototype is wrong or incomplete.
- `Product decision`: user, runtime, or architecture intentionally changes
  visible behavior.
- `Implementation bug`: product drifted from prototype without valid reason.
- `Runtime-only detail`: internal runtime differs, visible behavior unchanged.
- `No prototype coverage`: no current prototype governs the surface.

### 3. Apply Action

- `Prototype bug` or `Product decision`: update prototype source and docs.
- `Implementation bug`: fix product implementation; do not change prototype to
  excuse the bug.
- `Runtime-only detail`: do not change prototype; state why it is not visible.
- `No prototype coverage`: create/register prototype or mark explicitly
  non-prototype-governed if backend-only.

### 4. Update Artifacts

When prototype sync is required, update the relevant subset:

- Prototype source under `packages/prototypes/**`.
- `prototype.manifest.ts` when title, description, routing, site, or entry
  changes.
- Module prototype README.
- Prototype ledger if status, target, path, design version, or entry doc changes.
- Architecture / UX docs if intended product behavior changes.

### 5. Verify And Report

Minimum verification:

- `make run-prototype`: prototype portal starts for the current worktree.
- Prototype package build command if available.
- Product build / typecheck / test for the changed implementation.

Mark skipped commands as `NOT RUN` with reason. Do not claim visual sync as
proven without running the prototype or naming the visual verification gap.

Report:

- `Product surface`
- `Prototype`
- `Drift type`
- `Action`
- `Updated files`
- `Verification`
- `Residual drift`

## Anti-Patterns

Never:

- Change product UX and leave the prototype silently stale.
- Change the prototype just to justify an accidental implementation shortcut.
- Treat mock prototype behavior as runtime proof.
- Treat product implementation as the new design source without updating docs.
- Mark a prototype `landed` if the real product still lacks the behavior.
