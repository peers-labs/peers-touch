SHELL := /bin/bash
export PATH := /usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$(PATH)
.DEFAULT_GOAL := help

# ─── Include split modules ───────────────────────────────────────
include tooling/make/local-dev.mk
include tooling/make/station-go.mk
include tooling/make/monorepo.mk
include tooling/make/proto.mk
include tooling/make/qa.mk
include tooling/make/review.mk
include tooling/make/acceptance.mk
include tooling/make/docker.mk
include tooling/make/deploy.mk
include tooling/make/setup.mk

# ─── Help ────────────────────────────────────────────────────────

.PHONY: help help-docker help-deploy

help:
	@echo ""
	@echo "Peers-Touch"
	@echo "==========="
	@echo ""
	@echo "Local Dev (worktree-isolated):"
	@echo "  make profile PROFILE=<name>    Activate a dev profile"
	@echo "  make profile-init PROFILE=<name> [SLOT=0]  Create a new profile"
	@echo "  make profiles                  List available profiles"
	@echo "  make config                    Show active profile config"
	@echo ""
	@echo "  make station                   Ready Station (local start / remote deploy)"
	@echo "  make station-check             Health-check Station only"
	@echo "  make station-status            Show Station deployment/runtime status"
	@echo "  make station-logs              Show Station logs"
	@echo "  make relay                     Ready Relay (remote deploy)"
	@echo "  make relay-check               Health-check Relay only"
	@echo "  make relay-status              Show Relay deployment/runtime status"
	@echo "  make relay-logs                Show Relay logs"
	@echo "  make desktop                   Start Desktop App"
	@echo "  make desktop-web               Start Desktop Web (browser)"
	@echo "  make mobile                    Start Mobile iOS Simulator"
	@echo ""
	@echo "  make status                    Show running services"
	@echo "  make stop                      Stop all services"
	@echo "  make restart                   Restart all services"
	@echo "  make station-restart           Restart Station only"
	@echo "  make relay-restart             Restart Relay only"
	@echo "  make desktop-restart           Restart Desktop only"
	@echo "  make mobile-restart            Restart Mobile only"
	@echo ""
	@echo "Checks:"
	@echo "  make check                     Go format check"
	@echo "  make vet                       Go vet"
	@echo "  make style                     Go style check"
	@echo "  make lint                      Go lint (golangci-lint)"
	@echo "  make test-unit                 Go unit tests"
	@echo "  make mono-check                pnpm workspace checks"
	@echo "  make mono-build                pnpm workspace build"
	@echo "  make model-gen                 Generate proto code"
	@echo "  make review REVIEW_RANGE=<range>  Run code review framework checks"
	@echo "  make review-submit REVIEW_BASE=<base>  Run submit-time review pipeline before PR/MR"
	@echo "  make quality-evidence REVIEW_RANGE=<range>  Aggregate review, knowledge, and acceptance evidence"
	@echo "  make acceptance-validate [DOMAIN=<name>]  Validate acceptance domain contracts"
	@echo "  make acceptance-plan ACCEPTANCE_RANGE=<range>  Plan impacted product acceptance gates"
	@echo "  make acceptance-run            Run planned acceptance gates"
	@echo "  make acceptance-run-ci         Run planned ci-structure and ci-cheap gates"
	@echo "  make acceptance-report         Render latest acceptance report"
	@echo ""
	@echo "More:"
	@echo "  make help-docker               Docker deployment commands"
	@echo "  make help-deploy               Remote deploy commands"
	@echo "  make init-dev                  Initialize dev environment"
	@echo ""

help-docker:
	@echo ""
	@echo "Docker Deployment"
	@echo "================="
	@echo "  make docker-station            Build & deploy Station"
	@echo "  make docker-relay              Build & deploy Relay"
	@echo "  make docker-all                Build & deploy all"
	@echo "  make docker-infra              Start PostgreSQL"
	@echo "  make docker-down               Stop all containers"
	@echo "  make docker-logs               Tail container logs"
	@echo "  make docker-ps                 Show running containers"
	@echo "  make docker-remotes            List Docker contexts"
	@echo ""
	@echo "  Add REMOTE=<context> for remote deployment."
	@echo ""

help-deploy:
	@echo ""
	@echo "Remote Deployment (pull model)"
	@echo "=============================="
	@echo "  make deploy ENV=<name>         Deploy to remote host"
	@echo "  make deploy ENV=<name> BRANCH=feat/x  Deploy specific branch"
	@echo "  make deploy-status ENV=<name>  Check remote status"
	@echo "  make deploy-logs ENV=<name>    Fetch remote logs"
	@echo ""
	@echo "  Env files: .local/deploy/envs/<name>.env"
	@echo "  Required vars: PT_DEPLOY_HOST, PT_DEPLOY_USER,"
	@echo "                 PT_DEPLOY_PATH, PT_DEPLOY_ROLE"
	@echo ""
