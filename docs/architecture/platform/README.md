# Platform Architecture

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-05 | **Updated**: 2026-10-05
> **Owner**: Architecture Team

---

## 1. Document Scope

`platform/` mirrors implementation ownership rather than product domains:
Client runtimes, Station framework boundaries, shared contract machinery,
Applet hosting, and process/runtime coordination.

Business truth belongs under `domains/`; reusable cross-domain capabilities
belong under `shared/`.

## 2. Platform Map

| Platform boundary | Entry | Code roots |
|---|---|---|
| Client runtimes | [client/](./client/README.md) | `apps/desktop`, `apps/mobile` |
| Station platform | [station/](./station/README.md) | `apps/station/frame`, access pipeline |
| Shared contracts | [contracts/](./contracts/README.md) | `model/domain`, handler contracts |
| Runtime coordination | [runtime/](./runtime/README.md) | storage paths and service DAG |
| Applet Host platform | [applet-runtime/](./applet-runtime/README.md) | applet Host, SDK, gateway |
| Station/Desktop boundary | [station-desktop-boundary.md](./station-desktop-boundary.md) | cross-layer ownership |
