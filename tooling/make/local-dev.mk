# ─── Local Worktree Dev ──────────────────────────────────────────
# Profile-based, worktree-isolated development environment.

.PHONY: worktree-create worktree-creation-status env-register env-update env-unregister env-check env-status-all dev-observe workflow-snapshot workflow-doctor \
        profile profile-authorize profile-init profiles config \
        dev-start dev-update dev-status dev-status-all dev-check dev-heartbeat dev-release dev-close dev-close-status \
        dev-resources-prepare dev-resources-status dev-resource-record \
        dev-session-start dev-session-status dev-session-archive dev-transition dev-functional-result \
        active-work-sync active-work-status active-work-status-all active-work-close \
        completion-review-prepare completion-review-submit completion-review-status \
        plan-mount plan-mount-status plan-unmount plan-state-migrate plan-validate plan-approve-north-star plan-amend plan-status plan-current plan-next \
        plan-activate plan-advance plan-cancel plan-reopen \
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
PLAN_MOUNT_SCRIPT := tooling/scripts/plan/plan-mount.mjs
PLAN_STATE_MIGRATION_SCRIPT := tooling/scripts/plan/stable-plan-state-migration.mjs
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
DEV_RESOURCE_INPUT_ARG := $(or $(RESOURCE_INPUT),$(DEV_RESOURCE_INPUT))
DEV_RESOURCE_RESULT_ARG := $(or $(RESOURCE_RESULT),$(DEV_RESOURCE_RESULT))
DEV_EXPIRES_MINUTES_ARG := $(or $(EXPIRES_MINUTES),$(DEV_EXPIRES_MINUTES),480)
DEV_WORK_SCRIPT := $(LOCAL_DEV_SCRIPTS)/dev-work.mjs
DEV_CLOSE_SCRIPT := $(LOCAL_DEV_SCRIPTS)/development-close.mjs
DEV_SESSION_SCRIPT := $(LOCAL_DEV_SCRIPTS)/dev-session.mjs
ACTIVE_WORK_SCRIPT := $(LOCAL_DEV_SCRIPTS)/active-work.mjs
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

plan-mount:
	@if [ -z "$(PLAN)" ]; then echo "Usage: make plan-mount PLAN=<plan.md>"; exit 1; fi
	@node $(PLAN_MOUNT_SCRIPT) mount \
		--repo-root "$(CURDIR)" \
		--plan "$(PLAN)" \
		--owner "$(DEV_OWNER_ARG)"

plan-mount-status:
	@node $(PLAN_MOUNT_SCRIPT) status --repo-root "$(CURDIR)"

plan-unmount:
	@if [ -z "$(MOUNT)" ] || [ -z "$(REASON)" ]; then echo "Usage: make plan-unmount MOUNT=<mount-id> REASON=<completed|cancelled|owner-unmount> [WORKSPACE_ID=<id>] [ALLOW_UNFINISHED=true]"; exit 1; fi
	@node $(PLAN_MOUNT_SCRIPT) unmount \
		$(if $(WORKSPACE_ID),--workspace-id "$(WORKSPACE_ID)",--repo-root "$(CURDIR)") \
		--mount-id "$(MOUNT)" \
		--reason "$(REASON)" \
		--allow-unfinished "$(or $(ALLOW_UNFINISHED),false)" \
		--owner "$(DEV_OWNER_ARG)"

plan-state-migrate:
	@node $(PLAN_STATE_MIGRATION_SCRIPT)

plan-validate:
	@if [ -z "$(PLAN)" ]; then echo "Usage: make plan-validate PLAN=<package-plan.md>"; exit 1; fi
	@node $(PLANCTL_SCRIPT) validate --plan "$(PLAN)" --repo-root "$(CURDIR)"

plan-approve-north-star:
	@if [ -z "$(PLAN)" ] || [ -z "$(DECISION_REF)" ]; then echo "Usage: make plan-approve-north-star PLAN=<package-plan.md> DECISION_REF=<ref> [ACTOR=<id>]"; exit 1; fi
	@node $(PLANCTL_SCRIPT) approve-north-star \
		--plan "$(PLAN)" \
		--repo-root "$(CURDIR)" \
		--actor "$(or $(ACTOR),$(DEV_OWNER_ARG))" \
		--decision-ref "$(DECISION_REF)"

