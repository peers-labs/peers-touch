.PHONY: help fmt import vet check format style lint \
       mono-check mono-lint mono-test mono-build \
       model-gen model-lint \
       test test-docker test-docker-keep test-docker-logs test-api test-unit test-coverage clean-test \
       init-dev skill-help \
       dev-web dev-app dev-dual \
       docker-station docker-relay docker-all docker-infra docker-up docker-down docker-logs docker-ps docker-remotes \
       pt-up pt-down pt-status pt-desktop pt-bootstrap pt-discover-relay pt-relay-issue-invites \
       testnet-deploy testnet-deploy-relay testnet-deploy-station testnet-status testnet-down testnet-clean testnet-desktop

# ─── Help ────────────────────────────────────────────────────

help:
	@echo ""
	@echo "Peers-Touch Makefile"
	@echo "==================="
	@echo ""
	@echo "Setup:"
	@echo "  init-dev          Initialize dev environment (deps + hooks + IDE skills)"
	@echo "  skill-help        Show AI skill catalog and usage guide"
	@echo ""
	@echo "Go (Station):"
	@echo "  fmt               Format Go code (go fmt + gofmt -s)"
	@echo "  import            Organize imports (goimports)"
	@echo "  vet               Run go vet"
	@echo "  check             Verify gofmt compliance (CI-safe)"
	@echo "  format            fmt + import combined"
	@echo "  style             Run check-go-style.sh"
	@echo "  lint              Run golangci-lint"
	@echo ""
	@echo "Monorepo (pnpm):"
	@echo "  mono-check        pnpm -r run check"
	@echo "  mono-lint         pnpm -r run lint"
	@echo "  mono-test         pnpm -r run test"
	@echo "  mono-build        pnpm -r run build"
	@echo ""
	@echo "Proto / Model:"
	@echo "  model-gen         Generate proto code (buf generate)"
	@echo "  model-lint        Lint proto files (buf lint)"
	@echo ""
	@echo "Testing:"
	@echo "  test              Run tests (alias for test-docker)"
	@echo "  test-docker       Docker isolated tests"
	@echo "  test-docker-keep  Docker tests, keep containers"
	@echo "  test-docker-logs  Docker tests, show logs"
	@echo "  test-api          API integration tests (service must be running)"
	@echo "  test-unit         Go unit tests with verbose output"
	@echo "  test-coverage     Generate HTML coverage report"
	@echo "  clean-test        Tear down test containers and remove coverage files"
	@echo ""
	@echo "Desktop Dev:"
	@echo "  dev-web           Start Desktop Web dev (browser mode)"
	@echo "  dev-app           Start Desktop App dev (Tauri mode)"
	@echo "  dev-dual          Start both App + Web (two clients, one Station)"
	@echo "                    Add REMOTE=dev-box to use remote Station"
	@echo "                    Add RESTART=1 to force-restart Rust BFF"
	@echo ""
	@echo "Docker:"
	@echo "  docker-station    Build & deploy Station container"
	@echo "  docker-relay      Build & deploy Relay container"
	@echo "  docker-all        Build & deploy Station + Relay"
	@echo "  docker-infra      Start PostgreSQL"
	@echo "  docker-down       Stop all containers"
	@echo "  docker-logs       Tail container logs"
	@echo "  docker-ps         Show running containers"
	@echo "  docker-remotes    List available Docker contexts"
	@echo "                    Add REMOTE=dev-box to deploy remotely"
	@echo ""
	@echo "Test Environments (pt-*):"
	@echo "  pt-bootstrap          Register the four docker contexts (one-time)"
	@echo "  pt-up      ENV=<env>  Build + deploy a single env (or ENV=all)"
	@echo "  pt-down    ENV=<env>  Tear down — host returns to neutral state"
	@echo "  pt-status             Health check across all five envs"
	@echo "  pt-desktop ENV=<env>  Launch the Desktop client paired with <env>"
	@echo "  pt-discover-relay     After Relay is up: write its multiaddr into"
	@echo "                        each Station's PEERS_BOOTSTRAP_NODES (libp2p"
	@echo "                        seed). Run once before \`pt-up ENV=all\`."
	@echo "  pt-relay-issue-invites  After Relay is up: mint admin invite tokens"
	@echo "                          and write RELAY_CLIENT_* into each Station's"
	@echo "                          .env so the relay-client subserver can mount."
	@echo "                        envs: pt-relay / pt-station-1 / pt-station-2 /"
	@echo "                              pt-station-relay-only / pt-station-local"
	@echo ""

# ─── Go tooling ──────────────────────────────────────────────

fmt:
	cd apps/station/app && go fmt ./...
	cd apps/station/app && gofmt -s -w .

