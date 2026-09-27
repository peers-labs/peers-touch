# ─── Local Worktree Dev ──────────────────────────────────────────
# Profile-based, worktree-isolated development environment.

.PHONY: env-register env-update env-unregister env-check env-status-all dev-ui dev-ui-snapshot dev-observe workflow-snapshot workflow-doctor \
        profile profile-authorize profile-init profiles config \
        dev-start dev-update dev-status dev-status-all dev-check dev-heartbeat dev-release \
        dev-session-start dev-session-status dev-transition dev-functional-result \
        active-work-sync active-work-status active-work-status-all active-work-close \
        completion-review-prepare completion-review-submit completion-review-status \
        plan-bind plan-binding plan-binding-advance plan-validate plan-status plan-current plan-next \
        plan-activate plan-advance plan-reopen \
        station station-check station-status station-logs station-stop station-restart \
        relay relay-check relay-status relay-logs relay-stop relay-restart \
        desktop desktop-stop desktop-restart \
        desktop-web desktop-web-stop desktop-web-restart \
        mobile mobile-stop mobile-restart \
        status stop restart

DEVCTL := node tooling/devctl/index.mjs
LOCAL_DEV_SCRIPTS := tooling/scripts/local-dev
MACHINE_DEV_SCRIPT := $(LOCAL_DEV_SCRIPTS)/machine-dev.mjs
DEV_APP_SCRIPT := apps/dev/server/index.mjs
WORKFLOW_SNAPSHOT_SCRIPT := $(LOCAL_DEV_SCRIPTS)/workflow-snapshot.mjs
WORKFLOW_DOCTOR_SCRIPT := $(LOCAL_DEV_SCRIPTS)/workflow-doctor.mjs
PLANCTL_SCRIPT := tooling/scripts/plan/planctl.mjs
PLAN_BINDING_SCRIPT := tooling/scripts/plan/workspace-plan-binding.mjs
ENV_REPO_ARG := $(or $(ENV_REPO),$(abspath ../env))
PROFILE_ARG := $(or $(PROFILE),$(word 2,$(MAKECMDGOALS)))
SLOT_ARG := $(or $(SLOT),0)
ENV_OWNER_ARG := $(or $(OWNER),$(shell git config user.email 2>/dev/null))
ENV_CAPABILITIES_ARG := $(CAPABILITIES)
ENV_PURPOSE_ARG := $(PURPOSE)
ENV_BUDGET_SECONDS_ARG := $(or $(BUDGET_SECONDS),1200)
DEV_WORK_ITEM_ARG := $(or $(WORK_ITEM),$(DEV_WORK_ITEM))
DEV_SESSION_ARG := $(or $(SESSION),$(DEV_SESSION))
DEV_JOURNEY_ARG := $(or $(JOURNEY),$(DEV_JOURNEY))
DEV_PLAN_ARG := $(or $(DEV_PLAN),$(PLAN))
DEV_TASK_ARG := $(or $(DEV_TASK),$(TASK))
DEV_OWNER_EXPLICIT_ARG := $(or $(OWNER),$(DEV_OWNER))
DEV_OWNER_ARG := $(or $(DEV_OWNER_EXPLICIT_ARG),$(shell git config user.email 2>/dev/null))
DEV_PURPOSE_ARG := $(or $(PURPOSE),$(DEV_PURPOSE))
DEV_SOURCE_CLAIMS_ARG := $(or $(SOURCE_CLAIMS),$(DEV_SOURCE_CLAIMS))
DEV_RUNTIME_CLAIMS_ARG := $(or $(RUNTIME_CLAIMS),$(DEV_RUNTIME_CLAIMS))
DEV_RUNTIME_CLAIMS_SPECIFIED := $(if $(filter undefined,$(origin RUNTIME_CLAIMS)),$(if $(filter undefined,$(origin DEV_RUNTIME_CLAIMS)),,1),1)
DEV_EXPIRES_MINUTES_ARG := $(or $(EXPIRES_MINUTES),$(DEV_EXPIRES_MINUTES),480)
DEV_WORK_SCRIPT := $(LOCAL_DEV_SCRIPTS)/dev-work.mjs
DEV_SESSION_SCRIPT := $(LOCAL_DEV_SCRIPTS)/dev-session.mjs
ACTIVE_WORK_SCRIPT := $(LOCAL_DEV_SCRIPTS)/active-work.mjs
WORKTREE_OBSERVE_SCRIPT := $(LOCAL_DEV_SCRIPTS)/worktree-observe.mjs
COMPLETION_REVIEW_SCRIPT := $(LOCAL_DEV_SCRIPTS)/completion-review.mjs

