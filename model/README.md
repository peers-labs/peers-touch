# Proto Code Generation

## Overview

This directory contains Protocol Buffer definitions for the Peers Touch project.

- **Go (Station)**: `build.sh` (macOS/Linux) or `build.ps1` (Windows)
- **Mobile (Kotlin/Swift)**: `tooling/scripts/proto-gen-mobile.sh`

Dart/Flutter generation has been removed — that path is deprecated.

## Usage

```bash
# Go generation
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

## Do NOT Manually Edit Generated Files

All `.pb.go` files are generated. Any manual changes will be overwritten on the next build.
