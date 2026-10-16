# ─── Dev Environment Setup ──────────────────────────────────────

.PHONY: init-dev skill-help cargo-cache-setup cargo-cache-status cargo-cache-verify

cargo-cache-setup:
	@/bin/bash tooling/scripts/cargo-cache.sh setup

cargo-cache-status:
	@/bin/bash tooling/scripts/cargo-cache.sh status

cargo-cache-verify:
	@/bin/bash tooling/scripts/cargo-cache.sh verify

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
	@echo "[4/4] Installing project Skills and optional advisory Hook..."
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
	@echo "Project Skills and the optional advisory Hook are installed with 'make skills IDE=<host>'."
	@echo "Remove only the project Hook with 'make skills-remove-hook IDE=<host>'."
	@echo "User overlays: make skill-overlay-install SOURCE=<directory>."
	@echo "See AGENTS.md §13 for details."
	@echo ""

# ─── Skills And Advisory Hooks ───────────────────────────────────
.PHONY: skills skills-remove-hook

skills:
	@echo ""
	@echo "Install project Skills and optional advisory Hook"
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
		--action install \
		--host "$$IDE_NAME" \
		--root "$(CURDIR)" \
		$(if $(WORKSPACE),--workspace "$(WORKSPACE)",)

skills-remove-hook:
	@if [ -z "$(IDE)" ]; then echo "IDE is required: make skills-remove-hook IDE=trae|cursor|codex"; exit 1; fi
	@case "$(IDE)" in trae|cursor|codex) ;; *) echo "Invalid IDE: $(IDE)"; exit 1 ;; esac
	@/bin/bash tooling/scripts/install-agent-integration.sh \
		--action remove-hook \
		--host "$(IDE)" \
		--root "$(CURDIR)" \
		$(if $(WORKSPACE),--workspace "$(WORKSPACE)",)

.PHONY: agent-integration-audit
.PHONY: skill-overlay-install skill-overlay-list skill-overlay-enable
.PHONY: skill-overlay-disable skill-overlay-uninstall skill-overlay-resolve

agent-integration-audit:
	@if [ -z "$(IDE)" ]; then echo "IDE is required: make agent-integration-audit IDE=trae|cursor|codex"; exit 1; fi
	@python3 tooling/scripts/agent-integration-audit.py \
		--root "$(or $(ROOT),$(CURDIR))" \
		--host "$(IDE)" \
		$(if $(WORKSPACE),--workspace "$(WORKSPACE)",)

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
