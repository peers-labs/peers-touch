# Acceptance Framework

`tooling/acceptance/` is the product acceptance layer for agent-driven delivery. It
defines how a product capability proves that it is complete, which gates must
run for a changed path, and which artifacts should be produced for human review.

## Responsibilities

- `registry.yaml` maps changed paths to required gates and impacted features.
- `capabilities/` defines project-wide and domain-specific product capabilities, evidence, and unproven scope.
- `domains/` defines validation profiles for product domains such as Federation.
- `domains/index.yaml` lists project domains, onboarding status, coverage state, and next candidates.
- `templates/` contains domain, capability, and feature templates for new product domains.
- `gates.yaml` defines gate commands, timeouts, environments, and artifact expectations.
- `features/` contains product feature contracts.
- `gates/` contains stable cross-system acceptance implementations.
- `playbooks/` explains how agents should run, diagnose, and preserve acceptance flows.
- `reports/` stores local or CI acceptance artifacts and is ignored by git.

## Federation Bootstrap Loop

Federation is the first validation domain for this framework because it crosses
Station, Dashboard, Desktop gateway, projections, and isolated testnet services.
This creates a two-way proof:

- Acceptance proves Federation capability by running stable gates against the live `fedp5` environment.
- Federation proves Acceptance feasibility because the gates exercise real product surfaces instead of mocks.
- `make acceptance-federation-report` runs the Federation gates and writes `tooling/acceptance/reports/federation-acceptance-report.md`.
- `make acceptance-validate DOMAIN=federation` checks the Federation domain profile against the project-wide capability graph, feature contracts, registry planning, gate definitions, run results, and reports.
- `make acceptance-federation-mutual-validation` remains a Federation alias, not the acceptance core entry.

## Project Coverage

- `make acceptance-validate` validates every active domain structure in `tooling/acceptance/domains/index.yaml`.
- `make acceptance-validate DOMAIN=chat` validates the Chat managed-domain profile structure.
- `make acceptance-validate DOMAIN=federation` validates one domain profile structure.
- `make acceptance-validate DOMAIN=station-dashboard` validates the Station Dashboard managed-domain profile structure.
- `python3 tooling/scripts/acceptance-validate.py --domain federation --require-proven` additionally requires latest gate evidence; this is what the Federation mutual-validation gate uses.
- `make acceptance-chat-domain-validation` runs the Chat gates, including Station runtime message flow and Desktop DOM synced-message visibility, and then requires latest evidence for the managed domain profile.
- `make acceptance-chat-desktop-dom` requires a running Desktop web (`CHAT_DESKTOP_DOM_URL`, default `http://127.0.0.1:3210/#/chat`) and Desktop HTTP gateway (`CHAT_DESKTOP_DOM_GATEWAY_URL`, default `http://127.0.0.1:3030`).
- `make acceptance-station-dashboard-domain-validation` runs the Station Dashboard gates and then requires latest evidence for the managed domain profile.
- `make acceptance-coverage-report` writes `tooling/acceptance/reports/project-coverage-report.md` and summarizes active, candidate, planned, and not-onboarded domains.

## Agent Workflow

1. Update or add a feature contract when a new product capability is introduced.
2. Run `make acceptance-plan` after code changes.
3. Run `make acceptance-run` for the selected gates.
4. Run `make acceptance-report` and include proven / unproven scope in the handoff.
5. Move useful probes into `tooling/acceptance/gates/` and reference them from `gates.yaml`.
6. For a product capability loop, run the capability-specific report target such as `make acceptance-federation-report`.
7. For a new product domain, follow `docs/architecture/acceptance-framework/domain-onboarding.md` and start from `tooling/acceptance/templates/`.

## Boundary

Acceptance is not a replacement for unit tests inside `apps/*`. Language-native
tests stay close to their code. Acceptance gates prove product behavior across
Station, Desktop, Dashboard, testnet, and projections.
