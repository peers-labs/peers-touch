#!/usr/bin/env bash
# secret-reconcile.sh — deploy-time reconciliation of Class B (externally
# shared) runtime secrets for one Station or Relay role.
#
# It deliberately adds no crypto stack. Values are:
#   at rest    : git-crypt ciphertext in the sibling env repo per-role file
#   in transit : the reviewed SSH channel (stdin only; never argv/history)
#   on host    : 0600 compose-project-namespaced runtime.env, atomic mv
#
# Trust model R1 (trusted host): 0600 + project namespacing protect against
# non-root users and co-located projects, NOT against host root / the docker
# socket. See docs/architecture/platform/runtime/runtime-secrets/design.md.
#
# Invariants:
#   - secret VALUES never enter argv, ssh command text, logs or this script's
#     output; only key NAMES are logged
#   - only keys declared class=external-shared in the manifest are upserted
#   - every existing remote line for another key (Class A / host-generated) is
#     preserved byte-for-byte
#   - a missing required key fails closed (BLOCKED) before build/restart
#
# Required env:
#   PROFILE, ROLE, PT_ENV_REPO(unlocked checkout), PT_DEPLOY_USER,
#   PT_DEPLOY_HOST, PT_DEPLOY_RUNTIME_PATH
set -euo pipefail

blocked() {
  local code="$1"; shift
  printf '%s\n' \
    "{\"status\":\"BLOCKED\",\"code\":\"$code\",\"profile\":\"${PROFILE:-}\",\"role\":\"${ROLE:-}\",\"message\":\"$*\"}" >&2
  exit 1
}
log() { printf '[secret-reconcile] %s\n' "$*" >&2; }

: "${PROFILE:?PROFILE required}"
: "${ROLE:?ROLE required}"
: "${PT_ENV_REPO:?PT_ENV_REPO required}"
: "${PT_DEPLOY_USER:?PT_DEPLOY_USER required}"
: "${PT_DEPLOY_HOST:?PT_DEPLOY_HOST required}"

case "$ROLE" in station|relay) ;; *) blocked SECRET_BAD_ROLE "ROLE must be station|relay" ;; esac

role_dir="$PT_ENV_REPO/peers-touch/$PROFILE/$ROLE"
manifest="$role_dir/secret-manifest.env"
values_file="$role_dir/runtime.env"
remote_path="${PT_DEPLOY_RUNTIME_PATH:-}"

# No manifest => the role declares no Class B secrets; reconcile is a no-op
# (capability off, not a missing secret).
if [[ ! -f "$manifest" ]]; then
  log "no secret-manifest.env for $PROFILE/$ROLE — skip (no external-shared secrets)"
  exit 0
fi
if [[ ! -e "$values_file" ]]; then
  blocked SECRET_NOT_PROVISIONED \
    "per-role runtime.env not created yet; set the value with 'make secret-set PROFILE=$PROFILE ROLE=$ROLE KEY=<NAME>' and commit the env repo"
fi
[[ -r "$values_file" ]] || blocked SECRET_VAULT_LOCKED \
  "per-role runtime.env unreadable; unlock the env repository with git-crypt"

# Target file on the host. New docker-compose contract namespaces it as
# <PT_DEPLOY_RUNTIME_PATH>/runtime.env. Legacy flat profiles (e.g. four) that
# already consume a single --env-file may point PT_DEPLOY_RUNTIME_ENV_FILE at
# that exact file so Class B secrets can be reconciled without migrating the
# profile's code path, compose project or data volume.
if [[ -n "${PT_DEPLOY_RUNTIME_ENV_FILE:-}" ]]; then
  remote_file="$PT_DEPLOY_RUNTIME_ENV_FILE"
elif [[ -n "${PT_DEPLOY_RUNTIME_PATH:-}" ]]; then
  remote_file="$PT_DEPLOY_RUNTIME_PATH/runtime.env"
else
  blocked SECRET_RUNTIME_PATH_UNSET \
    "deploy definition provides neither PT_DEPLOY_RUNTIME_PATH nor PT_DEPLOY_RUNTIME_ENV_FILE"
fi

# ── parse manifest ─────────────────────────────────────────────────────────
# Tracked, non-secret lines (bash 3.2 compatible — no associative arrays):
#   REQUIRED__<KEY>=1
#   CLASS__<KEY>=external-shared|host-generated
required_keys=()
class_file="$(mktemp -t peers-secret-class)"
while IFS= read -r raw; do
  line="${raw%%#*}"; line="${line//[[:space:]]/}"
  [[ -z "$line" ]] && continue
  k="${line%%=*}"; v="${line#*=}"
  case "$k" in
    REQUIRED__*)
      [[ "$v" == "1" ]] && required_keys+=("${k#REQUIRED__}") ;;
    CLASS__*)
      printf '%s\t%s\n' "${k#CLASS__}" "$v" >> "$class_file" ;;
  esac
