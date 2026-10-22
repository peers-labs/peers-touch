# Client Shared Packages

> **Status**: active
> **Version**: v1.1
> **Updated**: 2026-10-17
> **Owner**: Client Platform Team

---

## Package Map

| Package | Reuse layer | Current consumers |
|---|---|---|
| `packages/messaging-core/` | Portable Rust core | Desktop Rust + Mobile Rust |
| `packages/secure-content-core/` | Portable Rust core | Desktop Rust + Mobile Rust |
| `packages/station-libp2p-http/` | Portable Rust transport | Station + Desktop Rust + Mobile Rust |
| `packages/station-trust/` | Portable Rust trust core | Desktop Rust + Mobile Rust |
| `packages/client-chat-core/` | Shared TypeScript core: Chat projection, selector, wire codec, capability admission, storage reconciliation/retry | Desktop + Mobile |
| `packages/client-media-security/` | Shared TypeScript core: media descriptor codec and cryptographic processing | Desktop + Mobile |
| `packages/client-storage/` | Shared TypeScript core: storage domain, scope, envelope and repository contracts | Desktop + Mobile |
| `packages/applet-contract/` | Shared applet contract | Applet hosts and SDK |
| `packages/applet-kernel/` | Shared applet kernel | Applet hosts |
| `packages/applet-sdk/` | Applet-facing SDK | Applets and supported hosts |
| `packages/locales/` | Shared content asset | Client surfaces |
| `packages/ui/desktop/` | Desktop Presentation Policy | Desktop only |

The repository contains other packages with narrower product or tooling
owners. Their presence does not make them Client Platform dependencies.

## Rules

- Every package has one semantic owner.
- Rust portable cores remain host-neutral and expose typed ports.
- Shared client packages do not own Station business truth.
- Cross-process and cross-device contracts come from `model/domain/`.
- Platform integration remains in the consuming Desktop or Mobile host.
- Android and iOS do not fork a shared Mobile package into independent product
  contracts.
- A second Desktop/Mobile consumer cannot copy the implementation locally; it
  reuses or extracts the canonical package first.
- `packages/ui/desktop/` is not a cross-client UI library. Cross-client visual
  reuse requires a policy-neutral component and architecture registration.
- Desktop/Mobile layout, density, keyboard, safe-area, gesture and window
  values are forbidden in `packages/client-*`; Chat form policy is registered
  under `client.chat.presentation.desktop` and
  `client.chat.presentation.mobile`.
- `unified-client-shared-semantics` proves canonical declaration uniqueness,
  two production consumers, registry coverage and absence of presentation or
  Host framework leakage.

Architecture governance derives shared direct dependencies from Desktop/Mobile
package and Cargo manifests. Every derived package or crate must resolve to a
registered capability owner and canonical root.

See
[Cross-Client Runtime](../../architecture/platform/client/cross-client-runtime/README.md)
for the governing dependency and evidence model.
