# Desktop Runtime Architecture

> **Status**: active
> **Updated**: 2026-10-04
> **Owner**: Client Platform Team

## 1. Scope

Desktop has one supported product and development topology:

```text
native Tauri application
  -> embedded WebView renderer
  -> desktop-rust command and local capability layer
  -> Station
```

The React/TypeScript renderer is source inside the native application. It is
not an independently supported browser client.

## 2. Runtime Units

### Native Desktop Application

Owns the process lifecycle, native window, menu/tray, permissions, focus and
input behavior, embedded WebView, packaging, and cleanup.

### Embedded WebView Renderer

Owns UI rendering, interaction, local projections, Page/Runtime/Boot contracts,
and typed calls into Desktop Rust. Detailed contracts live in
`docs/client/desktop/runtime-projections.md`.

### Desktop Rust

Owns local application state, storage, native capabilities, command handlers,
and Station communication. It is part of the Tauri process and is not launched
as a browser-only gateway.

### Station

Owns shared cross-device business truth and service behavior. Desktop does not
bypass the Desktop Rust boundary when a local capability or lifecycle contract
belongs there.

## 3. Launch Contract

`make desktop` is the only Desktop development entrypoint. It:

1. resolves the selected reviewed Profile and workspace slot;
2. verifies Station source readiness;
3. prepares repository dependencies and generated contracts;
4. starts one source-bound Tauri application and embedded WebView;
5. records process, profile, storage, port, and source identity for cleanup.

`make desktop-stop` and `make desktop-restart` operate on the same native
runtime. No `desktop-web` command, web mode, rendererless Tauri process,
browser profile, browser storage root, or compatibility alias exists.

## 4. Acceptance Contract

Desktop functional and formal proof must use an approved native runtime cell,
such as `desktop-macos-native`, and must include:

- a real native application process and visible window;
- native focus and input dispatch;
- embedded WebDriver or native accessibility actions;
- native screenshots and DOM snapshots when applicable;
- Desktop Rust and Station identity;
- bounded reverse-order process and resource cleanup.

Chromium/CDP, a standalone Vite page, coordinate-only automation, API-only
readback, and a system browser are not Desktop product proof.

## 5. Browser Boundaries

The following remain valid and are not Desktop browser mode:

- Tauri's embedded WebView renderer;
- opening the user's system browser for OAuth authorization;
- independently owned Web applications with their own product contracts.

No frontend code may branch on a Desktop browser surface. No runtime schema,
Gate, provisioner, environment, feature client, matrix, or performance cell may
advertise browser as a Desktop runtime.

## 6. Failure Ownership

| Failure | Owner |
|---|---|
| Window, focus, native input, WebView, package lifecycle | Native Desktop application |
| UI render, projection, page/runtime boot | Embedded WebView renderer |
| Command, storage, native capability, Station adapter | Desktop Rust |
| Shared business state or service behavior | Station |
| Runtime provisioning and cleanup evidence | Acceptance native runtime owner |

## 7. Non-Goals

- Reintroducing a browser debugging shell.
- Maintaining browser compatibility for Desktop-only APIs.
- Using browser evidence as a faster substitute for native proof.
- Removing the embedded WebView or system-browser OAuth handoff.
