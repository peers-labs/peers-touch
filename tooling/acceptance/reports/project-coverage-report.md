# Acceptance Project Coverage Report

This report summarizes which product domains are managed by the project-level acceptance framework.

## Domain Coverage

| Domain | Status | Coverage | Validation | Capability Count | Notes |
|--------|--------|----------|------------|------------------|-------|
| federation | active | project_validation_domain | missing_report | 7 | First complex validation domain. It proves acceptance framework feasibility without becoming acceptance core. |
| chat | active | managed_domain | structurally_valid | 8 | Third product domain. It validates user-path onboarding for chat persistence, realtime contracts, and Desktop typed surfaces without claiming full UI E2E. |
| mobile | planned | not_onboarded | not_validated | 0 | Needs mobile-web, Tauri mobile runtime, native plugin, and device/simulator acceptance boundaries. |
| applet | active | managed_domain | missing_report | 2 | Managed domain for applet Desktop lifecycle smoothness and runtime gates. Current proven coverage includes runtime lease smoothness; `make desktop` A-to-B-to-close-to-wakeup lifecycle evidence is required before production-ready claims. Cross-platform mobile remains out of scope. |
| agent | active | managed_domain | structurally_valid | 6 | Managed domain for Native Agent product journeys. Current contracts cover mention composition, Station-backed knowledge binding, connector lifecycle, message forwarding, and Portal navigation; each remains unproven until its dedicated Native Gate passes. |
| station-dashboard | active | managed_domain | missing_report | 3 | Second product domain. It validates project-level acceptance onboarding without becoming an acceptance validation domain. |

## Active Capabilities

- `acceptance-framework-self-consistency` (delivery-quality, acceptance_core_self_validation)
- `agent-connector-lifecycle` (agent, acceptance_validates_product)
- `agent-knowledge-binding` (agent, acceptance_validates_product)
- `agent-mention-composer` (agent, acceptance_validates_product)
- `agent-message-forward` (agent, acceptance_validates_product)
- `agent-portal-navigation` (agent, acceptance_validates_product)
- `applet-desktop-lifecycle-smoothness` (applet, acceptance_validates_product)
- `chat-desktop-dom-message-visible` (chat, acceptance_validates_product)
- `chat-live-realtime-delivery` (chat, acceptance_validates_product)
- `chat-native-visible-clients` (chat, acceptance_validates_product)
- `chat-proto-service-contract` (chat, acceptance_validates_product)
- `chat-realtime-contract` (chat, acceptance_validates_product)
- `chat-runtime-message-flow` (chat, acceptance_validates_product)
- `desktop-chat-typed-surface` (chat, acceptance_validates_product)
- `desktop-federation-context-surface` (federation, acceptance_validates_product)
- `federation-dashboard-operational-surface` (federation, acceptance_validates_product)
- `federation-discovery-trust-boundary` (federation, acceptance_validates_product)
- `federation-governance-truth` (federation, acceptance_validates_product)
- `federation-ledger-convergence` (federation, acceptance_validates_product)
- `federation-validates-acceptance-framework` (delivery-quality, product_domain_validates_acceptance)
- `station-dashboard-admin-access` (station-dashboard, acceptance_validates_product)
- `station-dashboard-operator-surface` (station-dashboard, acceptance_validates_product)

## Onboarding Rule

- New product domains start in `tooling/acceptance/domains/index.yaml` as `candidate` or `planned`.
- A domain becomes `active` only after it has a profile, capabilities, feature contracts, registry mapping, gates, and a passing `make acceptance-validate DOMAIN=<domain>` structural result.
- Evidence status becomes `evidence_proven` only after the domain runs its stable gates and `acceptance-validate --require-proven` passes.
- Federation is the first validation domain, not the acceptance core.