plan-amend:
	@if [ -z "$(PLAN)" ] || [ -z "$(REASON)" ] || [ -z "$(CHANGE)" ]; then echo "Usage: make plan-amend PLAN=<package-plan.md> REASON='<why>' CHANGE='<what changed>' [ACTOR=<id>] [APPROVAL=agent|owner] [DECISION_REF=<ref>]"; exit 1; fi
	@node $(PLANCTL_SCRIPT) amend \
		--plan "$(PLAN)" \
		--repo-root "$(CURDIR)" \
		--actor "$(or $(ACTOR),$(DEV_OWNER_ARG))" \
		--reason "$(REASON)" \
		--change "$(CHANGE)" \
		--approval "$(or $(APPROVAL),agent)" \
		$(if $(DECISION_REF),--decision-ref "$(DECISION_REF)",)

plan-status:
	@if [ -z "$(PLAN)" ]; then echo "Usage: make plan-status PLAN=<package-plan.md>"; exit 1; fi
	@node $(PLANCTL_SCRIPT) status --plan "$(PLAN)" --repo-root "$(CURDIR)"

plan-current:
	@if [ -z "$(PLAN)" ]; then echo "Usage: make plan-current PLAN=<package-plan.md>"; exit 1; fi
	@node $(PLANCTL_SCRIPT) current --plan "$(PLAN)" --repo-root "$(CURDIR)"

plan-next:
	@if [ -z "$(PLAN)" ]; then echo "Usage: make plan-next PLAN=<package-plan.md>"; exit 1; fi
	@node $(PLANCTL_SCRIPT) next --plan "$(PLAN)" --repo-root "$(CURDIR)"

plan-cancel:
	@if [ -z "$(PLAN)" ]; then echo "Usage: make plan-cancel PLAN=<package-plan.md>"; exit 1; fi
	@node $(PLANCTL_SCRIPT) cancel \
		--plan "$(PLAN)" \
		--repo-root "$(CURDIR)" \
		--owner "$(DEV_OWNER_ARG)"

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
		--owner "$(DEV_OWNER_ARG)" \
		$(if $(DEV_SESSION_ARG),--session "$(DEV_SESSION_ARG)",)

dev-close:
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ] || [ -z "$(MODE)" ] || [ -z "$(CLOSE_REASON)" ]; then \
		echo "Usage: make dev-close WORK_ITEM=<id> MODE=<tracked|standalone> CLOSE_REASON=<completed|cancelled|owner-abandon> [ENVIRONMENT_POLICY=<retain|unregister>] [MOUNT=<mount-id>] [WORKSPACE_ID=<id>]"; \
		exit 1; \
	fi
	@node $(DEV_CLOSE_SCRIPT) close \
		--work-item "$(DEV_WORK_ITEM_ARG)" \
		--mode "$(MODE)" \
		--reason "$(CLOSE_REASON)" \
		--environment-policy "$(or $(ENVIRONMENT_POLICY),retain)" \
		--owner "$(DEV_OWNER_ARG)" \
		$(if $(WORKSPACE_ID),--workspace-id "$(WORKSPACE_ID)",--repo-root "$(CURDIR)") \
		$(if $(MOUNT),--mount-id "$(MOUNT)",)

dev-close-status:
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ]; then echo "Usage: make dev-close-status WORK_ITEM=<id> [WORKSPACE_ID=<id>]"; exit 1; fi
	@node $(DEV_CLOSE_SCRIPT) status \
		--work-item "$(DEV_WORK_ITEM_ARG)" \
		$(if $(WORKSPACE_ID),--workspace-id "$(WORKSPACE_ID)",--repo-root "$(CURDIR)")

dev-resources-prepare:
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ] || [ -z "$(DEV_RESOURCE_INPUT_ARG)" ]; then echo "Usage: make dev-resources-prepare WORK_ITEM=<id> RESOURCE_INPUT=<json-file>"; exit 1; fi
	@node $(DEV_WORK_SCRIPT) prepare-resources \
		--work-item "$(DEV_WORK_ITEM_ARG)" \
		--resource-input "$(DEV_RESOURCE_INPUT_ARG)" \
		$(if $(DEV_SESSION_ARG),--session "$(DEV_SESSION_ARG)",)

dev-resources-status:
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ]; then echo "Usage: make dev-resources-status WORK_ITEM=<id>"; exit 1; fi
	@node $(DEV_WORK_SCRIPT) resource-status \
		--work-item "$(DEV_WORK_ITEM_ARG)"

