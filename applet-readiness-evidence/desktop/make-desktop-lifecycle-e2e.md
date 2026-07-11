# Make Desktop Applet Lifecycle E2E Evidence

Date: 2026-07-01

## Runtime

- Command: `make desktop`
- Profile: `two`
- Station: `http://10.37.118.48:18080`
- Desktop app gateway: `127.0.0.1:3130`
- Desktop app web: `http://localhost:3310`
- Observation tool: integrated browser against `http://localhost:3310/#/applets`

## Code Under Test

- `apps/desktop/src/store/applets.ts`
- `apps/desktop/src/runtimes/appletsRuntime.ts`
- `apps/desktop/src/kernel/pageRuntimeLease.ts`
- `apps/desktop/src/pages/AppletRuntimePage.tsx`
- `apps/desktop/src/pages/AppletsPage.tsx`

## Scenario

1. Log in as `User B node-c`.
2. Unlock with PIN `111111`.
3. Open `#/applets`.
4. Confirm two launch targets are visible:
   - `hello-lynx` (`Open Hello Lynx`)
   - `peers.note` (`Open Note`)
5. Open A: `hello-lynx`.
6. Return to launcher.
7. Open B: `peers.note`.
8. Close B.
9. Simulate wakeup/focus while launcher is visible.

## Observed Evidence

- Launcher after reload exposed two installed targets:
  - `data-applet-open="hello-lynx"`, `data-applet-status="installed"`
  - `data-applet-open="peers.note"`, `data-applet-status="installed"`
- Opening A navigated to `#/applet:hello-lynx`.
- A runtime shell was visible with `data-applet-runtime="hello-lynx"` and no fullscreen loading text.
- Returning to launcher kept A as hidden LRU runtime:
  - `hello-lynx` remained present with `data-applet-runtime="hello-lynx"` and zero-size hidden rect.
  - Launcher remained visible with no fullscreen loading.
- Opening B navigated to `#/applet:peers.note`.
- A stayed hidden while B was visible:
  - `data-applet-runtime="hello-lynx"` hidden.
  - `data-applet-runtime="peers.note"` visible.
  - `loadingText=false`.
- Closing B navigated back to `#/applets` before runtime release.
- After deferred release, `AppletManager.getLoadedApplets()` returned only `["hello-lynx"]`.
- Wakeup/focus sample on launcher preserved existing launcher content:
  - Before wakeup: `["peers.note", "hello-lynx"]`, `loading=false`.
  - After wakeup: `peers.note=installed`, `hello-lynx=active`, `loading=false`.

## Commands

- `pnpm run check` in `apps/desktop`: PASS
- `pnpm applet:desktop-lifecycle-smoothness-gate`: PASS
- `python3 tooling/scripts/acceptance-validate.py --domain applet --require-proven`: PASS
- `git diff --check`: PASS

## Scope Claim

Desktop dev-runtime applet lifecycle smoothness is evidenced for launcher to A, launcher return, A to B, explicit close back to launcher, B runtime release, A hidden LRU retention, and launcher wakeup without fullscreen loading.

Cross-platform mobile applet lifecycle smoothness remains out of scope for this evidence.
