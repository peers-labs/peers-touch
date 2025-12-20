.PHONY: fmt import vet check format style lint

fmt:
	go fmt ./...
	gofmt -s -w .

import:
	@command -v goimports >/dev/null 2>&1 || go install golang.org/x/tools/cmd/goimports@latest
	goimports -w .

vet:
	go vet ./...

check:
	@out=$$(gofmt -l .); if [ -n "$$out" ]; then echo "$$out" && exit 1; fi

style:
	bash tools/check-go-style.sh

format: fmt import

lint:
	@command -v golangci-lint >/dev/null 2>&1 || go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
	golangci-lint run
