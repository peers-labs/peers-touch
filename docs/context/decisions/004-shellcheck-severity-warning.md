# ADR-004: Shellcheck severity = warning for the deploy-station PR gate

**Status:** Accepted
**Date:** 2026-05-18
**Decision Makers:** Architecture (during Tier C1/D2 review pass)
**Related:** `.github/workflows/deploy-station.yml`, `tooling/scripts/`, `docs/knowledge/playbooks/`

---

## Context

The PR-gate added in Tier D2 runs `shellcheck` over `tooling/` to catch shell-script regressions before they reach a remote deploy. The first cut shipped at `severity: error`, with a comment in the workflow stating "the existing scripts haven't been audited for SC2*** warning-class issues yet".

`severity: error` only flags syntactic issues (the SC1xxx family). It misses the warning-class checks that account for ~80% of shellcheck's value:

- **SC2086** — unquoted parameter expansion (word-splitting / globbing bugs).
- **SC2155** — `local foo=$(cmd)` masks return values.
- **SC2206** — array assignment from unquoted string splits on whitespace.

These are real bug classes in shell, not style nits. Running shellcheck only at `error` is close to running a strict-mode linter with strict mode disabled — the gate exists but doesn't gate.

During the C1/D2 review pass, the original "we haven't audited" justification was tested. A local audit of the deploy-relevant scripts produced:

```
$ shellcheck -S warning \
    tooling/scripts/{pt-deploy,pt,pt-bootstrap,pt-discover-relay,pt-relay-issue-invites}.sh \
    tooling/docker/entrypoint.sh
0 findings
```

The "we haven't audited" claim was true at write-time but no longer accurate. The deploy critical path is already clean at warning level.

The dev-side scripts (`dev-desktop-dual.sh`, `_ensure-*.sh`, `ide-setup.sh`, `dev-clean.sh`, `preview-desktop.sh`) DO carry warnings. These do not run on production hosts; auditing them is desirable but does not block a station deploy.

## Decision

**Use `severity: warning` AND `ignore_paths: <dev-only scripts>` in the deploy-station PR gate.**

Specifically (excerpted from the workflow):

```yaml
- name: Shellcheck deploy scripts
  uses: ludeeus/action-shellcheck@2.0.0
  with:
    scandir: ./tooling
    severity: warning
    ignore_paths: >-
      tooling/scripts/dev-clean.sh
      tooling/scripts/dev-desktop-app.sh
      tooling/scripts/dev-desktop-dual.sh
      tooling/scripts/dev-desktop-web.sh
      tooling/scripts/_ensure-desktop-rust.sh
      tooling/scripts/_ensure-desktop-vite.sh
      tooling/scripts/_ensure-station.sh
      tooling/scripts/_ensure-tauri-dev.sh
      tooling/scripts/ide-setup.sh
      tooling/scripts/preview-desktop.sh
```

## Consequences

### Positive

- The PR gate now catches real bug classes (SC2086 / SC2155 / SC2206 etc.) on every change to deploy scripts.
- The `ignore_paths` list is a visible to-do: each entry is a follow-up audit task. Removing an entry is the natural unit of cleanup work.
- No code changes were required to ship — the deploy path was already clean at this level; the change is policy, not refactor.

### Negative / accepted trade-offs

- Dev-side scripts can regress at warning level without triggering this gate. Mitigated: a separate, lower-priority cleanup PR audits them and removes their `ignore_paths` entries one at a time.
- A future contributor might add a new dev-only script that has warnings and add it to `ignore_paths` rather than fix it. Mitigated by reviewer rule: `ignore_paths` additions require an explicit "why" note in the PR description.

### Reversal cost

Low. Adjusting `severity` or `ignore_paths` is a one-line workflow edit; no code or contract is bound by this decision.

## Verification

- `shellcheck -S warning <each unignored path>` produces zero findings at the time of this ADR.
- The first PR landing this change exercises the gate end-to-end on GitHub Actions; any newly-introduced violation in the deploy critical path will fail that run.

## Crosswalks

- Pitfall: none yet — this decision is preventive, not reactive.
- Knowledge layer: not promoted to an invariant because shell-script style is not a horizontal architectural property; it lives at the workflow boundary.
