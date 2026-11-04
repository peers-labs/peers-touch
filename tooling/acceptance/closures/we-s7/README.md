# WE-S7 — Workspace Sandbox isolation gates

Real-container, exact-source acceptance for the WORKSPACE_SANDBOX execution
target (plan `WE-20261104`). The script uses the local Docker daemon; nothing is
mocked.

## Run

```bash
bash tooling/acceptance/closures/we-s7/isolation-gates.sh
```

It builds `peers/workspace-sandbox-base:24.04-1` and
`peers/workspace-sandbox-provisioner:dev`, starts the provisioner as the only
container mounting the Docker socket, attaches workloads only to the internal
`wbox-isolated` network, asserts the gates, and writes:

```
tooling/acceptance/reports/task-workbench/we-s7-isolation-gates.json
```

## Gates

| Gate | Invariant asserted |
|------|--------------------|
| G1 | provisioner health reports an available `oci_linux` runtime |
| G2 | a mutable/unpinned image tag is rejected and never creates a container |
| G3 | the content-id-pinned image allocates a running sibling container |
| G4 | workload runs as the fixed non-root uid `10001` |
| G5 | container root filesystem is read-only (`touch /` → exit 1 / `EROFS`) |
| G6 | the `/workspace` volume is writable and readable |
| G7 | the sandbox attaches to **only** `wbox-isolated` |
| G8 | external egress is blocked (internal network; no proxy in this slice) |
| G9 | two sandboxes cannot open a connection to each other |
| G10 | docker host config = `--cap-drop ALL`, `no-new-privileges`, read-only rootfs |
| G11 | DORMANT stop → allocate cold-start retains the workspace volume contents |

## What this proves (and does not)

- Proves the provisioner enforces image pinning, non-root, read-only rootfs,
  cap drop / no-new-privileges, network isolation, and volume persistence with
  real containers, and that Station's only path is the narrow HTTP API.
- The no-desktop-fallback property is enforced in the Station executor
  (`SANDBOX_UNAVAILABLE` is terminal; there is no `docker run` on Station) and
  covered by the Go unit tests in
  `apps/station/app/subserver/agent/service/sandbox`.
- End-to-end UI journeys that drive an agent turn through a live Station are
  tracked separately; this gate is the reproducible infrastructure-level
  functional check (journeyClass `native-service`).
