# ─── Dev Environment Setup ──────────────────────────────────────

.PHONY: init-dev skill-help

init-dev:
	@echo "=== Peers-Touch Dev Environment Setup ==="
	@echo ""
	@echo "[1/3] Installing dependencies..."
	pnpm install
	@echo ""
	@echo "[2/3] Setting up IDE config..."
	/bin/bash tooling/scripts/ide-setup.sh $(IDE)
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
	@echo "=== Done! Run 'make help' to see available commands. ==="

skill-help:
	@echo ""
	@echo "Skills are in tooling/skills/. Run 'make skills' to install them."
	@echo "See AGENTS.md §13 for details."
	@echo ""

# ─── Skills Installation ─────────────────────────────────────────
.PHONY: skills

skills:
	@echo ""
	@echo "Install project skills to IDE environment"
	@echo "=========================================="
	@echo ""
	@echo "Select target IDE:"
	@echo "  1) trae"
	@echo "  2) cursor"
	@echo ""
	@read -p "Enter choice [1-2]: " choice; \
	case "$$choice" in \
	  1) IDE_NAME=trae ;; \
	  2) IDE_NAME=cursor ;; \
	  *) echo "Invalid choice. Aborted."; exit 1 ;; \
	esac; \
	SKILLS_SRC="$$(pwd)/tooling/skills"; \
	IDE_DIR="$$(pwd)/.$$IDE_NAME"; \
	mkdir -p "$$IDE_DIR"; \
	if [ -L "$$IDE_DIR/skills" ]; then rm "$$IDE_DIR/skills"; fi; \
	if [ -d "$$IDE_DIR/skills" ]; then \
	  echo "  Warning: .$$IDE_NAME/skills/ is a real directory, replacing with symlink..."; \
	  rm -rf "$$IDE_DIR/skills"; \
	fi; \
	ln -s "$$SKILLS_SRC" "$$IDE_DIR/skills"; \
	SKILL_COUNT=$$(find "$$SKILLS_SRC" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' '); \
	echo ""; \
	echo "  ✓ Linked: .$$IDE_NAME/skills -> tooling/skills ($$SKILL_COUNT skills)"; \
	echo ""; \
	echo "Installed skills:"; \
	for d in "$$SKILLS_SRC"/*/; do \
	  [ -f "$$d/SKILL.md" ] && echo "  - $$(basename $$d)"; \
	done; \
	echo ""
