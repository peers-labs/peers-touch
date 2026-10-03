# ─── Dev Environment Setup ──────────────────────────────────────

.PHONY: init-dev skill-help cargo-cache-setup cargo-cache-status cargo-cache-verify

init-dev:
	@echo "=== Peers-Touch Dev Environment Setup ==="
	@echo ""
	@echo "[1/4] Installing dependencies..."
	pnpm install
	@echo ""
	@echo "[2/4] Setting up shared Cargo compiler cache..."
	@/bin/bash tooling/scripts/cargo-cache.sh setup
	@echo ""
	@echo "[3/4] Setting up IDE config..."
	/bin/bash tooling/scripts/ide-setup.sh $(IDE)
	@echo ""
	@echo "[4/4] Installing conversation-bound agent integration..."
	@detect_ide() { \
	  if echo "$${TERM_PRODUCT:-}" | grep -qi trae; then echo trae; return; fi; \
	  if [ -n "$${TRAE_BRAND_NAME:-}" ]; then echo trae; return; fi; \
	  if echo "$${VSCODE_EXTENSIONS_PATH:-}" | grep -q trae; then echo trae; return; fi; \
	  if [ -n "$${CURSOR_TRACE_ID:-}" ]; then echo cursor; return; fi; \
	  if echo "$${TERM_PRODUCT:-}" | grep -qi cursor; then echo cursor; return; fi; \
	  if echo "$${VSCODE_EXTENSIONS_PATH:-}" | grep -q cursor; then echo cursor; return; fi; \
	  if echo "$${TERM_PRODUCT:-}" | grep -qi codex; then echo codex; return; fi; \
	  if [ -n "$${CODEX_HOME:-}" ]; then echo codex; return; fi; \
	}; \
	IDE_NAME="$${IDE:-$$(detect_ide)}"; \
	if [ -z "$$IDE_NAME" ]; then echo "  Error: cannot detect host. Use: make init-dev IDE=trae|cursor|codex"; exit 1; fi; \
	$(MAKE) --no-print-directory skills IDE="$$IDE_NAME"
	@echo ""
	@echo "=== Done! Run 'make help' to see available commands. ==="

skill-help:
	@echo ""
	@echo "Skills and host hooks are installed with 'make skills IDE=<host>'."
	@echo "User overlays: make skill-overlay-install SOURCE=<directory>."
	@echo "See AGENTS.md §13 for details."
	@echo ""

cargo-cache-setup:
	@/bin/bash tooling/scripts/cargo-cache.sh setup

cargo-cache-status:
	@/bin/bash tooling/scripts/cargo-cache.sh status

cargo-cache-verify:
	@/bin/bash tooling/scripts/cargo-cache.sh verify

# ─── Skills And Workflow Hooks ───────────────────────────────────
.PHONY: skills

skills:
	@echo ""
	@echo "Install conversation-bound agent integration"
	@echo "========================================"
	@echo ""
	@IDE_NAME="$(IDE)"; \
	if [ -z "$$IDE_NAME" ]; then \
	  if [ ! -t 0 ]; then echo "IDE is required for non-interactive install: make skills IDE=trae|cursor|codex"; exit 1; fi; \
	  echo "Select target IDE:"; \
	  echo "  1) trae"; echo "  2) cursor"; echo "  3) codex"; echo ""; \
	  read -p "Enter choice [1-3]: " choice; \
	  case "$$choice" in 1) IDE_NAME=trae ;; 2) IDE_NAME=cursor ;; 3) IDE_NAME=codex ;; *) echo "Invalid choice. Aborted."; exit 1 ;; esac; \
	fi; \
	case "$$IDE_NAME" in trae|cursor|codex) ;; *) echo "Invalid IDE: $$IDE_NAME"; exit 1 ;; esac; \
	/bin/bash tooling/scripts/install-agent-integration.sh \
		--host "$$IDE_NAME" \
		--root "$(CURDIR)" \
		$(if $(WORKSPACE),--workspace "$(WORKSPACE)",)

.PHONY: agent-integration-audit agent-integration-audit-all
.PHONY: skill-overlay-install skill-overlay-list skill-overlay-enable
.PHONY: skill-overlay-disable skill-overlay-uninstall skill-overlay-resolve

agent-integration-audit:
	@python3 tooling/scripts/agent-integration-audit.py \
		--root "$(or $(ROOT),$(CURDIR))" \
		$(if $(IDE),--host "$(IDE)",)

agent-integration-audit-all:
	@python3 tooling/scripts/agent-integration-audit.py \
		--root "$(CURDIR)" \
		--all-worktrees \
		$(if $(IDE),--host "$(IDE)",)

skill-overlay-install:
	@if [ -z "$(SOURCE)" ]; then echo "Usage: make skill-overlay-install SOURCE=<local-skill-directory> [REPLACE=1]"; exit 1; fi
	@python3 tooling/scripts/skill-overlay-control.py install \
		--source "$(SOURCE)" \
		$(if $(filter 1 true yes,$(REPLACE)),--replace,)

skill-overlay-list:
	@python3 tooling/scripts/skill-overlay-control.py list

skill-overlay-enable:
	@if [ -z "$(OVERLAY)" ]; then echo "Usage: make skill-overlay-enable OVERLAY=<name>"; exit 1; fi
	@python3 tooling/scripts/skill-overlay-control.py enable "$(OVERLAY)"

skill-overlay-disable:
	@if [ -z "$(OVERLAY)" ]; then echo "Usage: make skill-overlay-disable OVERLAY=<name>"; exit 1; fi
	@python3 tooling/scripts/skill-overlay-control.py disable "$(OVERLAY)"

skill-overlay-uninstall:
	@if [ -z "$(OVERLAY)" ]; then echo "Usage: make skill-overlay-uninstall OVERLAY=<name>"; exit 1; fi
	@python3 tooling/scripts/skill-overlay-control.py uninstall "$(OVERLAY)"

skill-overlay-resolve:
	@python3 tooling/scripts/skill-overlay-control.py resolve \
		--target "$(or $(TARGET),pt-ew)"