env-register:
	@if [ -z "$(PROFILE)" ] || [ -z "$(SLOT)" ] || [ -z "$(ENV_CAPABILITIES_ARG)" ] || [ -z "$(ENV_PURPOSE_ARG)" ]; then \
		echo "Usage: make env-register PROFILE=<name> SLOT=<n> CAPABILITIES='station.connect[,station.deploy]' PURPOSE='<text>'"; \
		exit 1; \
	fi
	@node $(MACHINE_DEV_SCRIPT) register \
		--profile "$(PROFILE)" \
		--slot "$(SLOT)" \
		--capabilities "$(ENV_CAPABILITIES_ARG)" \
		--purpose "$(ENV_PURPOSE_ARG)" \
		--owner "$(ENV_OWNER_ARG)"

env-update:
	@node $(MACHINE_DEV_SCRIPT) update \
		$(if $(PROFILE),--profile "$(PROFILE)",) \
		$(if $(SLOT),--slot "$(SLOT)",) \
		$(if $(ENV_CAPABILITIES_ARG),--capabilities "$(ENV_CAPABILITIES_ARG)",) \
		$(if $(ENV_PURPOSE_ARG),--purpose "$(ENV_PURPOSE_ARG)",) \
		$(if $(OWNER),--owner "$(OWNER)",)

env-unregister:
	@node $(MACHINE_DEV_SCRIPT) unregister \
		--owner "$(ENV_OWNER_ARG)"

env-check:
	@node $(MACHINE_DEV_SCRIPT) check \
		$(if $(WORKSPACE_ID),--workspace-id "$(WORKSPACE_ID)",) \
		$(if $(PROFILE),--profile "$(PROFILE)",) \
		$(if $(SLOT),--slot "$(SLOT)",) \
		$(if $(ENV_CAPABILITIES_ARG),--capabilities "$(ENV_CAPABILITIES_ARG)",) \
		--budget-seconds "$(ENV_BUDGET_SECONDS_ARG)"

env-status-all:
	@node $(MACHINE_DEV_SCRIPT) status-all

dev-ui:
	@node $(DEV_APP_SCRIPT) serve --env-repo "$(ENV_REPO_ARG)"

dev-ui-snapshot:
	@node $(DEV_APP_SCRIPT) snapshot --env-repo "$(ENV_REPO_ARG)"

dev-observe:
	@node $(WORKTREE_OBSERVE_SCRIPT) --workspace-root "$(CURDIR)" --host cli --event manual

workflow-snapshot:
	@node $(WORKFLOW_SNAPSHOT_SCRIPT)

workflow-doctor:
	@node $(WORKFLOW_DOCTOR_SCRIPT) --host "$(or $(IDE),trae)"

plan-bind:
	@if [ -z "$(PLAN)" ]; then echo "Usage: make plan-bind PLAN=<package-plan.md>"; exit 1; fi
	@node $(PLAN_BINDING_SCRIPT) bind \
		--repo-root "$(CURDIR)" \
		--plan "$(PLAN)" \
		--owner "$(DEV_OWNER_ARG)"

plan-binding:
	@node $(PLAN_BINDING_SCRIPT) resolve --repo-root "$(CURDIR)"

plan-binding-advance:
	@if [ -z "$(PLAN)" ] || [ -z "$(EXPECTED_GENERATION)" ]; then echo "Usage: make plan-binding-advance PLAN=<package-plan.md> EXPECTED_GENERATION=<n>"; exit 1; fi
	@node $(PLAN_BINDING_SCRIPT) advance \
		--repo-root "$(CURDIR)" \
		--plan "$(PLAN)" \
		--expected-generation "$(EXPECTED_GENERATION)" \
		--owner "$(DEV_OWNER_ARG)"

