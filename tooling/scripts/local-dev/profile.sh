#!/usr/bin/env bash
# profile.sh — Manage worktree dev profiles
# Usage:
#   profile.sh activate <name>
#   profile.sh init <name> [SLOT=N]
#   profile.sh list
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
source "$SCRIPT_DIR/redact-env.sh"
LOCAL_DEV_DIR="$PROJECT_ROOT/.local/dev"
PROFILES_DIR="$LOCAL_DEV_DIR/profiles"
ACTIVE_DIR="$LOCAL_DEV_DIR/active"
LOCAL_ROOT="$PROJECT_ROOT/.local"
DEPLOY_DIR="$LOCAL_ROOT/deploy"

# Worktrees normally share one .local repo, but older worktrees may have a
# partial .local directory. Bootstrap missing profile/deploy config from the
# primary worktree without overwriting local edits.
find_all_shared_local_roots() {
  if [[ -n "${PT_SHARED_LOCAL_DIR:-}" && -d "$PT_SHARED_LOCAL_DIR" ]]; then
    echo "$PT_SHARED_LOCAL_DIR"
  fi

  local workspace_root
  workspace_root="$(dirname "$PROJECT_ROOT")"

  local candidate
  for candidate in \
    "$workspace_root/peers-touch/.local" \
    "$workspace_root/peers-ai-agent/.local" \
    "$workspace_root/peers-touch-applet/.local"; do
    if [[ "$candidate" != "$LOCAL_ROOT" && -d "$candidate" ]]; then
      if [[ -d "$candidate/deploy" || -d "$candidate/dev/profiles" ]]; then
        echo "$candidate"
      fi
    fi
  done
}

