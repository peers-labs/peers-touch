# ─── Remote Deployment (pull model) ─────────────────────────────
# Remote hosts pull code and build locally. No binary transfer.
# Default: remote fetches from local git daemon (LAN).
# Fallback: GitHub origin if local unreachable.
#
# Usage:
#   make deploy ENV=station-a
#   make deploy ENV=station-a BRANCH=feat/social
#   make deploy-status ENV=station-a
#   make deploy-logs ENV=station-a
#   make git-serve          # Start local git server
#   make git-serve-stop     # Stop local git server
#   make git-serve-status   # Check if running

.PHONY: deploy deploy-status deploy-logs git-serve git-serve-stop git-serve-status

DEPLOY_SCRIPTS := tooling/scripts/deploy

deploy:
	@if [ -z "$(ENV)" ]; then echo "Usage: make deploy ENV=<name> [BRANCH=main]"; exit 1; fi
	@BRANCH=$(or $(BRANCH),main) /bin/bash $(DEPLOY_SCRIPTS)/deploy.sh $(ENV)

deploy-status:
	@if [ -z "$(ENV)" ]; then echo "Usage: make deploy-status ENV=<name>"; exit 1; fi
	@/bin/bash $(DEPLOY_SCRIPTS)/deploy.sh status $(ENV)

deploy-logs:
	@if [ -z "$(ENV)" ]; then echo "Usage: make deploy-logs ENV=<name>"; exit 1; fi
	@/bin/bash $(DEPLOY_SCRIPTS)/deploy.sh logs $(ENV)

git-serve:
	@/bin/bash $(DEPLOY_SCRIPTS)/git-serve.sh start

git-serve-stop:
	@/bin/bash $(DEPLOY_SCRIPTS)/git-serve.sh stop

git-serve-status:
	@/bin/bash $(DEPLOY_SCRIPTS)/git-serve.sh status
