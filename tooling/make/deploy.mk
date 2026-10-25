# ─── Remote Deployment (pull model) ─────────────────────────────
# Remote hosts pull code and build locally. No binary transfer.
#
# Source modes (PT_DEPLOY_SOURCE in deploy envs):
#   central — Push to central bare repo on git server, remotes fetch from it (recommended)
#   local   — Remote fetches from local git daemon via SSH reverse tunnel (legacy)
#   github  — Remote fetches from GitHub origin
#
# Targets are two-dimensional: ENV is the environment, SRV (optional) is
# the service role. When SRV is set, the reviewed definition is
# peers-touch/**/deploy/$(ENV)-$(SRV).env.example; without SRV, ENV is the
# full legacy instance name.
#
# Usage:
#   make deploy ENV=corpstable SRV=xconfig
#   make deploy ENV=station-1                    # legacy flat instance name
#   make deploy ENV=station-1 BRANCH=feat/social
#   make deploy-status ENV=corpstable SRV=xconfig
#   make deploy-logs ENV=station-1
#   make setup-git-server   # One-time: init bare repo + daemon on central server
#   make git-serve          # Start local git server (for 'local' mode)
#   make git-serve-stop     # Stop local git server
#   make git-serve-status   # Check if running

.PHONY: deploy deploy-repair deploy-status deploy-logs setup-git-server git-serve git-serve-stop git-serve-status

DEPLOY_SCRIPTS := tooling/scripts/deploy

deploy:
	@if [ -z "$(ENV)" ]; then echo "Usage: make deploy ENV=<environment> SRV=<service> [BRANCH=main]"; exit 1; fi
	@SRV='$(SRV)' BRANCH=$(or $(BRANCH),main) /bin/bash $(DEPLOY_SCRIPTS)/deploy.sh $(ENV)

deploy-repair:
	@if [ -z "$(ENV)" ]; then echo "Usage: make deploy-repair ENV=<environment> SRV=<service>"; exit 1; fi
	@SRV='$(SRV)' /bin/bash $(DEPLOY_SCRIPTS)/deploy.sh repair $(ENV)

deploy-status:
	@if [ -z "$(ENV)" ]; then echo "Usage: make deploy-status ENV=<environment> SRV=<service>"; exit 1; fi
	@SRV='$(SRV)' /bin/bash $(DEPLOY_SCRIPTS)/deploy.sh status $(ENV)

deploy-logs:
	@if [ -z "$(ENV)" ]; then echo "Usage: make deploy-logs ENV=<environment> SRV=<service>"; exit 1; fi
	@SRV='$(SRV)' /bin/bash $(DEPLOY_SCRIPTS)/deploy.sh logs $(ENV)

setup-git-server:
	@/bin/bash $(DEPLOY_SCRIPTS)/setup-git-server.sh

git-serve:
	@/bin/bash $(DEPLOY_SCRIPTS)/git-serve.sh start

git-serve-stop:
	@/bin/bash $(DEPLOY_SCRIPTS)/git-serve.sh stop

git-serve-status:
	@/bin/bash $(DEPLOY_SCRIPTS)/git-serve.sh status
