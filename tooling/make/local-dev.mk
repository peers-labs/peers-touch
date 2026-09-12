# ─── Local Worktree Dev ──────────────────────────────────────────
# Profile-based, worktree-isolated development environment.

.PHONY: profile profile-init profiles config \
        station station-check station-status station-logs station-stop station-restart \
        relay relay-check relay-status relay-logs relay-stop relay-restart \
        desktop desktop-stop desktop-restart \
        desktop-web desktop-web-stop desktop-web-restart \
        mobile mobile-stop mobile-restart \
        status stop restart

DEVCTL := node tooling/devctl/index.mjs
LOCAL_DEV_SCRIPTS := tooling/scripts/local-dev
PROFILE_ARG := $(or $(PROFILE),$(word 2,$(MAKECMDGOALS)))
SLOT_ARG := $(or $(SLOT),0)

profile:
	@$(DEVCTL) profile activate $(PROFILE_ARG)

profile-init:
	@$(DEVCTL) profile init $(PROFILE_ARG) --slot $(SLOT_ARG)

profiles:
	@$(DEVCTL) profile list

config:
	@$(DEVCTL) config

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
	@if [[ "$(firstword $(MAKECMDGOALS))" == "profile" || "$(firstword $(MAKECMDGOALS))" == "profile-init" || "$(firstword $(MAKECMDGOALS))" == "run-prototype" ]]; then \
		:; \
	else \
		echo "make: *** No rule to make target '$@'."; \
		exit 2; \
	fi