import:
	@command -v goimports >/dev/null 2>&1 || go install golang.org/x/tools/cmd/goimports@latest
	cd apps/station/app && goimports -w .

vet:
	cd apps/station/app && go vet ./...

check:
	@out=$$(cd apps/station/app && gofmt -l .); if [ -n "$$out" ]; then echo "$$out" && exit 1; fi

style:
	bash tooling/scripts/check-go-style.sh

format: fmt import

lint:
	@command -v golangci-lint >/dev/null 2>&1 || go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
	cd apps/station/app && golangci-lint run

# ─── Monorepo (pnpm) ────────────────────────────────────────

mono-check:
	pnpm -r --if-present run check

mono-lint:
	pnpm -r --if-present run lint

mono-test:
	pnpm -r --if-present run test

mono-build:
	pnpm -r --if-present run build

# ─── Proto / Model ──────────────────────────────────────────

model-gen:
	cd packages/model && buf generate

model-lint:
	cd packages/model && buf lint

# ─── Testing ────────────────────────────────────────────────

test: test-docker

test-docker:
	@echo "Running Docker isolated tests..."
	bash qa/station/run_docker_tests.sh

test-docker-keep:
	@echo "Running Docker tests (keep containers)..."
	bash qa/station/run_docker_tests.sh --keep

test-docker-logs:
	@echo "Running Docker tests (show logs)..."
	bash qa/station/run_docker_tests.sh --logs

test-api:
	@echo "Running API tests (service must be running)..."
	bash qa/station/api_tests/integration_test.sh

test-unit:
	@echo "Running unit tests..."
	cd apps/station/app && go test ./... -v

test-coverage:
	@echo "Generating test coverage report..."
	cd apps/station/app && go test ./... -coverprofile=coverage.out
	cd apps/station/app && go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report: apps/station/app/coverage.html"

clean-test:
	@echo "Cleaning test environment..."
	cd qa/station && docker-compose -f docker-compose.test.yml down -v
	rm -f apps/station/app/coverage.out apps/station/app/coverage.html
	@echo "Done."

# ─── Dev Environment Setup ──────────────────────────────────

# Initialize dev environment: install deps, husky hooks, and link skills to IDE config dirs.
# Auto-detects IDE from terminal env vars. Override with: make init-dev IDE=cursor
init-dev:
	@echo "=== Peers-Touch Dev Environment Setup ==="
	@echo ""
	@echo "[1/3] Installing dependencies..."
	pnpm install
	@echo ""
	@echo "[2/3] Setting up IDE config..."
	bash tooling/scripts/ide-setup.sh $(IDE)
	@echo ""
	@echo "[3/3] Linking skills to IDE config..."
	@detect_ide() { \
	  if echo "$${TERM_PRODUCT:-}" | grep -qi trae; then echo trae; return; fi; \
	  if [ -n "$${TRAE_BRAND_NAME:-}" ]; then echo trae; return; fi; \
	  if echo "$${VSCODE_EXTENSIONS_PATH:-}" | grep -q trae; then echo trae; return; fi; \
	  if [ -n "$${CURSOR_TRACE_ID:-}" ]; then echo cursor; return; fi; \
	  if echo "$${TERM_PRODUCT:-}" | grep -qi cursor; then echo cursor; return; fi; \
	  if echo "$${VSCODE_EXTENSIONS_PATH:-}" | grep -q cursor; then echo cursor; return; fi; \
	}; \
	IDE_NAME="$${IDE:-$$(detect_ide)}"; \
	if [ -z "$$IDE_NAME" ]; then echo "  Error: cannot detect IDE. Use: make init-dev IDE=trae"; exit 1; fi; \
	SKILLS_SRC="$$(pwd)/tooling/skills"; \
	IDE_DIR="$$(pwd)/.$$IDE_NAME"; \
	mkdir -p "$$IDE_DIR"; \
	if [ -L "$$IDE_DIR/skills" ]; then rm "$$IDE_DIR/skills"; fi; \
	ln -s "$$SKILLS_SRC" "$$IDE_DIR/skills"; \
	echo "  Linked: .$$IDE_NAME/skills -> tooling/skills"
	@echo ""
	@echo "=== Done! Run 'make skill-help' to see available skills. ==="

