# ─── Acceptance Framework ───────────────────────────────────────

.PHONY: acceptance-plan acceptance-run acceptance-run-ci acceptance-run-local-evidence \
        acceptance-run-env-evidence acceptance-run-nightly acceptance-report acceptance acceptance-validate \
        acceptance-driver-build acceptance-driver-smoke \
        acceptance-coverage-report acceptance-chat acceptance-chat-domain-validation \
        acceptance-chat-desktop-gateway \
        acceptance-chat-native-static acceptance-chat-native-two-client \
        acceptance-chat-native-interactions acceptance-chat-native-typing \
        acceptance-chat-native-multi-device acceptance-chat-native-recovery \
        acceptance-chat-native-group-mls acceptance-chat-native-w8 \
        acceptance-chat-contact-message-resilience \
        acceptance-chat-w11 \
        acceptance-station-dashboard acceptance-station-dashboard-domain-validation \
        acceptance-federation acceptance-federation-mutual-validation acceptance-federation-report \
        acceptance-agent acceptance-agent-domain-validation \
        acceptance-agent-native-static acceptance-agent-native-e2e acceptance-agent-full \
        acceptance-driver-build acceptance-driver-smoke \
        acceptance-desktop-performance-preflight-static acceptance-desktop-performance-preflight \
        acceptance-desktop-telemetry-live acceptance-desktop-telemetry-mirror-static \
        acceptance-desktop-telemetry-mirror-template-static acceptance-desktop-telemetry-mirror-template \
        acceptance-desktop-anchor-inventory acceptance-desktop-anchor-source-static acceptance-desktop-anchor-source \
        acceptance-desktop-anchor-dom-evidence-template-static \
        acceptance-desktop-anchor-dom-evidence-collect-static \
        acceptance-desktop-anchor-dom-evidence-template acceptance-desktop-anchor-dom-evidence \
        acceptance-desktop-performance-cell-template-static acceptance-desktop-performance-cell-template \
        acceptance-desktop-performance-cell-collect-static acceptance-desktop-performance-cell-collect \
        acceptance-desktop-performance-sampler-static acceptance-desktop-performance-sampler \
        acceptance-desktop-performance-matrix acceptance-desktop-performance-report \
        federation-surface-smoke federation-dashboard-visible-surface \
        federation-dashboard-operational-drilldown federation-desktop-gateway-smoke

ACCEPTANCE_RANGE ?= HEAD
ACCEPTANCE_PLAN ?= tooling/acceptance/reports/latest-plan.json
ACCEPTANCE_RUN_PLAN_ARG = $(if $(PLAN),--plan $(PLAN),--plan $(ACCEPTANCE_PLAN))
ACCEPTANCE_DRIVER_BINARY ?= .local/acceptance/bin/peers-touch-desktop

acceptance-driver-build:
	VITE_ACCEPTANCE_HARNESS=1 pnpm --dir apps/desktop run build
	cd apps/desktop/src-tauri && \
		TAURI_CONFIG='{"app":{"withGlobalTauri":true}}' \
		cargo build --features acceptance-webdriver
	@mkdir -p "$(dir $(ACCEPTANCE_DRIVER_BINARY))"
	@cp apps/desktop/src-tauri/target/debug/peers-touch-desktop "$(ACCEPTANCE_DRIVER_BINARY).tmp"
	@chmod 0755 "$(ACCEPTANCE_DRIVER_BINARY).tmp"
	@mv "$(ACCEPTANCE_DRIVER_BINARY).tmp" "$(ACCEPTANCE_DRIVER_BINARY)"

acceptance-driver-smoke:
	python3 -m tooling.acceptance.drivers.tauri

acceptance-plan:
	python3 tooling/scripts/acceptance-plan.py --root tooling/acceptance --range "$(ACCEPTANCE_RANGE)" --output "$(ACCEPTANCE_PLAN)"

acceptance-run:
	python3 tooling/scripts/acceptance-run.py $(ACCEPTANCE_RUN_PLAN_ARG)

acceptance-run-ci:
	python3 tooling/scripts/acceptance-run.py $(ACCEPTANCE_RUN_PLAN_ARG) --tier ci-structure --tier ci-cheap

acceptance-run-local-evidence:
	python3 tooling/scripts/acceptance-run.py $(ACCEPTANCE_RUN_PLAN_ARG) --tier local-evidence

acceptance-run-env-evidence:
	python3 tooling/scripts/acceptance-run.py $(ACCEPTANCE_RUN_PLAN_ARG) --tier env-evidence

acceptance-run-nightly:
	python3 tooling/scripts/acceptance-run.py $(ACCEPTANCE_RUN_PLAN_ARG) --tier nightly

acceptance-report:
	python3 tooling/scripts/acceptance-report.py