copy_missing_files() {
  local src_dir="$1"
  local dst_dir="$2"

  [[ -d "$src_dir" ]] || return 0
  mkdir -p "$dst_dir"

  local src dst
  for src in "$src_dir"/*; do
    [[ -f "$src" ]] || continue
    dst="$dst_dir/$(basename "$src")"
    if [[ ! -f "$dst" ]]; then
      cp "$src" "$dst"
      echo "[INFO] Bootstrapped ${dst#"$LOCAL_ROOT/"}"
    fi
  done
}

ensure_local_assets() {
  local roots
  roots="$(find_all_shared_local_roots)"
  [[ -n "$roots" ]] || return 0

  local shared_root
  while IFS= read -r shared_root; do
    [[ -n "$shared_root" ]] || continue
    copy_missing_files "$shared_root/dev/profiles" "$PROFILES_DIR"
    copy_missing_files "$shared_root/deploy/envs" "$DEPLOY_DIR/envs"
    if [[ -f "$shared_root/deploy/git-server.env" && ! -f "$DEPLOY_DIR/git-server.env" ]]; then
      mkdir -p "$DEPLOY_DIR"
      cp "$shared_root/deploy/git-server.env" "$DEPLOY_DIR/git-server.env"
      echo "[INFO] Bootstrapped deploy/git-server.env"
    fi
  done <<< "$roots"
}

# Worktree ID for per-worktree active profile pointer
WORKTREE_ID="$(basename "$PROJECT_ROOT")"
ACTIVE_FILE="$ACTIVE_DIR/$WORKTREE_ID.env"

mkdir -p "$PROFILES_DIR" "$ACTIVE_DIR"

cmd="${1:-}"
name="${2:-}"

ENV_REPO_HINT_FILE="$LOCAL_DEV_DIR/.env-repo-path"

resolve_env_repo() {
  if [[ -n "${PT_ENV_REPO:-}" && -d "$PT_ENV_REPO" ]]; then
    echo "$PT_ENV_REPO"
    return 0
  fi
  if [[ -f "$ENV_REPO_HINT_FILE" ]]; then
    local saved
    saved="$(cat "$ENV_REPO_HINT_FILE")"
    if [[ -d "$saved" ]]; then
      echo "$saved"
      return 0
    fi
  fi
  local sibling_env
  sibling_env="$(dirname "$PROJECT_ROOT")/env"
  if [[ -d "$sibling_env/peers-touch" ]]; then
    echo "$sibling_env"
    return 0
  fi
  return 1
}

import_profile_from_env_repo() {
  local profile_name="$1"
  local env_repo="$2"
  local env_profile_dir="$env_repo/peers-touch/$profile_name"

  if [[ ! -d "$env_profile_dir" ]]; then
    echo "[ERROR] Profile '$profile_name' not found in env repo at: $env_profile_dir"
    echo "        Available in env repo:"
    ls "$env_repo/peers-touch/" 2>/dev/null | grep -v '^0-tpl$' | sed 's/^/          /'
    return 1
  fi

  local profile_src="$env_profile_dir/profile.env.example"
  if [[ ! -f "$profile_src" ]]; then
    echo "[ERROR] No profile.env.example in: $env_profile_dir"
    return 1
  fi

  mkdir -p "$PROFILES_DIR"
  cp "$profile_src" "$PROFILES_DIR/$profile_name.env"
  echo "[OK] Imported profile: $profile_name → $PROFILES_DIR/$profile_name.env"

  if [[ -d "$env_profile_dir/deploy" ]]; then
    mkdir -p "$DEPLOY_DIR/envs"
    for deploy_env in "$env_profile_dir/deploy"/*.env.example; do
      [[ -f "$deploy_env" ]] || continue
      local deploy_name
      deploy_name="$(basename "$deploy_env" .env.example)"
      cp "$deploy_env" "$DEPLOY_DIR/envs/$deploy_name.env"
      echo "[OK] Imported deploy env: $deploy_name → $DEPLOY_DIR/envs/$deploy_name.env"
    done
  fi

  # Remember the env repo path for next time
  echo "$env_repo" > "$ENV_REPO_HINT_FILE"
  return 0
}

case "$cmd" in
  activate)
    if [[ -z "$name" ]]; then
      echo "[ERROR] Usage: profile.sh activate <name>"
      exit 1
    fi
    ensure_local_assets
    src="$PROFILES_DIR/$name.env"
    env_repo=""
    if resolved="$(resolve_env_repo)"; then
      env_repo="$resolved"
    fi
    if [[ -n "$env_repo" && -f "$env_repo/peers-touch/$name/profile.env.example" ]]; then
      import_profile_from_env_repo "$name" "$env_repo"
      src="$PROFILES_DIR/$name.env"
    elif [[ ! -f "$src" ]]; then
      echo "[INFO] Profile '$name' not found locally. Attempting import from env repo..."
      if [[ -n "$env_repo" ]]; then
        echo "[INFO] Using env repo: $env_repo"
      else
        echo ""
        echo "  The env repo contains deployable profiles."
        echo "  Enter the path to your local 'env' repo clone:"
        echo "  (e.g., ~/Documents/Projects/peers-touch/env)"
        echo ""
        printf "  env repo path: "
        read -r user_path
        user_path="${user_path/#\~/$HOME}"
        if [[ ! -d "$user_path" ]]; then
          echo "[ERROR] Directory not found: $user_path"
          exit 1
        fi
        if [[ ! -d "$user_path/peers-touch" ]]; then
          echo "[ERROR] Not a valid env repo (missing peers-touch/ subdirectory): $user_path"
          exit 1
        fi
        env_repo="$user_path"
      fi
      if ! import_profile_from_env_repo "$name" "$env_repo"; then
        exit 1
      fi
      src="$PROFILES_DIR/$name.env"
    fi
    declared_profile="$(
      sed -n 's/^PT_DEV_PROFILE=//p' "$src" | tail -n 1
    )"
    if [[ -z "$declared_profile" ]]; then
      echo "[ERROR] Profile '$name' is missing PT_DEV_PROFILE: $src"
      exit 1
    fi
    if [[ "$declared_profile" != "$name" ]]; then
      echo "[ERROR] Profile identity mismatch: filename=$name.env PT_DEV_PROFILE=$declared_profile"
      echo "        Regenerate or repair the profile before activation."
      exit 1
    fi
    # The worktree-specific symlink is the only active-profile selector.
    ln -sfn "../profiles/$name.env" "$ACTIVE_FILE"
    echo "[OK] Active profile: $name (worktree: $WORKTREE_ID)"
    echo ""
    print_redacted_env_file "$src" | grep -E '^PT_' | sed 's/^/  /'
    ;;

  init)
    if [[ -z "$name" ]]; then
      echo "[ERROR] Usage: profile.sh init <name> [SLOT=N]"
      exit 1
    fi
    slot="${SLOT:-0}"
    dest="$PROFILES_DIR/$name.env"
    if [[ -f "$dest" ]]; then
      echo "[WARN] Profile '$name' already exists: $dest"
      echo "       Overwrite? [y/N]"
      read -r confirm
      if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        echo "Aborted."
        exit 0
      fi
    fi
    ensure_local_assets

    station_port=$((18080 + slot * 100))
    desktop_gw=$((3030 + slot * 100))
    desktop_web=$((3210 + slot * 100))
    desktop_web_gw=$((3031 + slot * 100))
    desktop_web_vite=$((3211 + slot * 100))
    mobile_web=$((5173 + slot * 100))

    cat > "$dest" <<EOF
# Profile: $name (slot $slot)
# Generated by: make profile-init PROFILE=$name SLOT=$slot

PT_DEV_PROFILE=$name
PT_DEV_SLOT=$slot

# Station
PT_STATION_MODE=compose
PT_STATION_NAME=$name
PT_STATION_URL=http://127.0.0.1:$station_port
PT_STATION_PORT=$station_port
PT_STATION_DB_NAME=peers_touch_${name//-/_}
PT_STATION_COMPOSE_PROJECT=pt_${name//-/_}
PT_STATION_COMPOSE_ENV_FILE=
PT_STATION_DEPLOY_ENV=
PT_STATION_DEPLOY_BRANCH=
PT_STATION_HEALTH_URL=

# Relay
PT_RELAY_MODE=remote
PT_RELAY_URL=
PT_RELAY_DEPLOY_ENV=
PT_RELAY_DEPLOY_BRANCH=
PT_RELAY_HEALTH_URL=
PT_RELAY_MULTIADDR=
PT_BOOTSTRAP_NODES=

# Desktop
PT_DESKTOP_APP_GATEWAY_PORT=$desktop_gw
PT_DESKTOP_APP_WEB_PORT=$desktop_web
PT_DESKTOP_WEB_GATEWAY_PORT=$desktop_web_gw
PT_DESKTOP_WEB_WEB_PORT=$desktop_web_vite

# Mobile
PT_MOBILE_WEB_PORT=$mobile_web
PT_MOBILE_DEFAULT_STATION_URL=http://127.0.0.1:$station_port
EOF

    echo "[OK] Created profile: $dest"
    echo "     Activate with: make profile PROFILE=$name"
    ;;

  list)
    ensure_local_assets
    echo "Available profiles:"
    if ls "$PROFILES_DIR"/*.env >/dev/null 2>&1; then
      # Get current active profile for this worktree
      active_target=""
      if [[ -L "$ACTIVE_FILE" ]]; then
        active_target="$(readlink "$ACTIVE_FILE" 2>/dev/null || true)"
      fi
      for f in "$PROFILES_DIR"/*.env; do
        pname="$(basename "$f" .env)"
        if [[ "$active_target" == "../profiles/$pname.env" ]]; then
          echo "  * $pname (active in $WORKTREE_ID)"
        else
          echo "    $pname"
        fi
      done
    else
      echo "  (none)"
      echo ""
      echo "  Create one: make profile-init PROFILE=local-a SLOT=0"
    fi
    echo ""
    echo "Deploy envs:"
    if ls "$DEPLOY_DIR"/envs/*.env >/dev/null 2>&1; then
      for f in "$DEPLOY_DIR"/envs/*.env; do
        echo "    $(basename "$f" .env)"
      done
    else
      echo "  (none)"
    fi
    ;;

  *)
    echo "Usage: profile.sh {activate|init|list} [name]"
    exit 1
    ;;
esac
