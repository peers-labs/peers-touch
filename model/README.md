# Proto Code Generation

## Overview

This directory contains Protocol Buffer definitions for the Peers Touch project.

- **Go (Station) and TypeScript (Desktop)**: `build.sh` (macOS/Linux)
- **Go (Station)**: `build.ps1` (Windows)
- **Mobile (Kotlin/Swift)**: `tooling/scripts/proto-gen-mobile.sh`

Dart/Flutter generation has been removed — that path is deprecated.

## Usage

```bash
# Go and Desktop TypeScript generation
./build.sh

# Mobile generation (Kotlin + Swift)
../tooling/scripts/proto-gen-mobile.sh
```

## Directory Structure

```
model/
├── build.sh              # Go generation script (macOS/Linux)
├── build.ps1             # Go generation script (Windows)
├── domain/               # Business domain protos
│   ├── actor/
│   ├── agent/
│   ├── ai_chat/
│   └── ...
└── README.md
```

## Requirements

- `protoc` (Protocol Buffer Compiler)
- `protoc-gen-go` (Go plugin)
- `apps/desktop/node_modules/.bin/protoc-gen-es` (Desktop TypeScript plugin)
- `perl` (terminal-newline normalization on macOS/Linux)

## Do NOT Manually Edit Generated Files

All `.pb.go` and `_pb.ts` files are generated. Any manual changes will be
overwritten on the next build. `build.sh` normalizes TypeScript output to one
terminal newline so repeated generation keeps a clean worktree.
