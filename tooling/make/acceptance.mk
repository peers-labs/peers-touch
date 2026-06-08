# ─── Acceptance Framework ───────────────────────────────────────

.PHONY: acceptance-plan acceptance-run acceptance-report acceptance acceptance-validate \
        acceptance-coverage-report acceptance-chat acceptance-chat-domain-validation \
        acceptance-chat-desktop-gateway acceptance-chat-desktop-dom \
        acceptance-station-dashboard acceptance-station-dashboard-domain-validation \
        acceptance-federation acceptance-federation-mutual-validation acceptance-federation-report \
        federation-surface-smoke federation-dashboard-visible-surface \
        federation-dashboard-operational-drilldown federation-desktop-gateway-smoke

CHAT_DESKTOP_DOM_URL ?= http://127.0.0.1:3210/#/chat
CHAT_DESKTOP_DOM_GATEWAY_URL ?= http://127.0.0.1:3030

acceptance-plan:
	python3 tooling/scripts/acceptance-plan.py --root tooling/acceptance

acceptance-run:
	python3 tooling/scripts/acceptance-run.py

acceptance-report:
	python3 tooling/scripts/acceptance-report.py

acceptance: acceptance-plan acceptance-run acceptance-report

acceptance-validate:
	python3 tooling/scripts/acceptance-validate.py $(if $(DOMAIN),--domain $(DOMAIN),)

acceptance-coverage-report:
	python3 tooling/scripts/acceptance-coverage-report.py

acceptance-chat:
	python3 tooling/scripts/acceptance-run.py \
		--gate acceptance-plan-self \
		--gate proto-build \
		--gate station-chat-unit \
		--gate chat-runtime-e2e \
		--gate chat-live-realtime-e2e \
		--gate desktop-check

acceptance-chat-domain-validation:
	CHAT_DESKTOP_DOM_URL='$(CHAT_DESKTOP_DOM_URL)' \
	CHAT_DESKTOP_DOM_GATEWAY_URL='$(CHAT_DESKTOP_DOM_GATEWAY_URL)' \
	python3 tooling/scripts/acceptance-run.py \
		--gate acceptance-plan-self \
		--gate proto-build \
		--gate station-chat-unit \
		--gate chat-runtime-e2e \
		--gate chat-live-realtime-e2e \
		--gate desktop-check \
		--gate chat-desktop-dom-message-visible
	python3 tooling/scripts/acceptance-run.py --gate chat-domain-validation

acceptance-chat-desktop-gateway:
	python3 tooling/scripts/acceptance-run.py --gate chat-desktop-gateway-e2e

acceptance-chat-desktop-dom:
	CHAT_DESKTOP_DOM_URL='$(CHAT_DESKTOP_DOM_URL)' \
	CHAT_DESKTOP_DOM_GATEWAY_URL='$(CHAT_DESKTOP_DOM_GATEWAY_URL)' \
	python3 tooling/scripts/acceptance-run.py --gate chat-desktop-dom-message-visible

acceptance-station-dashboard:
	python3 tooling/scripts/acceptance-run.py \
		--gate acceptance-plan-self \
		--gate station-dashboard-unit \
		--gate station-dashboard-web-check

acceptance-station-dashboard-domain-validation: acceptance-station-dashboard
	python3 tooling/scripts/acceptance-run.py --gate station-dashboard-domain-validation

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
