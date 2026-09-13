#!/usr/bin/env bash
# profile.sh — Manage worktree dev profiles
# Usage:
#   profile.sh activate <name>
#   profile.sh authorize <name> [SLOT=N]
#   profile.sh init <name> [SLOT=N]
#   profile.sh list
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/redact-env.sh"
AUTHORIZATION_SCRIPT="$SCRIPT_DIR/environment-creation-authorization.py"
LOCAL_DEV_DIR="$PROJECT_ROOT/.local/dev"
PROFILES_DIR="$LOCAL_DEV_DIR/profiles"
ACTIVE_DIR="$LOCAL_DEV_DIR/active"
DEPLOY_SCRIPT="$PROJECT_ROOT/tooling/scripts/deploy/deploy.sh"

# Worktree ID for per-worktree active profile pointer
WORKTREE_ID="$(basename "$PROJECT_ROOT")"
ACTIVE_FILE="$ACTIVE_DIR/$WORKTREE_ID.env"

mkdir -p "$PROFILES_DIR" "$ACTIVE_DIR"

cmd="${1:-}"
name="${2:-}"

ENV_REPO_HINT_FILE="$LOCAL_DEV_DIR/.env-repo-path"

validate_profile_name() {
  local profile_name="$1"
  if [[ ! "$profile_name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; then
    echo "[ERROR] Invalid profile name: $profile_name"
    exit 1
  fi
}

validate_slot() {
  local profile_slot="$1"
  if [[ ! "$profile_slot" =~ ^[0-9]+$ ]] || (( profile_slot > 99 )); then
    echo "[ERROR] SLOT must be an integer between 0 and 99."
    exit 1
  fi
}

list_profile_directories() {
  local env_root="$1"
  local directory
  for directory in "$env_root"/peers-touch/*/; do
    [[ -d "$directory" ]] || continue
    [[ "$(basename "$directory")" == "0-tpl" ]] && continue
    basename "$directory"
  done
}

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

require_reviewed_env_profile() {
  local profile_name="$1"
  local env_repo="$2"
  local relative_dir="peers-touch/$profile_name"
  local relative_profile="$relative_dir/profile.env.example"

  if ! git -C "$env_repo" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "[ERROR] Environment repository is not a Git worktree: $env_repo"
    return 1
  fi
  if ! git -C "$env_repo" ls-files --error-unmatch "$relative_profile" >/dev/null 2>&1; then
    echo "[ERROR] Profile '$profile_name' is not Git-tracked in the env repository."
    echo "        Untracked topology cannot authorize profile selection."
    return 1
  fi
  if [[ -n "$(git -C "$env_repo" status --porcelain --untracked-files=all -- "$relative_dir")" ]]; then
    echo "[ERROR] Profile '$profile_name' has dirty or untracked env definitions."
    echo "        Review and commit the exact topology before activation."
    return 1
  fi
}

verify_authorized_local_profile() {
  local profile_name="$1"
  local profile_file="$2"
  python3 "$AUTHORIZATION_SCRIPT" verify \
    --workspace-root "$PROJECT_ROOT" \
    --profile "$profile_name" \
    --profile-file "$profile_file"
}

import_profile_from_env_repo() {
  local profile_name="$1"
  local env_repo="$2"
  local env_profile_dir="$env_repo/peers-touch/$profile_name"

  if [[ ! -d "$env_profile_dir" ]]; then
    echo "[ERROR] Profile '$profile_name' not found in env repo at: $env_profile_dir"
    echo "        Observed profile directories (approval not implied):"
    list_profile_directories "$env_repo" | sed 's/^/          /'
    return 1
  fi

  local profile_src="$env_profile_dir/profile.env.example"
  if [[ ! -f "$profile_src" ]]; then
    echo "[ERROR] No profile.env.example in: $env_profile_dir"
    return 1
  fi
  require_reviewed_env_profile "$profile_name" "$env_repo" || return 1

  mkdir -p "$PROFILES_DIR"
  cp "$profile_src" "$PROFILES_DIR/$profile_name.env"
  echo "[OK] Imported profile: $profile_name → $PROFILES_DIR/$profile_name.env"

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
    validate_profile_name "$name"
    src="$PROFILES_DIR/$name.env"
    env_repo=""
    if resolved="$(resolve_env_repo)"; then
      env_repo="$resolved"
    fi
    if [[ -n "$env_repo" && -f "$env_repo/peers-touch/$name/profile.env.example" ]]; then
      import_profile_from_env_repo "$name" "$env_repo"
      src="$PROFILES_DIR/$name.env"
    elif [[ -f "$src" ]]; then
      if ! receipt="$(verify_authorized_local_profile "$name" "$src")"; then
        echo "[ERROR] Local profile '$name' is not human-authorized."
        echo "        Missing topology is a blocker; do not create a fallback."
        exit 1
      fi
      echo "[OK] Authorized local profile receipt: $receipt"
    else
      echo "[ERROR] Profile '$name' is unavailable."
      echo "        No reviewed env-repository definition or authorized local profile exists."
      exit 1
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

    # Post-activation: validate that referenced deploy envs exist and their
    # target hosts are consistent with the profile's declared URLs.
    # This catches cross-profile deploy env collisions at activation time
    # rather than at deploy time.
    warn_count=0
    validate_deploy_env_host() {
      local var_name="$1" url_var="$2" role="$3"
      local env_name url host deploy_file deploy_host
      env_name="$(sed -n "s/^${var_name}=//p" "$src" | tail -n 1)"
      url="$(sed -n "s/^${url_var}=//p" "$src" | tail -n 1)"
      [[ -n "$env_name" ]] || return 0
      if ! deploy_file="$(PT_ENV_REPO="$env_repo" "$DEPLOY_SCRIPT" resolve "$env_name")"; then
        echo ""
        echo "  [WARN] $role: $var_name=$env_name has no reviewed deploy env"
        warn_count=$((warn_count + 1))
        return 0
      fi
      [[ -n "$url" ]] || return 0
      host="$(echo "$url" | sed -E 's|https?://([^:/]+).*|\1|')"
      deploy_host="$(sed -n 's/^PT_DEPLOY_HOST=//p' "$deploy_file" | tail -n 1)"
      if [[ -n "$host" && -n "$deploy_host" && "$host" != "$deploy_host" ]]; then
        echo ""
        echo "  [WARN] $role host mismatch!"
        echo "         Profile ${url_var} host : $host"
        echo "         Deploy env $env_name host: $deploy_host"
        echo "         Deploy to '$env_name' would target the wrong machine."
        echo "         Fix $var_name in the profile or update $deploy_file."
        warn_count=$((warn_count + 1))
      fi
    }
    validate_deploy_env_host PT_STATION_DEPLOY_ENV PT_STATION_URL Station
    validate_deploy_env_host PT_RELAY_DEPLOY_ENV PT_RELAY_URL Relay
    if [[ "$warn_count" -gt 0 ]]; then
      echo ""
      echo "  ⚠ $warn_count deploy env issue(s) detected. 'make station' will refuse to deploy until fixed."
    fi
    ;;

  authorize)
    if [[ -z "$name" ]]; then
      echo "[ERROR] Usage: profile.sh authorize <name> [SLOT=N]"
      exit 1
    fi
    validate_profile_name "$name"
    slot="${SLOT:-0}"
    validate_slot "$slot"
    python3 "$AUTHORIZATION_SCRIPT" grant \
      --workspace-root "$PROJECT_ROOT" \
      --profile "$name" \
      --mode compose \
      --slot "$slot"
    ;;

  init)
    if [[ -z "$name" ]]; then
      echo "[ERROR] Usage: profile.sh init <name> [SLOT=N]"
      exit 1
    fi
    validate_profile_name "$name"
    slot="${SLOT:-0}"
    validate_slot "$slot"
    dest="$PROFILES_DIR/$name.env"
    if [[ -f "$dest" ]]; then
      echo "[ERROR] Profile '$name' already exists: $dest"
      echo "        profile-init never overwrites an existing environment."
      exit 1
    fi

    station_port=$((18080 + slot * 100))
    desktop_gw=$((3030 + slot * 100))
    desktop_web=$((3210 + slot * 100))
    desktop_web_gw=$((3031 + slot * 100))
    desktop_web_vite=$((3211 + slot * 100))
    mobile_web=$((5173 + slot * 100))

    temporary_profile="$(mktemp "$PROFILES_DIR/.${name}.XXXXXX")"
    cleanup_temporary_profile() {
      rm -f "$temporary_profile"
    }
    trap cleanup_temporary_profile EXIT

    cat > "$temporary_profile" <<EOF
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

    if ! receipt="$(python3 "$AUTHORIZATION_SCRIPT" consume \
      --workspace-root "$PROJECT_ROOT" \
      --profile "$name" \
      --profile-file "$temporary_profile")"; then
      echo "[ERROR] profile-init requires a matching human-created authorization."
      echo "        Run interactively: make profile-authorize PROFILE=$name SLOT=$slot"
      exit 1
    fi
    chmod 600 "$temporary_profile"
    mv "$temporary_profile" "$dest"
    trap - EXIT
    echo "[OK] Created profile: $dest"
    echo "     Authorization receipt: $receipt"
    echo "     Activate with: make profile PROFILE=$name"
    ;;

  list)
    echo "Available profiles:"
    env_repo=""
    if resolved="$(resolve_env_repo)"; then
      env_repo="$resolved"
    fi
    profile_names="$(
      {
        for f in "$PROFILES_DIR"/*.env; do
          [[ -f "$f" ]] && basename "$f" .env
        done
        if [[ -n "$env_repo" ]]; then
          for f in "$env_repo"/peers-touch/*/profile.env.example; do
            [[ -f "$f" ]] && basename "$(dirname "$f")"
          done
        fi
      } | sort -u
    )"
    if [[ -n "$profile_names" ]]; then
      # Get current active profile for this worktree
      active_target=""
      if [[ -L "$ACTIVE_FILE" ]]; then
        active_target="$(readlink "$ACTIVE_FILE" 2>/dev/null || true)"
      fi
      while IFS= read -r pname; do
        [[ -n "$pname" ]] || continue
        f="$PROFILES_DIR/$pname.env"
        source_kind="unapproved"
        if [[ -n "$env_repo" && -f "$env_repo/peers-touch/$pname/profile.env.example" ]] \
          && require_reviewed_env_profile "$pname" "$env_repo" >/dev/null 2>&1; then
          source_kind="canonical"
        elif [[ -f "$f" ]] \
          && verify_authorized_local_profile "$pname" "$f" >/dev/null 2>&1; then
          source_kind="authorized-local"
        fi
        if [[ "$active_target" == "../profiles/$pname.env" ]]; then
          echo "  * $pname ($source_kind; active in $WORKTREE_ID)"
        else
          echo "    $pname ($source_kind)"
        fi
      done <<< "$profile_names"
    else
      echo "  (none)"
      echo ""
      echo "  Human authorization: make profile-authorize PROFILE=local-a SLOT=0"
      echo "  Then create: make profile-init PROFILE=local-a SLOT=0"
    fi
    echo ""
    echo "Local deploy env cache is non-authoritative."
    echo "Remote deploys resolve reviewed definitions directly from the env repository."
    ;;

  *)
    echo "Usage: profile.sh {activate|authorize|init|list} [name]"
    exit 1
    ;;
esac