dev-resource-record:
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ] || [ -z "$(DEV_RESOURCE_RESULT_ARG)" ]; then echo "Usage: make dev-resource-record WORK_ITEM=<id> RESOURCE_RESULT=<json-file>"; exit 1; fi
	@node $(DEV_WORK_SCRIPT) record-resource \
		--work-item "$(DEV_WORK_ITEM_ARG)" \
		--resource-result "$(DEV_RESOURCE_RESULT_ARG)" \
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

dev-session-archive:
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ] || [ -z "$(DEV_SESSION_ARG)" ]; then echo "Usage: make dev-session-archive WORK_ITEM=<id> SESSION=<session-id>"; exit 1; fi
	@node $(DEV_SESSION_SCRIPT) archive \
		--work-item "$(DEV_WORK_ITEM_ARG)" \
		--session "$(DEV_SESSION_ARG)"

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
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ]; then echo "Usage: make completion-review-prepare WORK_ITEM=<id> [SCOPE=<task|plan>] [NEXT=<ready-id>] [RECORDED_AT=<iso>] [EXHAUSTION_DECISION_REFS='<ref> ...'] [EXHAUSTION_EVIDENCE_REFS='<ref> ...']"; exit 1; fi
	@node $(COMPLETION_REVIEW_SCRIPT) prepare \
		--repo-root "$(CURDIR)" \
		--work-item "$(DEV_WORK_ITEM_ARG)" \
		$(if $(SCOPE),--scope "$(SCOPE)",) \
		$(if $(NEXT),--next "$(NEXT)",) \
		$(if $(RECORDED_AT),--recorded-at "$(RECORDED_AT)",) \
		$(foreach ref,$(EXHAUSTION_DECISION_REFS),--exhaustion-decision-ref "$(ref)") \
		$(foreach ref,$(EXHAUSTION_EVIDENCE_REFS),--exhaustion-evidence-ref "$(ref)")

completion-review-submit:
	@if [ -z "$(REVIEW)" ] || [ -z "$(VERDICT)" ] || [ -z "$(ASSESSMENT)" ] || [ -z "$(CAPABILITY)" ]; then echo "Usage: make completion-review-submit REVIEW=<id> VERDICT=<PASS|FAIL> ASSESSMENT=<json-file> CAPABILITY=<json-file> [NEXT=<ready-id>] [RECORDED_AT=<iso>] [EXHAUSTION_DECISION_REFS='<ref> ...'] [EXHAUSTION_EVIDENCE_REFS='<ref> ...']"; exit 1; fi
	@node $(COMPLETION_REVIEW_SCRIPT) submit \
		--repo-root "$(CURDIR)" \
		--review "$(REVIEW)" \
		--verdict "$(VERDICT)" \
		--assessment "$(ASSESSMENT)" \
		--capability "$(CAPABILITY)" \
		$(if $(NEXT),--next "$(NEXT)",) \
		$(if $(RECORDED_AT),--recorded-at "$(RECORDED_AT)",) \
		$(foreach ref,$(EXHAUSTION_DECISION_REFS),--exhaustion-decision-ref "$(ref)") \
		$(foreach ref,$(EXHAUSTION_EVIDENCE_REFS),--exhaustion-evidence-ref "$(ref)")

completion-review-status:
	@if [ -z "$(DEV_WORK_ITEM_ARG)" ]; then echo "Usage: make completion-review-status WORK_ITEM=<id> [NEXT=<ready-id>] [RECORDED_AT=<iso>] [EXHAUSTION_DECISION_REFS='<ref> ...'] [EXHAUSTION_EVIDENCE_REFS='<ref> ...']"; exit 1; fi
	@node $(COMPLETION_REVIEW_SCRIPT) status \
		--repo-root "$(CURDIR)" \
		--work-item "$(DEV_WORK_ITEM_ARG)" \
		$(if $(NEXT),--next "$(NEXT)",) \
		$(if $(RECORDED_AT),--recorded-at "$(RECORDED_AT)",) \
		$(foreach ref,$(EXHAUSTION_DECISION_REFS),--exhaustion-decision-ref "$(ref)") \
		$(foreach ref,$(EXHAUSTION_EVIDENCE_REFS),--exhaustion-evidence-ref "$(ref)")

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
