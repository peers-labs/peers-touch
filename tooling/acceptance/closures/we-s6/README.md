# WE-S6 — Workspace Sandbox interactive PTY gates

Real-container, exact-source acceptance for the provisioner-owned PTY (plan
`WE-20261104`). The PTY process lives inside the sandbox container; Station
proxies the stream and the Desktop never holds the process. Nothing is mocked.

## Run

```bash
bash tooling/acceptance/closures/we-s6/pty-gates.sh
```

Builds the pinned base/provisioner images, starts the provisioner with the
internal network, opens a real TTY via the Docker Engine API, and writes a
JSON evidence report:

```
tooling/acceptance/reports/task-workbench/we-s6-pty-gates.json
```

## Gates

| Gate | Invariant |
|------|-----------|
| P1 | a TTY shell opens through the hijacked Engine stream and is running |
| P2 | keystrokes round-trip: `echo` output renders in bounded scrollback |
| P3 | the ring cursor is monotonic (`next_cursor` advances past 0) |
| P4 | resize (120x40) is accepted on the live PTY |
| P5 | typing `exit` yields honest `exited` state |
| P6 | `signal:9` kills the isolated process group -> `killed` |
| P7 | killing one PTY does not affect a second PTY in the same container |

## Scope

Proves the provisioner PTY lifecycle (open/write/read/resize/signal), honest
state, bounded scrollback, and per-PTY process-group isolation on real
containers. The Station proxy RPCs (`/agent/sandbox-pty/*`) and metadata
persistence are covered by Go tests in
`apps/station/app/subserver/agent/service` (terminal sandbox suite). The
Go HTTP client's real wire contract against a live provisioner (allocate,
exec, dormant/cold-start, reconcile and the PTY bridge) is covered by the
docker-gated Go integration tests, run via:

```bash
bash tooling/acceptance/closures/we-s6/go-client-integration.sh
```

Desktop terminal-panel consumption of these proxy RPCs (polling pump +
placement label) is covered by the desktop store tests and `pnpm run check`.