# Show available skills and usage instructions.
skill-help:
	@echo ""
	@echo "=== Peers-Touch Development Skills ==="
	@echo ""
	@echo "These skills are available in your IDE (Trae / Cursor) to guide AI agents"
	@echo "through standardized development workflows."
	@echo ""
	@echo "┌─────────────────────┬──────────────────────────────────────────────────┐"
	@echo "│ Skill               │ Description                                      │"
	@echo "├─────────────────────┼──────────────────────────────────────────────────┤"
	@echo "│ github-commit       │ Standardized commit messages (Conventional       │"
	@echo "│                     │ Commits + AI traceability)                        │"
	@echo "├─────────────────────┼──────────────────────────────────────────────────┤"
	@echo "│ github-pr           │ PR creation with bilingual (EN/CN) templates,    │"
	@echo "│                     │ auto-labeling, and issue linking via gh CLI       │"
	@echo "├─────────────────────┼──────────────────────────────────────────────────┤"
	@echo "│ github-review       │ Structured code review with severity levels      │"
	@echo "│                     │ and project convention checks (AGENTS.md)         │"
	@echo "├─────────────────────┼──────────────────────────────────────────────────┤"
	@echo "│ github-release      │ Semantic versioning, auto-changelog from          │"
	@echo "│                     │ commits, and GitHub Release creation              │"
	@echo "├─────────────────────┼──────────────────────────────────────────────────┤"
	@echo "│ dev-workflow         │ Full dev lifecycle: planning -> coding ->         │"
	@echo "│                     │ review -> release -> completion                   │"
	@echo "└─────────────────────┴──────────────────────────────────────────────────┘"
	@echo ""
	@echo "HOW IT WORKS:"
	@echo ""
	@echo "  1. Run 'make init-dev' (auto-detects IDE, or override: make init-dev IDE=cursor)"
	@echo "  2. Skills are symlinked into your IDE config dir (.<ide>/skills/)"
	@echo "  3. AI agents auto-detect and use them based on your requests"
	@echo ""
	@echo "EXAMPLES:"
	@echo ""
	@echo "  Ask your AI agent:                    Triggered skill:"
	@echo "  \"commit these changes\"                github-commit"
	@echo "  \"create a PR for this branch\"         github-pr"
	@echo "  \"review PR #42\"                       github-review"
	@echo "  \"create a release\"                    github-release"
	@echo "  \"start working on issue #15\"          dev-workflow"
	@echo ""
	@echo "ENFORCEMENT:"
	@echo ""
	@echo "  - Commit messages are validated by commitlint (husky hook)"
	@echo "  - PR titles are validated by GitHub Actions (pr-check.yml)"
	@echo "  - PR descriptions must follow the bilingual template"
	@echo "  - Releases auto-generate bilingual changelogs"
	@echo ""
	@echo "FILES:"
	@echo ""
	@echo "  tooling/skills/          Source of truth for all skills"
	@echo "  commitlint.config.js     Conventional Commits rules"
	@echo "  .husky/commit-msg        Git hook for commit validation"
	@echo "  .github/workflows/       CI checks (pr-check + release)"
	@echo "  .github/PULL_REQUEST_TEMPLATE.md  Bilingual PR template"
	@echo ""

# ─── Desktop Dev ─────────────────────────────────────────────
# Usage:
#   make dev-web                   Local station
#   make dev-web REMOTE=dev-box    Remote station (reads .env.dev-box)
#   make dev-app REMOTE=dev-box    Same, but Tauri app mode

# Resolve env file and PEERS_STATION_URL from REMOTE
ifdef REMOTE
  _DEV_ENV_FILE := $(shell if [ -f tooling/docker/.env.$(REMOTE) ]; then echo tooling/docker/.env.$(REMOTE); else echo tooling/docker/.env; fi)
  _STATION_HOST := $(shell grep -E '^STATION_HOST=' $(_DEV_ENV_FILE) 2>/dev/null | cut -d= -f2-)
  _STATION_PORT := $(shell grep -E '^STATION_PORT=' $(_DEV_ENV_FILE) 2>/dev/null | cut -d= -f2-)
  _STATION_URL  := http://$(_STATION_HOST):$(or $(_STATION_PORT),18080)
  _DEV_ENV      := PEERS_STATION_URL=$(_STATION_URL)
else
  _DEV_ENV :=
endif

dev-web:
ifdef REMOTE
	@echo "[dev-web] Station → $(_STATION_URL)"
endif
	$(_DEV_ENV) RESTART=$(RESTART) ./tooling/scripts/dev-desktop-web.sh

dev-app:
ifdef REMOTE
	@echo "[dev-app] Station → $(_STATION_URL)"
endif
	$(_DEV_ENV) RESTART=$(RESTART) ./tooling/scripts/dev-desktop-app.sh

dev-dual:
ifdef REMOTE
	@echo "[dev-dual] Station → $(_STATION_URL)"
endif
	$(_DEV_ENV) RESTART=$(RESTART) ./tooling/scripts/dev-desktop-dual.sh

