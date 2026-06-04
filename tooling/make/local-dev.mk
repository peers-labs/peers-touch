# ─── Local Worktree Dev ──────────────────────────────────────────
# Profile-based, worktree-isolated development environment.

.PHONY: profile profile-init profiles config \
        station station-stop station-restart \
        desktop desktop-stop desktop-restart \
        desktop-web desktop-web-stop desktop-web-restart \
        mobile mobile-stop mobile-restart \
        status stop restart

LOCAL_DEV_SCRIPTS := tooling/scripts/local-dev

profile:
	@if [ -z "$(PROFILE)" ]; then echo "Usage: make profile PROFILE=<name>"; exit 1; fi
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/profile.sh activate $(PROFILE)

profile-init:
	@if [ -z "$(PROFILE)" ]; then echo "Usage: make profile-init PROFILE=<name> [SLOT=0]"; exit 1; fi
	@SLOT=$(or $(SLOT),0) /bin/bash $(LOCAL_DEV_SCRIPTS)/profile.sh init $(PROFILE)

profiles:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/profile.sh list

config:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/config.sh

station:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/station-dev.sh

station-stop:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/stop.sh station

station-restart:
	@/bin/bash $(LOCAL_DEV_SCRIPTS)/restart.sh station

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
