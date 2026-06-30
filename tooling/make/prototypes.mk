# ─── Prototype Portal / Sites ────────────────────────────────────

.PHONY: run-prototype

PROTOTYPE_SITE_ARG := $(or $(SITE),$(word 2,$(MAKECMDGOALS)))

run-prototype:
	@site="$(PROTOTYPE_SITE_ARG)"; \
	if [ -z "$$site" ]; then \
	  echo "Usage: make run-prototype <desktop|mobile|dashboard>"; \
	  echo "       make run-prototype SITE=desktop"; \
	  exit 1; \
	fi; \
	branch="$$(git branch --show-current 2>/dev/null || echo current)"; \
	worktree="$$(pwd)"; \
	case "$$site" in \
	  desktop) \
	    echo "Starting prototype site: desktop"; \
	    VITE_PROTOTYPE_SITE=desktop VITE_PROTOTYPE_PORT=3200 VITE_PROTOTYPE_BRANCH="$$branch" VITE_PROTOTYPE_WORKTREE_PATH="$$worktree" pnpm --filter @peers-touch/prototype-portal run dev -- --port 3200; \
	    ;; \
	  mobile) \
	    echo "Starting prototype site: mobile"; \
	    VITE_PROTOTYPE_SITE=mobile VITE_PROTOTYPE_PORT=3201 VITE_PROTOTYPE_BRANCH="$$branch" VITE_PROTOTYPE_WORKTREE_PATH="$$worktree" pnpm --filter @peers-touch/prototype-portal run dev -- --port 3201; \
	    ;; \
	  dashboard) \
	    echo "Starting prototype site: dashboard"; \
	    VITE_PROTOTYPE_SITE=dashboard VITE_PROTOTYPE_PORT=3202 VITE_PROTOTYPE_BRANCH="$$branch" VITE_PROTOTYPE_WORKTREE_PATH="$$worktree" pnpm --filter @peers-touch/prototype-portal run dev -- --port 3202; \
	    ;; \
	  *) \
	    echo "Unknown prototype site: $$site"; \
	    echo "Usage: make run-prototype <desktop|mobile|dashboard>"; \
	    exit 1; \
	    ;; \
	esac
