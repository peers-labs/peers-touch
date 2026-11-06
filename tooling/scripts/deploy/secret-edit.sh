#!/usr/bin/env bash
# secret-edit.sh — manage Class B secret VALUES in the sibling, git-crypt
# encrypted env repository (per-role runtime.env).
#
#   secret-edit.sh set    <profile> <role> <KEY>   # value read from stdin
#   secret-edit.sh status <profile> <role>         # masked presence report
#
# The value is read ONLY from stdin (piped or hidden prompt), never from argv,
# so it never lands in shell history or process listings. The file stays
# git-crypt ciphertext at rest; this script requires an unlocked checkout.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_REPO="${PT_ENV_REPO:-$(dirname "$PROJECT_ROOT")/env}"

action="${1:-}"; profile="${2:-}"; role="${3:-}"; key="${4:-}"

die() { echo "[secret] ERROR: $*" >&2; exit 1; }

[[ -n "$profile" && -n "$role" ]] || die "usage: secret-edit.sh <set|status> <profile> <role> [KEY]"
case "$role" in station|relay) ;; *) die "role must be station|relay" ;; esac
[[ -d "$ENV_REPO/peers-touch" ]] || die "env repository not found at $ENV_REPO"

role_dir="$ENV_REPO/peers-touch/$profile/$role"
values="$role_dir/runtime.env"
manifest="$role_dir/secret-manifest.env"

# git-crypt unlock state: a tracked runtime.env that is unreadable / still
# ciphertext means the vault is locked. We require the directory to exist and
# the values file to be readable plaintext.
[[ -d "$role_dir" ]] || die "no per-role directory $role_dir (define the role in the env repo first)"

mask() {
  # show only first/last char and length; never the value.
  local v="$1" n=${#v}
  if (( n == 0 )); then echo "-"; elif (( n <= 4 )); then echo "****($n)"; else printf '%s***%s(%d)\n' "${v:0:1}" "${v: -1}" "$n"; fi
}

case "$action" in
  set)
    [[ -n "$key" ]] || die "usage: secret-edit.sh set <profile> <role> <KEY>  (value via stdin)"
    [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "key must be UPPER_SNAKE (got $key)"
    [[ -r "$values" ]] || die "runtime.env unreadable — is the env repository git-crypt unlocked?"
    # Read value from stdin; prompt hidden when attached to a tty.
    if [[ -t 0 ]]; then
      printf '%s: ' "$key" >&2; stty -echo; IFS= read -r value; stty echo; echo >&2
      printf '%s (confirm): ' "$key" >&2; stty -echo; IFS= read -r confirm; stty echo; echo >&2
      [[ "$value" == "$confirm" ]] || die "values do not match"
    else
      IFS= read -r value
    fi
    [[ -n "$value" ]] || die "empty value for $key"

    esc="${value//\'/\'\\\'\'}"
    tmp="$(mktemp "$role_dir/.runtime.env.XXXXXX")"
    trap 'rm -f "$tmp"' EXIT
    if [[ -f "$values" ]]; then
      grep -v "^$key=" "$values" > "$tmp" || true
    fi
    printf "%s='%s'\n" "$key" "$esc" >> "$tmp"
    # keep existing sorted-ish order: write updated lines, 0600
    chmod 600 "$tmp"
    mv "$tmp" "$values"
    echo "[secret] stored $key in $profile/$role/runtime.env (git-crypt at rest; not committed)" >&2
    echo "[secret] next: review 'git -C \"$ENV_REPO\" diff' then commit the env repo, and 'make station/relay' to reconcile." >&2
    ;;

  status)
    [[ -r "$values" ]] || { echo "$profile/$role: runtime.env unreadable (git-crypt locked)"; exit 0; }
    echo "$profile/$role runtime secrets"
    echo "-------------------------------"
    if [[ ! -f "$manifest" ]]; then
      echo "(no secret-manifest.env — role declares no Class B secrets)"
      exit 0
    fi
    while IFS= read -r raw; do
      line="${raw%%#*}"; line="${line//[[:space:]]/}"
      [[ -z "$line" ]] && continue
      case "$line" in
        REQUIRED__*=1)
          k="${line#REQUIRED__}"; k="${k%%=*}"
          cls_line="$(grep "^CLASS__$k=" "$manifest" || true)"
          cls="${cls_line#CLASS__$k=}"
          v="$(awk -F= -v k="$k" '$1==k {sub(/^[^=]*=/,""); print; exit}' "$values" | sed "s/^'//; s/'\$//")"
          if [[ -n "$v" ]]; then
            printf '  %-34s %-16s %s\n' "$k" "$cls" "$(mask "$v")"
          else
            printf '  %-34s %-16s MISSING\n' "$k" "$cls"
          fi
          ;;
      esac
    done < "$manifest"
    ;;

  *) die "unknown action '$action' (use set|status)" ;;
esac
