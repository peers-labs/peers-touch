# ─── Local Worktree Dev ──────────────────────────────────────────
# Profile-based, worktree-isolated development environment.

.PHONY: worktree-create worktree-creation-status env-register env-update env-unregister env-check env-status-all dev-observe workflow-snapshot workflow-doctor \
        profile profile-authorize profile-init profiles config \
        dev-start dev-update dev-status dev-status-all dev-close \
        completion-review-prepare completion-review-assess \
        plan-validate plan-inspect plan-task \
        station station-check station-status station-logs station-stop station-restart \
        relay relay-check relay-status relay-logs relay-stop relay-restart \
        desktop desktop-install desktop-stop desktop-restart \
        mobile mobile-stop mobile-restart \
        status stop restart

DEVCTL := node tooling/devctl/index.mjs
LOCAL_DEV_SCRIPTS := tooling/scripts/local-dev
MACHINE_DEV_SCRIPT := $(LOCAL_DEV_SCRIPTS)/machine-dev.mjs
WORKTREE_CREATE_SCRIPT := $(LOCAL_DEV_SCRIPTS)/worktree-create.mjs
WORKFLOW_SNAPSHOT_SCRIPT := $(LOCAL_DEV_SCRIPTS)/workflow-snapshot.mjs
WORKFLOW_DOCTOR_SCRIPT := $(LOCAL_DEV_SCRIPTS)/workflow-doctor.mjs
PLANCTL_SCRIPT := tooling/scripts/plan/planctl.mjs
ENV_REPO_ARG := $(or $(ENV_REPO),$(abspath ../env))
PROFILE_ARG := $(or $(PROFILE),$(word 2,$(MAKECMDGOALS)))
SLOT_ARG := $(or $(SLOT),0)
ENV_OWNER_ARG := $(or $(OWNER),$(shell git config user.email 2>/dev/null))
ENV_CAPABILITIES_ARG := $(CAPABILITIES)
ENV_PURPOSE_ARG := $(PURPOSE)
ENV_BUDGET_SECONDS_ARG := $(or $(BUDGET_SECONDS),1200)
DEV_PLAN_ARG := $(or $(DEV_PLAN),$(PLAN))
DEV_TASK_ARG := $(or $(DEV_TASK),$(TASK))
DEV_WORK_SCRIPT := $(LOCAL_DEV_SCRIPTS)/dev-work.mjs
DEV_CLOSE_SCRIPT := $(LOCAL_DEV_SCRIPTS)/development-close.mjs
WORKTREE_OBSERVE_SCRIPT := $(LOCAL_DEV_SCRIPTS)/worktree-observe.mjs
COMPLETION_REVIEW_SCRIPT := $(LOCAL_DEV_SCRIPTS)/completion-review.mjs

worktree-create:
	@if [ -z "$(WORKTREE)" ] || [ -z "$(BRANCH)" ] || [ -z "$(PURPOSE)" ]; then \
		echo "Usage: make worktree-create WORKTREE=<absolute-path> BRANCH=<new-branch> PURPOSE='<text>' [START=<ref>]"; \
		exit 1; \
	fi
	@node $(WORKTREE_CREATE_SCRIPT) create \
		--source-root "$(CURDIR)" \
		--path "$(WORKTREE)" \
		--branch "$(BRANCH)" \
		--start "$(or $(START),HEAD)" \
		--purpose "$(PURPOSE)"

worktree-creation-status:
	@node $(WORKTREE_CREATE_SCRIPT) status --workspace-root "$(CURDIR)"

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
		$(if $(WORKSPACE_ID),--workspace-id "$(WORKSPACE_ID)",) \
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

dev-observe:
	@node $(WORKTREE_OBSERVE_SCRIPT) --workspace-root "$(CURDIR)" --host cli --event manual

workflow-snapshot:
	@node $(WORKFLOW_SNAPSHOT_SCRIPT)

workflow-doctor:
	@node $(WORKFLOW_DOCTOR_SCRIPT) --host "$(or $(IDE),trae)"

plan-validate:
	@if [ -z "$(PLAN)" ]; then echo "Usage: make plan-validate PLAN=<package-plan.md>"; exit 1; fi
	@node $(PLANCTL_SCRIPT) validate --plan "$(PLAN)" --repo-root "$(CURDIR)"

plan-inspect:
	@if [ -z "$(PLAN)" ]; then echo "Usage: make plan-inspect PLAN=<package-plan.md>"; exit 1; fi
	@node $(PLANCTL_SCRIPT) inspect --plan "$(PLAN)" --repo-root "$(CURDIR)"

plan-task:
	@if [ -z "$(PLAN)" ] || [ -z "$(TASK)" ]; then echo "Usage: make plan-task PLAN=<package-plan.md> TASK=<task-id>"; exit 1; fi
	@node $(PLANCTL_SCRIPT) task --plan "$(PLAN)" --repo-root "$(CURDIR)" --task "$(TASK)"