acceptance:
	$(if $(PLAN),,python3 tooling/scripts/acceptance-plan.py --root tooling/acceptance --range "$(ACCEPTANCE_RANGE)" --output "$(ACCEPTANCE_PLAN)")
	python3 tooling/scripts/acceptance-run.py $(ACCEPTANCE_RUN_PLAN_ARG)
	python3 tooling/scripts/acceptance-report.py

acceptance-validate:
	python3 tooling/scripts/acceptance-validate.py $(if $(DOMAIN),--domain $(DOMAIN),)

acceptance-coverage-report:
	python3 tooling/scripts/acceptance-coverage-report.py

acceptance-chat:
	python3 tooling/scripts/acceptance-run.py \
		--gate acceptance-plan-self \
		--gate proto-build \
		--gate station-messaging-unit \
		--gate messaging-platform-contract \
		--gate desktop-check \
		--gate chat-native-visible-static \
		--gate chat-desktop-gateway-e2e

acceptance-chat-domain-validation:
	python3 tooling/scripts/acceptance-run.py \
		--gate acceptance-plan-self \
		--gate proto-build \
		--gate station-messaging-unit \
		--gate messaging-platform-contract \
		--gate desktop-check \
		--gate chat-native-visible-static \
		--gate chat-desktop-gateway-e2e
	python3 tooling/scripts/acceptance-run.py --gate chat-domain-validation

acceptance-chat-desktop-gateway:
	python3 tooling/scripts/acceptance-run.py --gate chat-desktop-gateway-e2e

acceptance-chat-native-static:
	python3 tooling/scripts/acceptance-run.py --gate chat-native-visible-static

acceptance-chat-native-two-client:
	python3 tooling/scripts/acceptance-run.py --gate chat-native-two-client-e2e

acceptance-chat-native-interactions:
	python3 tooling/scripts/acceptance-run.py --gate chat-native-interactions-e2e

acceptance-chat-native-typing:
	python3 tooling/scripts/acceptance-run.py --gate chat-native-typing-e2e

acceptance-chat-native-multi-device:
	python3 tooling/scripts/acceptance-run.py --gate chat-native-multi-device-e2e

acceptance-chat-native-recovery:
	python3 tooling/scripts/acceptance-run.py --gate chat-native-recovery-e2e

acceptance-chat-native-group-mls:
	python3 tooling/scripts/acceptance-run.py --gate chat-native-group-mls-e2e

acceptance-chat-contact-message-resilience:
	python3 tooling/scripts/acceptance-run.py --gate chat-contact-message-resilience-e2e

acceptance-chat-native-w8:
	python3 tooling/scripts/acceptance-run.py \
		--gate chat-native-two-client-e2e \
		--gate chat-native-interactions-e2e \
		--gate chat-native-typing-e2e \
		--gate chat-native-multi-device-e2e \
		--gate chat-native-recovery-e2e \
		--gate chat-native-group-mls-e2e

acceptance-chat-w11:
	python3 tooling/scripts/acceptance-closure-gen.py \
		--contract tooling/acceptance/closures/messaging-w11.yaml \
		--output tooling/acceptance/plans/chat-w11-closure.json \
		--manifest-output tooling/acceptance/reports/w11-contract-manifest.json
	python3 tooling/scripts/acceptance-run.py \
		--plan tooling/acceptance/plans/chat-w11-closure.json

acceptance-desktop-anchor-inventory:
	python3 tooling/scripts/acceptance-run.py --gate desktop-anchor-inventory-gate

acceptance-desktop-anchor-source-static:
	python3 tooling/scripts/acceptance-run.py --gate desktop-anchor-source-static-gate

acceptance-desktop-anchor-source:
	python3 tooling/scripts/acceptance-run.py --gate desktop-anchor-source-gate

acceptance-desktop-anchor-dom-evidence-template-static:
	python3 tooling/scripts/acceptance-run.py --gate desktop-anchor-dom-evidence-template-static-gate

acceptance-desktop-anchor-dom-evidence-collect-static:
	python3 tooling/scripts/acceptance-run.py --gate desktop-anchor-dom-evidence-collect-static-gate

acceptance-desktop-anchor-dom-evidence-template:
	python3 tooling/scripts/acceptance-run.py --gate desktop-anchor-dom-evidence-template-gate

acceptance-desktop-anchor-dom-evidence:
	python3 tooling/scripts/acceptance-run.py --gate desktop-anchor-dom-evidence-gate

acceptance-desktop-performance-cell-template-static:
	python3 tooling/scripts/acceptance-run.py --gate desktop-performance-cell-template-static-gate

acceptance-desktop-performance-cell-template:
	python3 tooling/scripts/acceptance-run.py --gate desktop-performance-cell-template-gate

acceptance-desktop-performance-cell-collect-static:
	python3 tooling/scripts/acceptance-run.py --gate desktop-performance-cell-collect-static-gate

