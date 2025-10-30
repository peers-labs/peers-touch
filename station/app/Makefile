# Makefile for peers-touch-station backend

# Go parameters
GOCMD=go
GOBUILD=$(GOCMD) build
GOCLEAN=$(GOCMD) clean
GORUN=$(GOCMD) run
GOTEST=$(GOCMD) test
GOGET=$(GOCMD) get
GOMOD=$(GOCMD) mod

# Build parameters
BINARY_NAME=peers-touch-station
BINARY_UNIX=$(BINARY_NAME)_unix

# Build flags for faster compilation
BUILD_FLAGS=-ldflags="-s -w" -trimpath
DEV_BUILD_FLAGS=-race -gcflags="-N -l"

# Parallel build settings
GOMAXPROCS?=$(shell nproc 2>/dev/null || echo 4)

.PHONY: all build clean run test deps dev-build fast-run

# Default target
all: test build

# Fast development build with optimizations
dev-build:
	@echo "Building with development optimizations..."
	GOMAXPROCS=$(GOMAXPROCS) $(GOBUILD) $(DEV_BUILD_FLAGS) -o $(BINARY_NAME) .

# Production build with size optimizations
build:
	@echo "Building production binary..."
	GOMAXPROCS=$(GOMAXPROCS) $(GOBUILD) $(BUILD_FLAGS) -o $(BINARY_NAME) .

# Fast run for development (skips some optimizations)
fast-run:
	@echo "Running with fast compilation..."
	GOMAXPROCS=$(GOMAXPROCS) $(GORUN) -gcflags="-N -l" .

# Standard run
run:
	$(GORUN) .

# Clean build artifacts
clean:
	$(GOCLEAN)
	rm -f $(BINARY_NAME)
	rm -f $(BINARY_UNIX)

# Run tests
test:
	$(GOTEST) -v ./...

# Download dependencies
deps:
	$(GOGET) -d -v ./...
	$(GOMOD) download
	$(GOMOD) verify

# Tidy dependencies
tidy:
	$(GOMOD) tidy

# Build for Linux
build-linux:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 $(GOBUILD) $(BUILD_FLAGS) -o $(BINARY_UNIX) .

# Show build info
info:
	@echo "Go version: $(shell $(GOCMD) version)"
	@echo "GOMAXPROCS: $(GOMAXPROCS)"
	@echo "Build cache: $(shell $(GOCMD) env GOCACHE)"
	@echo "Module cache: $(shell $(GOCMD) env GOMODCACHE)"

# Help
help:
	@echo "Available targets:"
	@echo "  dev-build   - Fast development build with race detection"
	@echo "  build       - Production build with optimizations"
	@echo "  fast-run    - Run with fast compilation flags"
	@echo "  run         - Standard run"
	@echo "  test        - Run tests"
	@echo "  clean       - Clean build artifacts"
	@echo "  deps        - Download dependencies"
	@echo "  tidy        - Tidy dependencies"
	@echo "  info        - Show build information"
	@echo "  help        - Show this help"