profile:
	@if [ -z "$(PROFILE_ARG)" ]; then echo "Usage: make profile <name>  or  make profile PROFILE=<name>"; exit 1; fi
	@node $(MACHINE_DEV_SCRIPT) select \
		--profile "$(PROFILE_ARG)" \
		$(if $(SLOT),--slot "$(SLOT)",) \
		--owner "$(ENV_OWNER_ARG)"

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
	@if [ -z "$(DEV_TASK_ARG)" ] || [ -z "$(GOAL)" ] || [ -z "$(CONTRIBUTION)" ]; then \
		echo "Usage: make dev-start TASK=<id> GOAL='<task goal>' CONTRIBUTION='<north-star contribution>' [NORTH_STAR_REF=<ref>]"; \
		exit 1; \
	fi
	@node $(DEV_WORK_SCRIPT) start \
		--workspace-root "$(CURDIR)" \
		--task "$(DEV_TASK_ARG)" \
		--goal "$(GOAL)" \
		--contribution "$(CONTRIBUTION)" \
		$(if $(NORTH_STAR_REF),--north-star-ref "$(NORTH_STAR_REF)",) \
		$(if $(NEXT_ACTION),--next-action "$(NEXT_ACTION)",) \
		$(if $(SCOPE_PATHS),--scope-paths "$(SCOPE_PATHS)",) \
		$(if $(SCOPE_EXCLUSIONS),--scope-exclusions "$(SCOPE_EXCLUSIONS)",)

dev-update:
	@if [ -z "$(DEV_TASK_ARG)" ] || [ -z "$(EXPECTED_REVISION)" ] || [ -z "$(REASON)" ]; then echo "Usage: make dev-update TASK=<id> EXPECTED_REVISION=<n> REASON='<text>' [STAGE=<stage>] [STATE=<state>]"; exit 1; fi
	@node $(DEV_WORK_SCRIPT) update \
		--workspace-root "$(CURDIR)" \
		--task "$(DEV_TASK_ARG)" \
		--expected-revision "$(EXPECTED_REVISION)" \
		--reason "$(REASON)" \
		$(if $(STAGE),--stage "$(STAGE)",) \
		$(if $(STATE),--state "$(STATE)",) \
		$(if $(NEXT_ACTION),--next-action "$(NEXT_ACTION)",) \
		$(if $(EVIDENCE_REFS),--evidence-refs '$(EVIDENCE_REFS)',) \
		$(if $(RESOURCE_REFS),--resource-refs '$(RESOURCE_REFS)',) \
		$(if $(BLOCKER),--blocker '$(BLOCKER)',)

dev-status:
	@if [ -z "$(DEV_TASK_ARG)" ]; then echo "Usage: make dev-status TASK=<id>"; exit 1; fi
	@node $(DEV_WORK_SCRIPT) status --workspace-root "$(CURDIR)" --task "$(DEV_TASK_ARG)"

dev-status-all:
	@node $(DEV_WORK_SCRIPT) status-all --workspace-root "$(CURDIR)"

dev-close:
	@if [ -z "$(DEV_TASK_ARG)" ] || [ -z "$(EXPECTED_REVISION)" ] || [ -z "$(CLOSE_REASON)" ]; then \
		echo "Usage: make dev-close TASK=<id> EXPECTED_REVISION=<n> CLOSE_REASON=<completed|cancelled|owner-abandon> [EVIDENCE_REFS='<json>'] [RESOURCE_REFS='<json>']"; \
		exit 1; \
	fi
	@node $(DEV_CLOSE_SCRIPT) close \
		--workspace-root "$(CURDIR)" \
		--task "$(DEV_TASK_ARG)" \
		--expected-revision "$(EXPECTED_REVISION)" \
		--reason "$(CLOSE_REASON)" \
		$(if $(EVIDENCE_REFS),--evidence-refs '$(EVIDENCE_REFS)',) \
		$(if $(RESOURCE_REFS),--resource-refs '$(RESOURCE_REFS)',)

completion-review-prepare:
	@if [ -z "$(OBLIGATIONS)" ]; then echo "Usage: make completion-review-prepare OBLIGATIONS='<json>' [EVIDENCE='<json>'] [SCOPE_PATHS='<comma-list>']"; exit 1; fi
	@node $(COMPLETION_REVIEW_SCRIPT) standalone \
		--repo-root "$(CURDIR)" \
		--obligations '$(OBLIGATIONS)' \
		$(if $(EVIDENCE),--evidence '$(EVIDENCE)',) \
		$(if $(SCOPE_PATHS),--scope-paths "$(SCOPE_PATHS)",)

completion-review-assess:
	@if [ -z "$(OBLIGATIONS)" ]; then echo "Usage: make completion-review-assess OBLIGATIONS='<json>' EVIDENCE='<json>' [FINDINGS='<json>'] [SCOPE_PATHS='<comma-list>']"; exit 1; fi
	@node $(COMPLETION_REVIEW_SCRIPT) assess \
		--repo-root "$(CURDIR)" \
		--obligations '$(OBLIGATIONS)' \
		--evidence '$(EVIDENCE)' \
		$(if $(FINDINGS),--findings '$(FINDINGS)',) \
		$(if $(SCOPE_PATHS),--scope-paths "$(SCOPE_PATHS)",)

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
	@$(DEVCTL) desktop start

desktop-install:
	@$(DEVCTL) desktop install

desktop-stop:
	@$(DEVCTL) desktop stop

desktop-restart:
	@$(DEVCTL) desktop restart

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
