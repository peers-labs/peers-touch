# Agent Acceptance Protocol

## Purpose

This playbook defines how agents prove product changes without asking users to
perform early manual QA.

## Flow

1. Read `tooling/acceptance/registry.yaml` and impacted feature contracts.
2. Run `make acceptance-plan` to select gates from the current diff.
3. Run `make acceptance-run` when gates are safe for the current environment.
4. Use bounded probes only when required gates fail or leave a meaningful unproven risk.
5. Convert useful probes into stable gates before marking a feature done.
6. Update execution plans and feature contracts when behavior or scope changes.
7. For capability bootstrap loops, register the domain in `tooling/acceptance/domains/index.yaml`, create a profile under `tooling/acceptance/domains/`, and validate it with `make acceptance-validate DOMAIN=<domain>`.
8. For managed domains such as Station Dashboard, run the domain-specific evidence target after structural validation.
9. For Federation changes, run domain validation after the Federation gates so capability evidence can reference the latest run result.

## Probe Budget

- At most 3 hypotheses.
- At most 5 extra commands.
- At most 20 minutes.
- Every probe must state hypothesis, action, result, and whether it should be preserved.

## Report Requirements

The final handoff must state what was automatically proven, what was not proven,
which gates ran, where artifacts are, and which risks require human review.

## Federation Bootstrap

Federation is a managed domain profile, not the acceptance core:

- It proves the locally wired Federation scope through Station, Desktop, and
  Station Access gates.
- It must keep multi-Station convergence and browser-visible remote operations
  listed as unproven until a new owned environment contract exists.

Use `make acceptance-validate DOMAIN=federation` for structural validation and
`make acceptance-federation-domain-validation` for current-evidence validation.

## Domain Onboarding

Use the onboarding templates instead of copying an existing domain:

- `tooling/acceptance/templates/domain.yaml`
- `tooling/acceptance/templates/capability.yaml`
- `tooling/acceptance/templates/feature.yaml`

Run `make acceptance-coverage-report` after onboarding changes. The report must show whether the domain is `active`, `candidate`, `planned`, or `not_onboarded`, and any `active` domain must pass `make acceptance-validate`.

Current active domains:

- `federation`: `managed_domain`, with multi-Station runtime proof unproven.
- `station-dashboard`: `managed_domain`, used to prove ordinary product-domain onboarding.
- `chat`: `managed_domain`, used to prove user-path onboarding across persistence, Station runtime message flow, realtime contracts, and Desktop typed surfaces.
