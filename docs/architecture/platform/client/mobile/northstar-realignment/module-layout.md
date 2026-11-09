# North-Star Realignment — Module Layout (amendment)

> Status: draft · Created: 2026-11-09
> Relation: **amendment delta** to [`../module-layout.md`](../module-layout.md).
> It adds presentation-system ownership; it does not change runtime/service/
> Rust ownership or the dependency direction defined there.

## 1. What changes

The presentation layer gains a single external design-system dependency:

```text
@peers-touch/ui (+ ui-tokens/ui-contracts/ui-semantics/ui-assets via it)
        ^
        | consumed only by
pages/ + components/ + features/* (presentation) + acceptance surface renderers
        |
        | never imported by
runtimes/  services/  storage/  src-tauri/**
```

## 2. Presentation ownership delta

| Path | Added ownership | Must not |
|---|---|---|
| `src/app/` root providers | construct the one `UIProvider` (light, north-star flat vars) and the one feedback channel; own the mobile skin css (`--pt-m-*` geometry only) | introduce color tokens outside `--pt-*`; embed product state |
| `src/components/overlays`,`src/components/feedback` *(new, thin)* | typed app wrappers over the shared feedback channel | re-implement peers-ui dialogs/toasts; touch runtime/data |
| `src/pages`,`src/components`,`src/features/*` | render peers-ui primitives + `--pt-*`; own co-located/surface CSS as the monolith is split | keep migrated antd/lobehub imports or a surface-private palette |
| `src/acceptance/**` surface renderers | render migrated production components under fixture state | diverge from production markup |

Unchanged (parent remains authoritative): `runtimes/` freshness,
`services/gateways` + `services/platform` typed boundaries, `storage/`
device-local state, and all `src-tauri/**` ownership.

## 3. Forbidden additions (incremental to parent §6)

- any non-presentation path importing `@peers-touch/ui` or `.css`;
- a second mobile component/color/token source after a surface migrates;
- a forked dialog/toast primitive (only shared-channel wrappers allowed);
- acceptance fixtures mutating business state outside the harness seam.

## 4. Diagram

No new runtime/authority diagram is introduced: the reuse topology is the
parent module's presentation subtree with `@peers-touch/ui` as a consumed
shared package. A canonical diagram remains owned by the parent mobile module
and `cross-client-runtime`; this amendment intentionally adds none rather than
duplicate it.
