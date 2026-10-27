---
kind: pitfall
title: Local Station negative fixtures must claim their own canonical port
status: active
owns:
  - tooling/devctl/test/station.test.mjs
  - docs/architecture/engineering/local-dev/integration.md
referenced-by: []
related:
  - docs/architecture/engineering/local-dev/integration.md
detected: 2026-10-24
---

# Local Station negative fixture port ownership

The Machine Dev self Gate failed before its unowned-Station assertion because
the fixture assumed a fixed local slot port was available. The test returned
`EADDRINUSE` while binding its HTTP server, so it proved nothing about the
production `PORT_CONFLICT` guard. A controlled unrelated listener reproduced
the failure independently of Station deployment or source identity.

The fixture must claim an actual listening socket from canonical `slotPorts`
before registering its private test workspace. It retains that socket through
the assertion and releases it through the test lifecycle. A candidate already
in use is skipped only on `EADDRINUSE`; other bind failures propagate, and
exhausting slots 0..99 fails rather than skipping the product assertion.
Never kill unrelated listeners, change the product ownership guard, probe and
release a port before use, or substitute another fixed slot.

## How to detect a recurrence

- Hold unrelated listeners on the former fixed port and several initial
  canonical slot ports, then run the local unowned-Station test.
  The fixture must select another canonical slot and the production call must
  still return exactly `PORT_CONFLICT`.
- Run the full `machine-dev-registry-self` command under its unchanged budget.
  Every original check must execute and pass; a focused test does not prove
  the complete self Gate.
- Verify all fixture-owned sockets and test processes are closed on exit.
  Do not attribute a transient port occupant to a specific process without
  an observed owner.