acceptance-desktop-performance-cell-collect:
	python3 tooling/scripts/acceptance-run.py --gate desktop-performance-cell-collect-gate

acceptance-desktop-performance-sampler-static:
	python3 tooling/scripts/acceptance-run.py --gate desktop-performance-sampler-static-gate

acceptance-desktop-performance-sampler:
	python3 tooling/scripts/acceptance-run.py --gate desktop-performance-sampler-gate

acceptance-desktop-performance-preflight-static:
	python3 tooling/scripts/acceptance-run.py --gate desktop-performance-preflight-static-gate

acceptance-desktop-performance-preflight:
	python3 tooling/scripts/acceptance-run.py --gate desktop-performance-preflight-gate

acceptance-desktop-telemetry-live:
	python3 tooling/scripts/acceptance-run.py --gate desktop-telemetry-live-gate

acceptance-desktop-telemetry-mirror-static:
	python3 tooling/scripts/acceptance-run.py --gate desktop-telemetry-mirror-static-gate

acceptance-desktop-telemetry-mirror-template-static:
	python3 tooling/scripts/acceptance-run.py --gate desktop-telemetry-mirror-template-static-gate

acceptance-desktop-telemetry-mirror-template:
	python3 tooling/scripts/acceptance-run.py --gate desktop-telemetry-mirror-template-gate

acceptance-station-dashboard:
	python3 tooling/scripts/acceptance-run.py \
		--gate acceptance-plan-self \
		--gate station-dashboard-unit \
		--gate station-dashboard-web-check

acceptance-station-dashboard-domain-validation: acceptance-station-dashboard
	python3 tooling/scripts/acceptance-run.py --gate station-dashboard-domain-validation

acceptance-desktop-performance-matrix:
	python3 tooling/scripts/acceptance-run.py --gate desktop-performance-matrix-gate

acceptance-desktop-performance-report:
	python3 tooling/scripts/acceptance-run.py --gate desktop-performance-report-gate

acceptance-federation:
	python3 tooling/scripts/acceptance-run.py \
		--gate acceptance-plan-self \
		--gate proto-build \
		--gate station-federation-unit \
		--gate federation-three-node-e2e \
		--gate station-dashboard-unit \
		--gate desktop-check \
		--gate federation-surface-smoke \
		--gate federation-dashboard-operational-drilldown \
		--gate federation-desktop-gateway-smoke

acceptance-federation-mutual-validation: acceptance-federation
	python3 tooling/scripts/acceptance-run.py --gate federation-mutual-validation

acceptance-federation-report: acceptance-federation-mutual-validation
	python3 tooling/scripts/acceptance-capability-report.py \
		--title "Federation Acceptance Feasibility Report" \
		--feature acceptance-framework \
		--feature federation-ledger \
		--feature federation-governance \
		--feature federation-discovery-network \
		--feature federation-dashboard-operations \
		--feature federation-operational-observability \
		--feature desktop-federation-surfaces \
		--mutual-validation tooling/acceptance/reports/federation-mutual-validation.json \
		--output tooling/acceptance/reports/federation-acceptance-report.md

federation-surface-smoke:
	python3 tooling/acceptance/gates/federation/surface_smoke.py

federation-dashboard-visible-surface:
	python3 tooling/acceptance/gates/dashboard/federation_visible_surface.py

federation-dashboard-operational-drilldown:
	python3 tooling/acceptance/gates/dashboard/federation_operational_drilldown.py

federation-desktop-gateway-smoke:
	python3 tooling/acceptance/gates/desktop/gateway_smoke.py

acceptance-agent:
	python3 tooling/scripts/acceptance-run.py \
		--gate acceptance-plan-self \
		--gate proto-build \
		--gate station-agent-unit \
		--gate agent-contract-static \
		--gate desktop-check \
		--gate desktop-rust-check

acceptance-agent-domain-validation:
	python3 tooling/scripts/acceptance-run.py \
		--gate acceptance-plan-self \
		--gate proto-build \
		--gate station-agent-unit \
		--gate agent-contract-static \
		--gate desktop-check \
		--gate desktop-rust-check \
		--gate agent-domain-validation

acceptance-agent-native-static:
	python3 tooling/scripts/acceptance-run.py --gate agent-native-turn-static

acceptance-driver-build:
	cd apps/desktop/src-tauri && cargo build --features acceptance-webdriver

acceptance-driver-smoke:
	python3 tooling/acceptance/drivers/tauri.py

acceptance-agent-native-e2e:
	python3 tooling/scripts/acceptance-run.py --gate agent-native-turn-e2e

acceptance-agent-full: acceptance-agent-domain-validation acceptance-agent-native-static
	python3 tooling/scripts/acceptance-run.py --gate agent-native-turn-e2e
