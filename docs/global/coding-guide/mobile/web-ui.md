# Mobile Web UI Coding Guide

> Specification source for `apps/mobile/src/` Web UI implemented inside the Tauri Mobile WebView.

---

## 1. Layout Invariants

- Mobile Web UI must preserve a stable app viewport; frontend code must not let keyboard, input accessory bars, pickers, popovers, or dropdowns compress the app shell.
- Text input focus must not resize, squeeze, or vertically reflow primary app content. If input avoidance is needed, use overlay-safe positioning, local scroll containers, or native WebView fixes instead of shrinking the root layout.
- The app root must keep a fixed viewport contract (`100dvh` or platform-equivalent), with content scrolling inside owned containers.
- Bottom navigation, primary action bars, and page headers must keep predictable safe-area positioning and must not jump because of IME or system accessory UI.
- First-screen flows must remain fully reachable on every supported phone size. Do not rely on decorative whitespace to position cards; use compact spacing, stable viewport containers, and local scrolling when content exceeds the viewport.
- Empty vertical space must be intentional. Large unused gaps at the bottom of mobile screens are layout defects unless they are required by a specific safe-area or gesture affordance.
- Form-like launch screens should keep compact, task-focused spacing. Do not stretch a small form into a tall card just to fill the viewport.

## 2. Input Controls

- Protocols, modes, and fixed option sets should be explicit controls (`Select`, segmented control, sheet) rather than free-text prefixes.
- URL inputs should separate protocol selection from host/path input unless the user is pasting a complete URL.
- Prefix selectors inside URL inputs must reserve enough width to show the complete selected value on all supported phone widths. Do not truncate fixed labels such as `HTTP` or `HTTPS`.
- HTTP must be marked as not recommended when HTTPS is available. Use warning color semantics, not success or neutral styling.
- Submit/add actions must be disabled until the normalized input is valid.

## 3. WebView Keyboard Policy

- iOS WKWebView input accessory bars are platform chrome, not product UI. If they affect layout quality, fix at the WebView/native layer or design the input flow so the bar overlays without compressing the app.
- Frontend workarounds must live in a named platform boundary module, not in page components or `main.tsx` inline code.
- New input flows must be verified on iOS Simulator or device with focus, blur, double tap, and keyboard show/hide before handoff.
