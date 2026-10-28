#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 "$root/tooling/distribution/installation_state_test.py"
python3 "$root/tooling/distribution/installer_test.py"
node --test "$root/tooling/distribution/release-asset-server.test.mjs"
shellcheck -S warning "$root/tooling/distribution/install.sh"