# ─── Docker Deployment ───────────────────────────────────────
# Usage:
#   make docker-station                  Local Docker
#   make docker-station REMOTE=dev-box   Remote Docker (reads .env.dev-box)

COMPOSE_FILE := tooling/docker/compose.yml
DOCKER_CMD   := docker

ifdef REMOTE
  DOCKER_REMOTE_CFG := $(shell \
    d=/tmp/docker-remote-cfg; \
    mkdir -p "$$d"; \
    cp -r ~/.docker/contexts "$$d/" 2>/dev/null; \
    echo '{"auths":{}}' > "$$d/config.json"; \
    echo "$$d")
  DOCKER_CMD := DOCKER_CONFIG=$(DOCKER_REMOTE_CFG) docker --context $(REMOTE)
endif

ifdef REMOTE
  ENV_FILE := $(shell if [ -f tooling/docker/.env.$(REMOTE) ]; then echo tooling/docker/.env.$(REMOTE); else echo tooling/docker/.env; fi)
else
  ENV_FILE := tooling/docker/.env
endif

COMPOSE := $(DOCKER_CMD) compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE)

docker-station:
	$(COMPOSE) --profile station up -d --build

docker-relay:
	$(COMPOSE) --profile relay up -d --build

docker-all:
	$(COMPOSE) --profile station --profile relay up -d --build

docker-infra:
	$(COMPOSE) --profile infra up -d

docker-up: docker-all

docker-down:
	$(COMPOSE) --profile station --profile relay --profile infra down

docker-logs:
	$(COMPOSE) --profile station --profile relay logs -f --tail=100

docker-ps:
	$(COMPOSE) --profile station --profile relay --profile infra ps

docker-remotes:
	@echo "Available Docker contexts:"
	@docker context ls --format "table {{.Name}}\t{{.DockerEndpoint}}\t{{.Current}}"

# ─── Test Environment lifecycle (pt-*) ───────────────────────
# All routing (env → docker context → profile → env file → health URL)
# lives in tooling/scripts/pt-deploy.sh. The Makefile is the thin facade.
#
# Usage:
#   make pt-bootstrap                           one-time docker context setup
#   make pt-up      ENV=pt-station-1            deploy a single env
#   make pt-up      ENV=all                     deploy all five envs
#   make pt-down    ENV=pt-station-1            tear down a single env
#   make pt-status                              health roll-up
#   make pt-desktop ENV=pt-station-1            launch paired Desktop client
#   make pt-discover-relay                      one-time libp2p seed wiring
#                                              (see .localenv §Federation)

pt-bootstrap:
	bash tooling/scripts/pt-bootstrap.sh

pt-up:
	@if [ -z "$(ENV)" ]; then echo "Usage: make pt-up ENV=<env|all>"; exit 1; fi
	bash tooling/scripts/pt-deploy.sh up $(ENV)

pt-down:
	@if [ -z "$(ENV)" ]; then echo "Usage: make pt-down ENV=<env|all>"; exit 1; fi
	bash tooling/scripts/pt-deploy.sh down $(ENV)

pt-status:
	bash tooling/scripts/pt-deploy.sh status

pt-desktop:
	@if [ -z "$(ENV)" ]; then echo "Usage: make pt-desktop ENV=<env>"; exit 1; fi
	bash tooling/scripts/pt-deploy.sh desktop $(ENV)

pt-discover-relay:
	bash tooling/scripts/pt-discover-relay.sh

pt-relay-issue-invites:
	bash tooling/scripts/pt-relay-issue-invites.sh

# ─── Testnet (3-node federated) ────────────────────────────────
#   make testnet-deploy            Deploy all (relay + station) to 3 nodes
#   make testnet-deploy-relay      Deploy only relays
#   make testnet-deploy-station    Deploy only stations
#   make testnet-status            Health check all nodes
#   make testnet-down              Tear down all nodes
#   make testnet-desktop           Launch Desktop a + b + c
#   make testnet-desktop NODES=a   Launch only Desktop a
#   make testnet-desktop NODES="a b" Launch Desktop a and b

NODES ?= a b c

testnet-deploy:
	bash tooling/docker/deploy-testnet.sh all

testnet-deploy-relay:
	bash tooling/docker/deploy-testnet.sh relay

testnet-deploy-station:
	bash tooling/docker/deploy-testnet.sh station

testnet-status:
	bash tooling/docker/deploy-testnet.sh status

testnet-down:
	bash tooling/docker/deploy-testnet.sh down

testnet-clean:
	bash tooling/docker/deploy-testnet.sh clean

testnet-desktop:
	bash tooling/scripts/dev-testnet-desktops.sh $(NODES)
