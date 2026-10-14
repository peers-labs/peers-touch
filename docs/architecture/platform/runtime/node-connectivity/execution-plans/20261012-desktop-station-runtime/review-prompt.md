# Review Prompt: Desktop App-Scoped Station Runtime

Review
`docs/architecture/platform/runtime/node-connectivity/execution-plans/20261012-desktop-station-runtime/plan.md`
and every Task Slice under `tasks/`.

Use these accepted sources:

- `docs/architecture/platform/runtime/node-connectivity/{design,decisions,data-model,module-layout,integration}.md`
- `docs/architecture/platform/station/access/{design,decisions,data-model,module-layout,integration}.md`
- `docs/architecture/platform/client/desktop/runtime.md`
- `docs/client/desktop/lifecycle.md`

Check:

1. Every Task is a vertical, bounded closure and the dependency DAG follows
   package prerequisite, unary injection, streaming/resource injection, atomic
   runtime cut, lifecycle proof and final proof.
2. DSR-02/03 retain one current proxy adapter; DSR-04 alone performs the atomic
   implementation swap and complete old-path deletion.
3. Station Access remains the only binding mutation owner; Node Connectivity
   receives immutable RouteLease and does not mutate registry or Session truth.
4. The package and Desktop owners define explicit start, cancellation, bounded
   admission, drain, shutdown and thread join.
5. Stable transport identity is endpoint-scoped, does not become Actor,
   Session, device-class or logical Station identity, and unrelated Relay
   scopes expose distinct transport PeerIDs.
6. Safe read, idempotent mutation and ambiguous mutation semantics are distinct;
   no method-only blind write retry is allowed.
7. StationResourceRef replaces route-origin URL identity for avatar, OSS,
   profile, attachment and applet resources; external URLs remain distinct.
8. The deletion inventory removes global transport/registry/binding owners,
   localhost proxy, raw HTTP1 parser and side-effecting origin getter.
9. DSR-G01..G03 and NCP-G03/G07/G08 map to concrete lifecycle, security,
   overload, receiver and removal risks without overclaiming Mobile, cluster or
   performance superiority.
10. Plan authorization denies commit, push, PR, history rewrite, external
   deployment and destructive reset.

Run:

```bash
make plan-validate PLAN=docs/architecture/platform/runtime/node-connectivity/execution-plans/20261012-desktop-station-runtime/plan.md
node tooling/scripts/architecture/module-governance.mjs validate
```

Return `通过`, `有条件通过`, or `需要修改`, followed by source-backed findings.