plan-validate:
	@if [ -z "$(PLAN)" ]; then echo "Usage: make plan-validate PLAN=<package-plan.md>"; exit 1; fi
	@node $(PLANCTL_SCRIPT) validate --plan "$(PLAN)" --repo-root "$(CURDIR)"

plan-status:
	@if [ -z "$(PLAN)" ]; then echo "Usage: make plan-status PLAN=<package-plan.md>"; exit 1; fi
	@node $(PLANCTL_SCRIPT) status --plan "$(PLAN)" --repo-root "$(CURDIR)"

plan-current:
	@if [ -z "$(PLAN)" ]; then echo "Usage: make plan-current PLAN=<package-plan.md>"; exit 1; fi
	@node $(PLANCTL_SCRIPT) current --plan "$(PLAN)" --repo-root "$(CURDIR)"

plan-next:
	@if [ -z "$(PLAN)" ]; then echo "Usage: make plan-next PLAN=<package-plan.md>"; exit 1; fi
	@node $(PLANCTL_SCRIPT) next --plan "$(PLAN)" --repo-root "$(CURDIR)"

plan-activate:
	@if [ -z "$(PLAN)" ] || [ -z "$(TASK)" ]; then echo "Usage: make plan-activate PLAN=<package-plan.md> TASK=<ready-id>"; exit 1; fi
	@node $(PLANCTL_SCRIPT) activate \
		--plan "$(PLAN)" \
		--repo-root "$(CURDIR)" \
		--task "$(TASK)"

plan-advance:
	@if [ -z "$(PLAN)" ] || [ -z "$(TO)" ] || [ -z "$(DEV_WORK_ITEM_ARG)" ]; then echo "Usage: make plan-advance PLAN=<package-plan.md> WORK_ITEM=<id> TO=<done|blocked|reactivate> [TASK=<current-id>] [SESSION=<session.json>] [NEXT=<ready-id>]"; exit 1; fi
	@node $(PLANCTL_SCRIPT) advance \
		--plan "$(PLAN)" \
		--repo-root "$(CURDIR)" \
		--work-item "$(DEV_WORK_ITEM_ARG)" \
		--to "$(TO)" \
		$(if $(TASK),--task "$(TASK)",) \
		$(if $(SESSION),--session "$(SESSION)",) \
		$(if $(NEXT),--next "$(NEXT)",) \
		$(if $(BLOCKER_CODE),--blocker-code "$(BLOCKER_CODE)",) \
		$(if $(BLOCKER_OWNER),--blocker-owner "$(BLOCKER_OWNER)",) \
		$(if $(BLOCKER_EVIDENCE_REF),--blocker-evidence-ref "$(BLOCKER_EVIDENCE_REF)",) \
		$(if $(RECORDED_AT),--recorded-at "$(RECORDED_AT)",) \
		$(foreach ref,$(EXHAUSTION_DECISION_REFS),--exhaustion-decision-ref "$(ref)") \
		$(foreach ref,$(EXHAUSTION_EVIDENCE_REFS),--exhaustion-evidence-ref "$(ref)")

plan-reopen:
	@if [ -z "$(PLAN)" ] || [ -z "$(DEV_WORK_ITEM_ARG)" ]; then echo "Usage: make plan-reopen PLAN=<package-plan.md> WORK_ITEM=<id>"; exit 1; fi
	@node $(PLANCTL_SCRIPT) reopen \
		--plan "$(PLAN)" \
		--repo-root "$(CURDIR)" \
		--work-item "$(DEV_WORK_ITEM_ARG)"

profile:
	@if [ -z "$(PROFILE_ARG)" ]; then echo "Usage: make profile <name>  or  make profile PROFILE=<name>"; exit 1; fi
	@node $(MACHINE_DEV_SCRIPT) update --profile "$(PROFILE_ARG)"

