#!/usr/bin/env bash
set -euo pipefail

test -n "${PT_ACCEPTANCE_ARTIFACT_ROOT:-}" || {
  echo "PT_ACCEPTANCE_ARTIFACT_ROOT is required" >&2
  exit 2
}

handoff_root="${PT_AGENT_V2_HANDOFF_ROOT:-$(mktemp -d)}"
test_mode="${PT_AGENT_V2_COMMAND_MODE:-real}"
fail_at="${PT_AGENT_V2_FAIL_AT:-}"

cleanup() {
  rm -rf "$handoff_root"
}
trap cleanup EXIT
mkdir -p "$handoff_root"

maybe_fail() {
  local stage="$1"
  if [[ "$fail_at" == "$stage" ]]; then
    echo "injected Agent V2 final-proof failure at $stage" >&2
    return 97
  fi
}

gates=(
  agent-v2-kernel-foundation-e2e
  agent-v2-home-command-center-e2e
  agent-v2-capability-binding-e2e
  agent-v2-governed-tool-loop-e2e
  agent-v2-mcp-lifecycle-e2e
  agent-v2-connector-invocation-e2e
  agent-v2-evaluation-lab-e2e
)

for gate in "${gates[@]}"; do
  maybe_fail gate
  envelope="$handoff_root/$gate.json"
  if [[ "$test_mode" == "noop" ]]; then
    printf '{"gateId":"%s"}\n' "$gate" > "$envelope"
  else
    python3 tooling/scripts/acceptance-prove.py \
      --gate "$gate" \
      --proof-envelope-ref-out "$envelope"
  fi
  maybe_fail proof-envelope
  test -s "$envelope"
done

maybe_fail proof-set
if [[ "$test_mode" == "noop" ]]; then
  printf '{"artifactKind":"agent-v2-proof-set-ref"}\n' \
    > "$handoff_root/proof-set-ref.json"
  printf '%064d\n' 0 > "$handoff_root/proof-set.sha256"
else
  proof_args=()
  for gate in "${gates[@]}"; do
    proof_args+=(
      --proof-envelope-ref-file
      "$handoff_root/$gate.json"
    )
  done
  python3 tooling/scripts/acceptance-proof-set.py \
    "${proof_args[@]}" \
    --proof-set-ref-out "$handoff_root/proof-set-ref.json" \
    --proof-set-sha-out "$handoff_root/proof-set.sha256"
fi

maybe_fail proof-set-validation
if [[ "$test_mode" != "noop" ]]; then
  python3 tooling/scripts/acceptance-validate.py \
    --validate-agent-v2-proof-set \
    --proof-set-ref-file "$handoff_root/proof-set-ref.json" \
    --proof-set-manifest-sha256 "$(
      cat "$handoff_root/proof-set.sha256"
    )"
fi

maybe_fail d11
if [[ "$test_mode" != "noop" ]]; then
  python3 tooling/scripts/review/agent-d11-entrypoints.py
fi

maybe_fail locale
if [[ "$test_mode" != "noop" ]]; then
  node tooling/scripts/check-agent-v2-locales.mjs
fi

maybe_fail hard-rules
if [[ "$test_mode" != "noop" ]]; then
  tooling/scripts/review/hard-rules.sh
fi

trap - EXIT
cleanup
