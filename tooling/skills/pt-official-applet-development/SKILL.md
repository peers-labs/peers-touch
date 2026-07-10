---
name: pt-official-applet-development
description: >
  Use when creating, modifying, implementing, or validating an official
  Peers-Touch applet under apps/applets, including Note-like applets, applet
  frontend/backend product units, applet service binding, Station-bundled or
  standalone applet services, official applet scaffolding, applet manifests,
  and Host injection into Desktop/Mobile/Web.
---

# Official Applet Development

Use this skill before creating or changing any official applet product unit.

Applies to:

- `apps/applets/**`
- official applet manifests and service manifests
- applet frontend code that uses `@peers-touch/applet-sdk`
- applet backend services that may be Station-bundled or standalone
- service binding through Host Gateway
- official applet scaffold or contract gates

## Required Read Order

1. Read [`docs/architecture/applet-runtime/official-applet-architecture-contract.md`](../../../docs/architecture/applet-runtime/official-applet-architecture-contract.md).
2. Read [`docs/architecture/applet-runtime/README.md`](../../../docs/architecture/applet-runtime/README.md) for current applet-runtime document priority.
3. If implementing Note, read [`docs/architecture/applet-runtime/note-applet-validation-design.md`](../../../docs/architecture/applet-runtime/note-applet-validation-design.md).
4. If implementing Note, follow [`docs/architecture/applet-runtime/execution-plans/2026-06-17-note-official-applet-implementation-plan.md`](../../../docs/architecture/applet-runtime/execution-plans/2026-06-17-note-official-applet-implementation-plan.md).
5. If touching Desktop, Station, or Mobile, also read the matching `docs/.agent/<platform>.md`.

## Scaffold First

Do not hand-create an official applet product unit once the scaffold exists.

Use the official scaffold:

```bash
pnpm applet:create-official --id <applet-id> --service <service-name> --name <DisplayName>
```

For Note:

```bash
pnpm applet:create-official --id peers.note --service note --name Note
```

Only use manual directory creation while bootstrapping the scaffold itself.

## Architecture Boundaries

Official applets are product units:

```text
apps/applets/<applet-id>/
  frontend/
  service/
  contracts/
  docs/
  tests/
```

Keep the boundaries:

- frontend uses `@peers-touch/applet-sdk` for Host capabilities.
- service follows DDD: `domain/application/infrastructure/transport/stationadapter/standalone`.
- proto source remains under `model/domain/**`.
- Desktop/Mobile/Web load built artifacts and inject Host bridge.
- Station may mount `service/stationadapter`, but must not absorb applet domain/application logic.

## Required Checks Before Implementation

- Confirm whether the scaffold exists. If it does not, implement scaffold workstream before the applet product.
- Confirm `applet.manifest.json` declares a canonical `services[]` entry for the service.
- Confirm applet frontend capability access uses `permissions: ["network.request"]`, and platform service intent is declared through `platformPermissions: ["network:service:<service>"]`.
- Confirm `service.manifest.json` declares Station-bundled deployment and standalone status.
- Confirm frontend has no raw backend URL path.
- Confirm Desktop/Mobile code does not import applet product source.

## Frontend Technology Stack

Official applet frontends MUST use the following stack:

- **Rendering**: `@lynx-js/react` (ReactLynx) — cross-platform Lynx elements (`<view>/<text>/<input>/<scroll-view>/<list>`)
- **UI Components**: `@lynx-js/lynx-ui` — the official Lynx component library (ScrollView, List, Button, Dialog, Sheet, Input, Form, Popover, etc.)
- **Build**: `@lynx-js/rspeedy` with `@lynx-js/react-rsbuild-plugin`
- **State Management**: Zustand, Jotai, or React Context (all compatible with ReactLynx)
- **Host Communication**: `@peers-touch/applet-sdk`

Hard rules:

- Do NOT write raw `<scroll-view>` / `<list>` elements directly — use `lynx-ui` components (`<ScrollView>`, `<List>`) which handle cross-platform quirks.
- Do NOT use React DOM libraries (LobeUI, antd, MUI, Chakra, shadcn/ui) — they are incompatible with Lynx's element model.
- Do NOT use inline styles for layout scaffolding when `lynx-ui` provides an equivalent component.
- CSS files are supported — prefer them over massive inline style objects for readability.
- When `lynx-ui` does NOT provide a needed capability (layout pattern, interaction, component), do NOT invent a custom solution — **stop and ask the user** for direction before proceeding. Present one of the two extension strategies below with a recommendation and reasoning.

### Extension Strategies (when lynx-ui is insufficient)

When a UI capability exceeds what `lynx-ui` provides (e.g., K-line charts, video players, rich text editors, canvas drawing, map views), choose between:

| Strategy | Mechanism | Best for | Trade-offs |
|----------|-----------|----------|------------|
| **Native Custom Element** | Implement in Swift/Kotlin/C++, register as Lynx Custom Element, use as `<my-component>` tag in JSX | Performance-critical rendering (charts, video, AR, real-time data viz), offline capability, deep OS integration | Higher dev cost, per-platform implementation, needs native build pipeline |
| **Embedded WebView** | Host opens a WebView region, loads standard Web libraries (ECharts, TradingView, D3, Monaco Editor), bridge communicates via Native Module | Rapid prototyping, leveraging mature Web ecosystem, content-heavy views where 60fps isn't critical | Extra memory, cross-boundary communication latency, no offline without caching, not truly native |

Agent behavior:

1. Identify which capability is missing from `lynx-ui`.
2. Evaluate both strategies against the specific requirements (performance, dev speed, platform coverage, ecosystem maturity).
3. Present both options to the user with a clear recommendation and reasoning.
4. Do NOT proceed with implementation until the user picks a direction.

Reference: [lynx-ui official docs](https://lynxjs.org/lynx-ui/)

## Forbidden Patterns

- Creating a Desktop page/store/service as the applet implementation.
- Calling Tauri commands directly from applet frontend.
- Calling raw `fetch(baseUrl)` or using an applet-visible backend URL for business APIs.
- Implementing applet service as Desktop commands.
- Putting applet business rules into Station main-program packages.
- Claiming Mobile readiness without a real Mobile Host gate.

## Evidence Standard

When reporting readiness, classify evidence as:

```text
REAL_PRODUCT_PATH
CONTROLLED_LOCAL_UPSTREAM
MOCKED_HARNESS
NOT_IMPLEMENTED
```

Mocked harnesses can support development, but they do not prove official applet readiness.
