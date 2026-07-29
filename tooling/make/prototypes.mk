# ─── Prototype Portal ─────────────────────────────────────────────

.PHONY: run-prototype

run-prototype:
	@worktree_mode=0; \
	make_flags_short="$${MAKEFLAGS%% *}"; \
	case "$$make_flags_short" in *w*) worktree_mode=1 ;; esac; \
	branch="$$(git branch --show-current 2>/dev/null || echo current)"; \
	worktree="$$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; \
	lock_hash="$$(printf "%s" "$$worktree" | shasum -a 256 | awk '{print $$1}')"; \
	port_base="$${VITE_PROTOTYPE_PORT:-3200}"; \
	port="$$port_base"; \
	if [ "$$worktree_mode" = "1" ]; then \
	  state_dir="$${TMPDIR:-/tmp}/peers-touch-run-prototype-$$lock_hash.state"; \
	  mkdir -p "$$state_dir"; \
	  stored_pid="$$(cat "$$state_dir/pid" 2>/dev/null || true)"; \
	  stored_port="$$(cat "$$state_dir/port" 2>/dev/null || true)"; \
	  if [ -n "$$stored_pid" ] && [ -n "$$stored_port" ] && kill -0 "$$stored_pid" 2>/dev/null; then \
	    echo "Prototype portal is already running for this worktree."; \
	    echo "  worktree: $$worktree"; \
	    echo "  pid:      $$stored_pid"; \
	    echo "  port:     $$stored_port"; \
	    echo "  url:      http://localhost:$$stored_port/"; \
	    exit 0; \
	  fi; \
	  discovered_port=""; \
	  discovered_pid=""; \
	  probe_port="$$port_base"; \
	  while [ "$$probe_port" -le "$$((port_base + 99))" ]; do \
	    listener_pids="$$(lsof -nP -tiTCP:"$$probe_port" -sTCP:LISTEN 2>/dev/null || true)"; \
	    for listener_pid in $$listener_pids; do \
	      listener_command="$$(ps -p "$$listener_pid" -o command= 2>/dev/null || true)"; \
	      case "$$listener_command" in *"$$worktree"*"/vite"*|*"$$worktree"*"/node_modules/.bin"* ) \
	        discovered_port="$$probe_port"; \
	        discovered_pid="$$listener_pid"; \
	        break; \
	        ;; \
	      esac; \
	    done; \
	    if [ -n "$$discovered_port" ]; then break; fi; \
	    probe_port="$$((probe_port + 1))"; \
	  done; \
	  if [ -n "$$discovered_port" ] && [ -n "$$discovered_pid" ]; then \
	    printf "%s\n" "$$discovered_pid" > "$$state_dir/pid"; \
	    printf "%s\n" "$$discovered_port" > "$$state_dir/port"; \
	    printf "%s\n" "$$worktree" > "$$state_dir/worktree"; \
	    echo "Prototype portal is already running for this worktree."; \
	    echo "  worktree: $$worktree"; \
	    echo "  pid:      $$discovered_pid"; \
	    echo "  port:     $$discovered_port"; \
	    echo "  url:      http://localhost:$$discovered_port/"; \
	    exit 0; \
	  fi; \
	  if [ -n "$$stored_port" ]; then port="$$stored_port"; fi; \
	  while lsof -nP -iTCP:"$$port" -sTCP:LISTEN >/dev/null 2>&1; do \
	    port="$$((port + 1))"; \
	  done; \
	  printf "%s\n" "$$$$" > "$$state_dir/pid"; \
	  printf "%s\n" "$$port" > "$$state_dir/port"; \
	  printf "%s\n" "$$worktree" > "$$state_dir/worktree"; \
	  trap 'rm -f "$$state_dir/pid"' EXIT INT TERM; \
	else \
	  lock_dir="$${TMPDIR:-/tmp}/peers-touch-run-prototype-$$lock_hash.lock"; \
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
	      echo "Use 'make -w run-prototype' to reuse this worktree's stable prototype port."; \
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
	if [ "$$worktree_mode" = "1" ]; then echo "  mode:     worktree stable (-w)"; fi; \
	VITE_PROTOTYPE_BRANCH="$$branch" VITE_PROTOTYPE_WORKTREE_PATH="$$worktree" VITE_PROTOTYPE_PORT="$$port" pnpm --filter @peers-touch/prototype-portal run dev --port "$$port"