done < "$manifest"

class_of() {
  awk -F'\t' -v k="$1" '$1==k {print $2; exit}' "$class_file"
}

ship_keys=()
for key in "${required_keys[@]}"; do
  if [[ "$(class_of "$key")" != "external-shared" ]]; then
    blocked SECRET_MANIFEST_INVALID "required key $key must be class external-shared"
  fi
  ship_keys+=("$key")
done
if [[ ${#ship_keys[@]} -eq 0 ]]; then log "no external-shared keys; skip"; exit 0; fi

# ── read + preflight (names only in messages) ──────────────────────────────
get_value() {
  awk -F= -v k="$1" '$1==k {sub(/^[^=]*=/,""); print; exit}' "$values_file" \
    | sed "s/^'//; s/'\$//"
}
for key in "${ship_keys[@]}"; do
  if [[ -z "$(get_value "$key")" ]]; then
    blocked SECRET_PREFLIGHT_MISSING "missing required secret $key (use make secret-set)"
  fi
done
log "preflight ok: ${#ship_keys[@]} external-shared key(s) present"

# ── build the upsert body locally (never echoed) ───────────────────────────
body_file="$(mktemp -t peers-secret-body)"
trap 'rm -f "$body_file" "$class_file"' EXIT
# Meta line consumed by the container entrypoint: the space-separated list of
# key NAMES that must be non-empty at startup (names only, not a secret).
required_names="$(printf '%s ' "${ship_keys[@]}")"
printf "PEERS_REQUIRED_SECRET_KEYS='%s'\n" "${required_names%% }" >> "$body_file"
for key in "${ship_keys[@]}"; do
  val="$(get_value "$key")"
  esc="${val//\'/\'\\\'\'}"          # POSIX single-quote escape
  printf "%s='%s'\n" "$key" "$esc" >> "$body_file"
done
# Whitelist = meta key + the Class B keys; everything else remote is preserved.
whitelist=("PEERS_REQUIRED_SECRET_KEYS" "${ship_keys[@]}")

# Remote updater is passed as the ssh COMMAND (argv contains only logic, the
# target PATH and whitelist key NAMES — never values). The new KEY=VALUE body
# is base64-encoded and sent on STDIN ONLY, so there is no script/body stream
# mixing. The remote side decodes stdin, preserves every existing line whose
# KEY= is not whitelisted, appends the new values, and atomically replaces the
# target at 0600. Its stdout prints ONLY a constant confirmation (no values).
read -r -d '' REMOTE_UPDATER <<'REMOTE' || true
set -eu
target="$1"; shift
# Expand a leading literal $HOME/~ on the REMOTE host. The deploy definition
# stores this quoted ('$HOME/...') so local `source` does not expand it to the
# operator machine's home; expansion must happen here, on the target.
case "$target" in
  '$HOME'*) target="$HOME${target#'$HOME'}" ;;
  '~'*)    target="$HOME${target#'~'}" ;;
esac
umask 077
dir="$(dirname "$target")"; mkdir -p "$dir"
body="$(mktemp "$dir/.secbody.XXXXXX")"
new="$(mktemp "$dir/.env.XXXXXX")"
cleanup() { rm -f "$body" "$new"; }
trap cleanup EXIT
base64 -d > "$body"
: > "$new"
if [ -f "$target" ]; then
  while IFS= read -r old; do
    keep=1
    for k in "$@"; do
      case "$old" in "$k="*) keep=0 ;; esac
    done
    [ "$keep" = 1 ] && printf '%s\n' "$old"
  done < "$target" > "$new"
fi
cat "$body" >> "$new"
chmod 600 "$new"
mv "$new" "$target"
echo reconciled
REMOTE

log "shipping over SSH stdin -> $remote_file"
# Whitelist key NAMES go as args; VALUES travel base64 on stdin and never enter
# argv. Remote stdout is the constant "reconciled"; no secret is printed.
ssh_args=()
for key in "${whitelist[@]}"; do ssh_args+=("$(printf '%q' "$key")"); done
remote_out="$(base64 < "$body_file" | ssh \
  -o BatchMode=yes -o ConnectTimeout=10 -o ConnectionAttempts=1 \
  -o StrictHostKeyChecking=yes \
  "${PT_DEPLOY_USER}@${PT_DEPLOY_HOST}" \
  "bash -c $(printf '%q' "$REMOTE_UPDATER") _ $(printf '%q' "$remote_file") ${ssh_args[*]}")" \
  || blocked SECRET_SHIP_FAILED "remote reconcile failed on $PT_DEPLOY_HOST"
[[ "$remote_out" == "reconciled" ]] \
  || blocked SECRET_SHIP_FAILED "unexpected remote reconcile response"

log "reconcile complete: $remote_file (0600)"