profile-authorize:
	@if [ -z "$(PROFILE_ARG)" ]; then echo "Usage: make profile-authorize <name> [SLOT=0]  or  make profile-authorize PROFILE=<name> [SLOT=0]"; exit 1; fi
	@SLOT=$(SLOT_ARG) /bin/bash $(LOCAL_DEV_SCRIPTS)/profile.sh authorize $(PROFILE_ARG)

profile-init:
	@if [ -z "$(PROFILE_ARG)" ]; then echo "Usage: make profile-init <name> [SLOT=0]  or  make profile-init PROFILE=<name> [SLOT=0] (requires profile-authorize)"; exit 1; fi
	@SLOT=$(SLOT_ARG) /bin/bash $(LOCAL_DEV_SCRIPTS)/profile.sh init $(PROFILE_ARG)

profiles:
	@$(DEVCTL) profile list

config:
	@$(DEVCTL) config

dev-start:
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ] || [ -z "$(DEV_PURPOSE_ARG)" ] || [ -z "$(DEV_SOURCE_CLAIMS_ARG)" ]; then \
		echo "Usage: make dev-start WORK_ITEM=<id> PURPOSE='<text>' SOURCE_CLAIMS='<mode>:<path>[;...]' [PLAN=<path> TASK=<id>] [JOURNEY=<id>] [RUNTIME_CLAIMS='<mode>:<kind>:<id>[;...]']"; \
		exit 1; \
	fi
	@node $(DEV_WORK_SCRIPT) start \
		--work-item "$(DEV_WORK_ITEM_ARG)" \
		--owner "$(DEV_OWNER_ARG)" \
		--purpose "$(DEV_PURPOSE_ARG)" \
		--source-claims "$(DEV_SOURCE_CLAIMS_ARG)" \
		--runtime-claims "$(DEV_RUNTIME_CLAIMS_ARG)" \
		--expires-minutes "$(DEV_EXPIRES_MINUTES_ARG)" \
		$(if $(DEV_SESSION_ARG),--session "$(DEV_SESSION_ARG)",) \
		$(if $(DEV_JOURNEY_ARG),--journey "$(DEV_JOURNEY_ARG)",) \
		$(if $(DEV_PLAN_ARG),--plan "$(DEV_PLAN_ARG)",) \
		$(if $(DEV_TASK_ARG),--task "$(DEV_TASK_ARG)",)

dev-update:
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ]; then echo "Usage: make dev-update WORK_ITEM=<id> [SOURCE_CLAIMS='...'] [RUNTIME_CLAIMS='...']"; exit 1; fi
	@node $(DEV_WORK_SCRIPT) update \
		--work-item "$(DEV_WORK_ITEM_ARG)" \
		--expires-minutes "$(DEV_EXPIRES_MINUTES_ARG)" \
		$(if $(DEV_SESSION_ARG),--session "$(DEV_SESSION_ARG)",) \
		$(if $(DEV_JOURNEY_ARG),--journey "$(DEV_JOURNEY_ARG)",) \
		$(if $(DEV_OWNER_EXPLICIT_ARG),--owner "$(DEV_OWNER_EXPLICIT_ARG)",) \
		$(if $(DEV_PURPOSE_ARG),--purpose "$(DEV_PURPOSE_ARG)",) \
		$(if $(DEV_SOURCE_CLAIMS_ARG),--source-claims "$(DEV_SOURCE_CLAIMS_ARG)",) \
		$(if $(DEV_RUNTIME_CLAIMS_SPECIFIED),--runtime-claims "$(DEV_RUNTIME_CLAIMS_ARG)",) \
		$(if $(DEV_PLAN_ARG),--plan "$(DEV_PLAN_ARG)",) \
		$(if $(DEV_TASK_ARG),--task "$(DEV_TASK_ARG)",)

dev-status:
	@node $(DEV_WORK_SCRIPT) status $(if $(DEV_WORK_ITEM_ARG),--work-item "$(DEV_WORK_ITEM_ARG)",)

dev-status-all:
	@node $(DEV_WORK_SCRIPT) status-all

