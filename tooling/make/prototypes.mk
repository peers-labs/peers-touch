# ─── Prototype Portal ─────────────────────────────────────────────

.PHONY: run-prototype

run-prototype:
	@worktree_mode=0; \
	make_flags="$${MAKEFLAGS:-}"; \
	case "$$make_flags" in *w*|*--print-directory*) worktree_mode=1 ;; esac; \
	branch="$$(git branch --show-current 2>/dev/null || echo current)"; \
	worktree="$$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; \
	lock_hash="$$(printf "%s" "$$worktree" | shasum -a 256 | awk '{print $$1}')"; \
	lock_dir="$${TMPDIR:-/tmp}/peers-touch-run-prototype-$$lock_hash.lock"; \
	port="$${VITE_PROTOTYPE_PORT:-3200}"; \
	if [ "$$worktree_mode" = "1" ]; then \
	  while lsof -nP -iTCP:"$$port" -sTCP:LISTEN >/dev/null 2>&1; do \
	    port="$$((port + 1))"; \
	  done; \
	else \
	  if mkdir "$$lock_dir" 2>/dev/null; then \
	    printf "%s\n" "$$$$" > "$$lock_dir/pid"; \
	    printf "%s\n" "$$worktree" > "$$lock_dir/worktree"; \
	    trap 'rm -rf "$$lock_dir"' EXIT INT TERM; \
	  else \
	    existing_pid="$$(cat "$$lock_dir/pid" 2>/dev/null || true)"; \
	    if [ -n "$$existing_pid" ] && kill -0 "$$existing_pid" 2>/dev/null; then \
	      echo "run-prototype is already running for this worktree."; \
	      echo "worktree: $$worktree"; \
	      echo "pid: $$existing_pid"; \
	      echo "Stop that process before starting another prototype from the same worktree, or use: make -w run-prototype"; \
	      exit 1; \
	    fi; \
	    echo "Removing stale run-prototype lock for $$worktree"; \
	    rm -rf "$$lock_dir"; \
	    mkdir "$$lock_dir"; \
	    printf "%s\n" "$$$$" > "$$lock_dir/pid"; \
	    printf "%s\n" "$$worktree" > "$$lock_dir/worktree"; \
	    trap 'rm -rf "$$lock_dir"' EXIT INT TERM; \
	  fi; \
	fi; \
	echo "Starting Peers Touch Prototype Portal"; \
	echo "  branch:   $$branch"; \
	echo "  worktree: $$worktree"; \
	echo "  port:     $$port"; \
	if [ "$$worktree_mode" = "1" ]; then echo "  mode:     worktree parallel"; else echo "  mode:     exclusive"; fi; \
	VITE_PROTOTYPE_BRANCH="$$branch" VITE_PROTOTYPE_WORKTREE_PATH="$$worktree" VITE_PROTOTYPE_PORT="$$port" pnpm --filter @peers-touch/prototype-portal run dev --port "$$port"
