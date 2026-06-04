# ─── Go Tooling (Station) ────────────────────────────────────────

.PHONY: fmt import vet check format style lint test-unit test-coverage

fmt:
	cd apps/station/app && go fmt ./...
	cd apps/station/app && gofmt -s -w .

import:
	@command -v goimports >/dev/null 2>&1 || go install golang.org/x/tools/cmd/goimports@latest
	cd apps/station/app && goimports -w .

vet:
	cd apps/station/app && go vet ./...

check:
	@out=$$(cd apps/station/app && gofmt -l .); if [ -n "$$out" ]; then echo "$$out" && exit 1; fi

style:
	/bin/bash tooling/scripts/check-go-style.sh

format: fmt import

lint:
	@command -v golangci-lint >/dev/null 2>&1 || go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
	cd apps/station/app && golangci-lint run

test-unit:
	@echo "Running unit tests..."
	cd apps/station/app && go test ./... -v

test-coverage:
	@echo "Generating test coverage report..."
	cd apps/station/app && go test ./... -coverprofile=coverage.out
	cd apps/station/app && go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report: apps/station/app/coverage.html"