dev-check:
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ]; then echo "Usage: make dev-check WORK_ITEM=<id>"; exit 1; fi
	@node $(DEV_WORK_SCRIPT) check \
		--work-item "$(DEV_WORK_ITEM_ARG)" \
		$(if $(DEV_SESSION_ARG),--session "$(DEV_SESSION_ARG)",)

dev-heartbeat:
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ]; then echo "Usage: make dev-heartbeat WORK_ITEM=<id>"; exit 1; fi
	@node $(DEV_WORK_SCRIPT) heartbeat \
		--work-item "$(DEV_WORK_ITEM_ARG)" \
		--expires-minutes "$(DEV_EXPIRES_MINUTES_ARG)" \
		$(if $(DEV_SESSION_ARG),--session "$(DEV_SESSION_ARG)",)

dev-release:
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ]; then echo "Usage: make dev-release WORK_ITEM=<id>"; exit 1; fi
	@node $(DEV_WORK_SCRIPT) release \
		--work-item "$(DEV_WORK_ITEM_ARG)" \
		$(if $(DEV_SESSION_ARG),--session "$(DEV_SESSION_ARG)",)

dev-session-start:
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ] || [ -z "$(DEV_TASK_ARG)" ] || [ -z "$(DEV_JOURNEY_ARG)" ]; then \
		echo "Usage: make dev-session-start WORK_ITEM=<id> TASK=<id> JOURNEY=<id> [PLAN=<path>]"; \
		exit 1; \
	fi
	@node $(DEV_SESSION_SCRIPT) start \
		--work-item "$(DEV_WORK_ITEM_ARG)" \
		--task "$(DEV_TASK_ARG)" \
		--journey "$(DEV_JOURNEY_ARG)" \
		$(if $(DEV_PLAN_ARG),--plan "$(DEV_PLAN_ARG)",)

dev-session-status:
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ]; then echo "Usage: make dev-session-status WORK_ITEM=<id>"; exit 1; fi
	@node $(DEV_SESSION_SCRIPT) status --work-item "$(DEV_WORK_ITEM_ARG)"

dev-transition:
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ] || [ -z "$(TO)" ] || [ -z "$(REASON)" ]; then \
		echo "Usage: make dev-transition WORK_ITEM=<id> TO=<state> REASON='<text>' [SOURCE='<json>'] [VERIFICATION='<json>'] [FAILURE='<json>'] [RUNTIME_BINDING_REF=<ref>]"; \
		exit 1; \
	fi
	@node $(DEV_SESSION_SCRIPT) transition \
		--work-item "$(DEV_WORK_ITEM_ARG)" \
		--to "$(TO)" \
		--reason "$(REASON)" \
		$(if $(SOURCE),--source '$(SOURCE)',) \
		$(if $(VERIFICATION),--verification '$(VERIFICATION)',) \
		$(if $(FAILURE),--failure '$(FAILURE)',) \
		$(if $(RUNTIME_BINDING_REF),--runtime-binding-ref "$(RUNTIME_BINDING_REF)",)

dev-functional-result:
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ] || [ -z "$(REASON)" ]; then \
		echo "Usage: make dev-functional-result WORK_ITEM=<id> REASON='<text>' [RUNTIME_CELL=<cell>]"; \
		exit 1; \
	fi
	@node $(DEV_SESSION_SCRIPT) functional-result \
		--work-item "$(DEV_WORK_ITEM_ARG)" \
		--reason "$(REASON)" \
		$(if $(RUNTIME_CELL),--runtime-cell "$(RUNTIME_CELL)",)

active-work-sync:
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ]; then echo "Usage: make active-work-sync WORK_ITEM=<id> [EXPECTED_REVISION=<n>]"; exit 1; fi
	@node $(ACTIVE_WORK_SCRIPT) sync \
		--work-item "$(DEV_WORK_ITEM_ARG)" \
		$(if $(EXPECTED_REVISION),--expected-revision "$(EXPECTED_REVISION)",)

active-work-status:
	@node $(ACTIVE_WORK_SCRIPT) status

active-work-status-all:
	@node $(ACTIVE_WORK_SCRIPT) status-all

