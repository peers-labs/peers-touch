---
name: pt-prototype-sync-guardian
description: Require prototype review and user confirmation before UI changes or UI bug fixes. Use when users report UI problems or request visible adjustments.
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
- A user or developer reports "UI 不对", "这里样式有问题", or another visible
  defect, even when the Agent suspects an implementation or data/action bug.
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

For every UI feedback or visible adjustment, follow prototype ledger §4.2
before product edits: mark the surface drafting, inspect and show the prototype,
adjust it when needed, and obtain user confirmation of this repair target.
If the existing prototype is correct, ask the user to confirm using it unchanged.
An implementation-bug classification, a small fix, or prior confirmed status
cannot bypass this step. After confirmation, restore the target at its actual
owner; do not redesign the prototype to excuse an implementation defect.

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

Read the existing pre-edit context's `uiSurfaces` before production edits.
For mapped surfaces follow the ledger §4.2; use its component, source roles,
entry chain and current/confirmed digests. An empty result is missing coverage,
not permission to edit product UI first. Register the complete surface before
claiming machine enforcement. Manifest and capability status do not grant approval.

Surface mapping:

- Desktop surface -> `packages/prototypes/desktop/**`
- Mobile surface -> `packages/prototypes/mobile/**`
- Station Dashboard surface -> `packages/prototypes/dashboard/**`
- Applet surface -> usually `packages/prototypes/desktop/applets/<applet-id>/`

If no prototype exists for a clearly user-facing surface, create or register
one. Ask only when ownership, site, or product intent is ambiguous.

### 2. Review And Confirm The Prototype

Follow ledger §4.2 for this UI feedback before any production mutation.
Show the relevant prototype state and proposed repair target. Adjust incorrect
prototype/shared presentation first; retain correct prototype source.
Obtain explicit confirmation for either target before proceeding.

### 3. Classify Drift

Use one of:

- `Prototype bug`: prototype is wrong or incomplete.
- `Product decision`: user, runtime, or architecture intentionally changes
  visible behavior.
- `Implementation bug`: product drifted from prototype without valid reason.
- `Runtime-only detail`: internal runtime differs, visible behavior unchanged.
- `No prototype coverage`: no current prototype governs the surface.

### 4. Apply Action

- `Prototype bug` or `Product decision`: integrate the shared presentation
  and contract confirmed in Step 2. Keep the recorded current digest and
  confirmation; do not create another adjustment after that approval.
- `Implementation bug`: only after Step 2 confirmation, restore the confirmed
  target in product implementation; keep correct prototype source unchanged.
- `Runtime-only detail`: do not change prototype; state why it is not visible.
- `No prototype coverage`: create/register prototype or mark explicitly
  non-prototype-governed if backend-only.

### 5. Update Artifacts

When prototype sync is required, update the relevant subset:

- Prototype source under `packages/prototypes/**`.
- `prototype.manifest.ts` when title, description, routing, site, or entry
  changes.
- Module prototype README.
- Prototype ledger if status, target, path, design version, or entry doc changes.
- Architecture / UX docs if intended product behavior changes.

### 6. Verify And Report

Minimum verification:

- `make run-prototype`: prototype portal starts for the current worktree.
- Prototype package build command if available.
- Product build / typecheck / test for the changed implementation.
- `node tooling/scripts/review/ui-surface-authority.mjs verify`: production
  rejects drafts, stale confirmation, duplicate rendering and disconnected
  consumption; the Prototype Portal remains available to review drafts.
- Original product Journey after adapter integration. Structural checks and
  prototype replay do not replace native business proof.

Mark skipped commands as `NOT RUN` with reason. Do not claim visual sync as
proven without running the prototype or naming the visual verification gap.

Report:

- `Product surface`
- `Prototype`
- `Drift type`
- `Prototype repair target and current user confirmation`
- `Action`
- `Updated files`
- `Verification`
- `Residual drift`

## Anti-Patterns

Never:

- Change product UX and leave the prototype silently stale.
- Treat "UI 不对" as permission to fix production before prototype review and
  confirmation, including when classified as an implementation defect.
- Change the prototype just to justify an accidental implementation shortcut.
- Treat mock prototype behavior as runtime proof.
- Treat product implementation as the new design source without updating docs.
- Mark a prototype `landed` if the real product still lacks the behavior.
