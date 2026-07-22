# ─── Docker Deployment ───────────────────────────────────────────

.PHONY: docker-station docker-relay docker-all docker-infra docker-up docker-down docker-logs docker-ps docker-remotes docker-warm-cache docker-warm-cache-local

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

docker-warm-cache:
	@tooling/docker/warm-builder-cache.sh

docker-warm-cache-local:
	docker build -f tooling/docker/builder-base.Dockerfile -t peers-station-builder:go1.24.6 .

docker-station:
	$(COMPOSE) --profile infra --profile station up -d --build

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