active-work-close:
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ] || [ -z "$(EXPECTED_REVISION)" ]; then \
		echo "Usage: make active-work-close WORK_ITEM=<id> EXPECTED_REVISION=<n>"; \
		exit 1; \
	fi
	@node $(ACTIVE_WORK_SCRIPT) close \
		--work-item "$(DEV_WORK_ITEM_ARG)" \
		--expected-revision "$(EXPECTED_REVISION)"

completion-review-prepare:
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ]; then echo "Usage: make completion-review-prepare WORK_ITEM=<id> [SCOPE=<task|plan>] [NEXT=<ready-id>]"; exit 1; fi
	@node $(COMPLETION_REVIEW_SCRIPT) prepare \
		--repo-root "$(CURDIR)" \
		--work-item "$(DEV_WORK_ITEM_ARG)" \
		$(if $(SCOPE),--scope "$(SCOPE)",) \
		$(if $(NEXT),--next "$(NEXT)",)

completion-review-submit:
	@if [ -z "$(REVIEW)" ] || [ -z "$(VERDICT)" ] || [ -z "$(ASSESSMENT)" ]; then echo "Usage: make completion-review-submit REVIEW=<id> VERDICT=<PASS|FAIL> ASSESSMENT=<json-file> [NEXT=<ready-id>]"; exit 1; fi
	@node $(COMPLETION_REVIEW_SCRIPT) submit \
		--repo-root "$(CURDIR)" \
		--review "$(REVIEW)" \
		--verdict "$(VERDICT)" \
		--assessment "$(ASSESSMENT)" \
		$(if $(NEXT),--next "$(NEXT)",)

completion-review-status:
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ]; then echo "Usage: make completion-review-status WORK_ITEM=<id>"; exit 1; fi
	@node $(COMPLETION_REVIEW_SCRIPT) status \
		--repo-root "$(CURDIR)" \
		--work-item "$(DEV_WORK_ITEM_ARG)"

station:
	@$(DEVCTL) station start

station-check:
	@$(DEVCTL) station check

station-status:
	@$(DEVCTL) station status

station-logs:
	@bash $(LOCAL_DEV_SCRIPTS)/station-logs.sh

station-stop:
	@$(DEVCTL) station stop

station-restart:
	@$(DEVCTL) station restart

relay:
	@bash $(LOCAL_DEV_SCRIPTS)/relay-dev.sh

relay-check:
	@bash $(LOCAL_DEV_SCRIPTS)/relay-check.sh

relay-status:
	@bash $(LOCAL_DEV_SCRIPTS)/relay-status.sh

relay-logs:
	@bash $(LOCAL_DEV_SCRIPTS)/relay-logs.sh

relay-stop:
	@bash $(LOCAL_DEV_SCRIPTS)/stop.sh relay

relay-restart:
	@bash $(LOCAL_DEV_SCRIPTS)/restart.sh relay

desktop:
	@$(DEVCTL) desktop start --mode app

desktop-stop:
	@$(DEVCTL) desktop stop --mode app

desktop-restart:
	@$(DEVCTL) desktop restart --mode app

desktop-web:
	@$(DEVCTL) desktop start --mode web

desktop-web-stop:
	@$(DEVCTL) desktop stop --mode web

desktop-web-restart:
	@$(DEVCTL) desktop restart --mode web

mobile:
	@bash $(LOCAL_DEV_SCRIPTS)/mobile-ios-sim.sh

mobile-stop:
	@bash $(LOCAL_DEV_SCRIPTS)/stop.sh mobile

mobile-restart:
	@bash $(LOCAL_DEV_SCRIPTS)/restart.sh mobile

status:
	@$(DEVCTL) status

stop:
	@$(DEVCTL) stop all

restart:
	@$(DEVCTL) restart all

.DEFAULT:
	@if [[ "$(firstword $(MAKECMDGOALS))" == "profile" || "$(firstword $(MAKECMDGOALS))" == "profile-authorize" || "$(firstword $(MAKECMDGOALS))" == "profile-init" || "$(firstword $(MAKECMDGOALS))" == "run-prototype" ]]; then \
		:; \
	else \
		echo "make: *** No rule to make target '$@'."; \
		exit 2; \
	fi
