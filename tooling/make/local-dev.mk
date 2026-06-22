# ─── Local Worktree Dev ──────────────────────────────────────────
# Profile-based, worktree-isolated development environment.

.PHONY: profile profile-init profiles config \
        station station-check station-status station-logs station-stop station-restart \
        relay relay-check relay-status relay-logs relay-stop relay-restart \
        desktop desktop-stop desktop-restart \
        desktop-web desktop-web-stop desktop-web-restart \
        mobile mobile-stop mobile-restart \
        status stop restart

LOCAL_DEV_SCRIPTS := tooling/scripts/local-dev
PROFILE_ARG := $(or $(PROFILE),$(word 2,$(MAKECMDGOALS)))
SLOT_ARG := $(or $(SLOT),0)

profile:
	@if [ -z "$(PROFILE_ARG)" ]; then echo "Usage: make profile <name>  or  make profile PROFILE=<name>"; exit 1; fi
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/profile.sh activate $(PROFILE_ARG)

profile-init:
	@if [ -z "$(PROFILE_ARG)" ]; then echo "Usage: make profile-init <name> [SLOT=0]  or  make profile-init PROFILE=<name> [SLOT=0]"; exit 1; fi
	@SLOT=$(SLOT_ARG) /bin/bash $(LOCAL_DEV_SCRIPTS)/profile.sh init $(PROFILE_ARG)

profiles:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/profile.sh list

config:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/config.sh

station:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/station-dev.sh

station-check:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/station-check.sh

station-status:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/station-status.sh

station-logs:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/station-logs.sh

station-stop:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/stop.sh station

station-restart:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/restart.sh station

relay:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/relay-dev.sh

relay-check:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/relay-check.sh

relay-status:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/relay-status.sh

relay-logs:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/relay-logs.sh

relay-stop:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/stop.sh relay

relay-restart:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/restart.sh relay

desktop:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/desktop-dev.sh app

desktop-stop:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/stop.sh desktop

desktop-restart:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/restart.sh desktop

desktop-web:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/desktop-dev.sh web

desktop-web-stop:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/stop.sh desktop

desktop-web-restart:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/restart.sh desktop-web

mobile:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/mobile-ios-sim.sh

mobile-stop:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/stop.sh mobile

mobile-restart:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/restart.sh mobile

status:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/status.sh

stop:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/stop.sh all

restart:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/restart.sh all

.DEFAULT:
	@if [[ "$(firstword $(MAKECMDGOALS))" == "profile" || "$(firstword $(MAKECMDGOALS))" == "profile-init" ]]; then \
		:; \
	else \
		echo "make: *** No rule to make target '$@'."; \
		exit 2; \
	fi
