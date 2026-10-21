# Verification

> **Status**: active
> **Audience**: human developers and development agents
> **Owner**: Quality and Acceptance

Verification answers one question: what evidence proves the requested result
on the current source?

## Evidence Levels

### Source checks

Prove that source is well-formed:

- format, lint, type checking;
- unit and contract tests;
- compilation and package build;
- deterministic repository rules.

Source checks cannot prove a user Journey.

### Functional Journey

Exercise the changed behavior through its real product entrypoint and inspect
the visible or authoritative result. Use the narrowest runtime that represents
the claim.

Examples:

- Desktop behavior uses the native Tauri app.
- Message delivery is confirmed from the receiver.
- Persistence is confirmed after reopening or restarting.
- Station behavior uses the selected Profile and current source.

### Formal Acceptance

Acceptance produces durable, source-bound evidence for a declared product
capability. It runs only after the corresponding functional Journey works.

```bash
make acceptance-plan
make acceptance-run
```

Completion and full/release modes are explicit alternatives:

```bash
make acceptance-run-completion
make acceptance-run-full
```

Do not run them as an automatic sequence. Missing formal proof remains
`UNPROVEN`; a harness self-test is not product proof.

### Release proof

Release proof covers published or packaged artifacts, installation, native
updates, signatures, anonymous download, rollback, and recovery. It is needed
only for release claims and is owned by
[Release Distribution](../architecture/engineering/release-distribution/README.md).

## Choose Checks By Change

Use the relevant [platform guide](./platforms/README.md) for focused commands.
Broaden only when a changed contract has additional consumers.

- Model changes regenerate and check every affected binding.
- Station changes run focused package tests before wider module tests.
- Desktop changes run type checks and focused tests before native Journey
  verification.
- Mobile changes distinguish Web, Rust, iOS, and Android claims.
- Documentation changes validate links, current paths, commands, and source
  ownership.

## Evidence Freshness

Evidence becomes stale when its source, runtime, provider, oracle, or Journey
changes. A prior PASS cannot be inherited across those changes.

Every result must identify:

- worktree and source identity;
- runtime or environment;
- operation performed;
- expected and observed result;
- evidence location;
- untested scope.

## Review Entry Points

```bash
make review REVIEW_RANGE=<base>...<head>
make quality-evidence REVIEW_RANGE=<base>...<head>
```

Quality Evidence aggregates checks and gaps. The final review judgment still
comes from reading the change against current architecture, knowledge, and
evidence.
