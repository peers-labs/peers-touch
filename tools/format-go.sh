#!/usr/bin/env bash
set -euo pipefail

if ! command -v goimports >/dev/null 2>&1; then
  go install golang.org/x/tools/cmd/goimports@latest
fi

go fmt ./...
gofmt -s -w .
goimports -w .

unfmt=$(gofmt -l .)
if [ -n "$unfmt" ]; then
  echo "$unfmt"
  exit 1
fi

echo "OK"
