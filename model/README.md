# Proto Code Generation

## Overview

This directory contains Protocol Buffer definitions for the Peers Touch project.

- **Go (Station) and TypeScript (Desktop)**: `build.sh` (macOS/Linux)
- **Go (Station)**: `build.ps1` (Windows)
- **Mobile (shared TypeScript)**: `tooling/scripts/proto-gen-mobile.sh web`

Dart/Flutter generation has been removed — that path is deprecated.

## Usage

```bash
# Go and Desktop TypeScript generation
./build.sh

# Shared Mobile TypeScript generation
../tooling/scripts/proto-gen-mobile.sh web
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
│   ├── chat/
│   ├── federation/
│   ├── key_exchange/
│   ├── recovery/
│   ├── social/
│   └── ...
└── README.md
```

The Conversation Authority contract family is split by resource owner:

- `domain/chat/`: Conversation commands/events, attachment, receipt, and Device Inbox contracts.
- `domain/actor/`: Actor and Actor Device identity contracts.
- `domain/key_exchange/`: Direct and MLS public-material contracts.
- `domain/recovery/`: opaque encrypted recovery revisions.
- `domain/federation/`: domain-neutral Station delivery frames.
- `domain/social/`: relationship and Friend Request contracts.

`packages/messaging-core/build.rs` compiles the portable Rust subset consumed by
Desktop and Mobile. Kotlin/Swift native plugins generate bindings only for a
typed OS capability contract that directly requires them; they do not maintain
parallel Mobile business models.

## Requirements

- `protoc` (Protocol Buffer Compiler)
- `protoc-gen-go` (Go plugin)
- `apps/desktop/node_modules/.bin/protoc-gen-es` (Desktop TypeScript plugin)
- `apps/mobile/node_modules/.bin/protoc-gen-es` (shared Mobile TypeScript plugin)
- `perl` (terminal-newline normalization on macOS/Linux)

## Do NOT Manually Edit Generated Files

All `.pb.go` and `_pb.ts` files are generated. Any manual changes will be
overwritten on the next build. `build.sh` normalizes TypeScript output to one
terminal newline so repeated generation keeps a clean worktree.
