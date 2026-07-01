# Applet Desktop Lifecycle Smoothness Gate

> Evidence class: LOCAL_ACCEPTANCE_GATE
> Gate: `applet-desktop-lifecycle-smoothness`

## Checks

- explicit-close-release-deferred: PASS
- close-navigates-before-release: PASS
- launcher-refresh-keeps-content: PASS
- page-lease-test-covers-defer: PASS
- runtime-test-covers-switch-lru: PASS
- desktop-lifecycle-vitest: PASS

## Proven Scope

- A->B applet runtime switch acquires the second applet without releasing the previous LRU applet.
- Explicit close releases only the closed applet page after navigation has already moved to launcher.
- LRU eviction remains the release path for the previous hidden applet.
- Launcher wakeup/refresh with existing applets does not fall back to fullscreen loading.

## Not Proven

- This local acceptance gate is not a packaged Desktop product-window browser E2E.
- Full visual A->B switching with two installed applet cards still requires a product-window harness with two catalog entries.
