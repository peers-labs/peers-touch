# North-Star Realignment — Integration (amendment)

> Status: draft · Created: 2026-11-09
> Relation: **amendment delta** to [`../integration.md`](../integration.md)
> (current implementation mapping/gaps). It describes the design-system
> integration and the antd/lobehub retirement path, not business integrations.

## 1. Build integration [F]

- Add `"@peers-touch/ui": "workspace:*"` to `apps/mobile/package.json`; the
  package exports source-only ESM resolved by the existing Bundler-mode
  tsconfig + Vite (no alias needed — same mechanism as desktop and the mobile
  prototype). Its peer React 19 matches mobile.
- CSS ships via `UIProvider` (`import './styles.css'`) scoped under `.pt-ui`;
  a new app skin css only sets provider full-size and `--pt-m-*` geometry.
- Remove the lobehub root inside `MobileThemeProvider` while keeping the light
  pin; remove dead `react-layout-kit`.
- Bundle: mobile must avoid peers-ui heavy markdown/diagram chunks (do not
  import MarkdownView/DiagramPreview); assert `vite build` size after wiring.

## 2. Coexistence window

Until all surfaces migrate, peers-ui and antd coexist inside one provider.
Controls: retire that surface's body-portaled antd `Modal/message` first;
visual-check scoped reset cross-effects; split the monolithic `styles.css` by
surface ownership before deletion; guard both import residuals and orphaned
selectors/tokens.

## 3. Retirement progress measure

A guard reports, per migrated surface and repository-wide:
`antd`/`@lobehub/ui` import count, `--brand-*`/private brand hex usages, and
orphaned private CSS selectors. Target: zero per closed surface; zero
repository-wide at program delivery. Baseline: 40 files import antd/lobehub;
imperative sites 12 confirm/success + 17 message.

## 4. Compatibility integration [F/ADR-6]

iOS deployment target is 15.0 while peers-ui CSS uses dvh/`:has`/`color-mix`
(15.4/16.2+). Slice 0 produces an evidence note in [`../ios-host.md`](../ios-host.md):
resolved minimum OS (raise target) or scoped fallbacks, verified on the
simulator runtime.

## 5. Prototype integration (reconciliation, not consumption)

The real app does not import the prototype. Reconciliation keeps the prototype
a faithful north-star: retain the confirmed three bottom destinations and top
chats/contacts subtabs within messages. Migrate the real four-tab shell to that
design, preserving real contacts/group behavior and native navigation. For
other owner-backed surfaces, reconcile real capability and Moments route shape,
drop fake/dead controls, and re-skin the real surface instead of porting the
fixture. The framed-composer anatomy is treated
as a pending-acceptance prototype input, not a frozen target.

## 6. Acceptance integration

No new acceptance framework: use the existing harness seam
(`VITE_ACCEPTANCE_HARNESS=1`, cargo `acceptance-harness`), 106 actions, six
fixture families, the 162-surface inventory, and the `mobile-simulator`/
`mobile-direct-simulator`/`mobile-station-lifecycle-simulator` gates. Surface
structure changes update fixtures + inventory together.
