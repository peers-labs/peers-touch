---
kind: pitfall
title: Native selected file previews require exact asset authorization
status: active
owns:
  - apps/desktop/src-tauri/src/interface/tauri_commands/mod.rs
  - apps/desktop/src-tauri/src/interface/tauri_commands/profile.rs
  - apps/desktop/src-tauri/src/interface/tauri_commands/oss.rs
  - apps/desktop/src-tauri/src/interface/tauri_commands/messaging.rs
referenced-by: []
related:
  - docs/client/desktop/base.md
detected: 2026-10-25
---

# Native selected file preview authorization

## Symptom

The native background picker returned a real selected PNG, and upload recovery
completed, but its `convertFileSrc` preview returned HTTP 403 with zero bytes.
The same PNG decoded from an inline source. Both a rewritten selected file and
a newly selected file were rejected; resource caching was not the cause.

## Root cause

The static Tauri asset scope is empty. Startup grants application-owned cache
directories, but the Profile and OSS pickers omitted the selected-file grant.

## Mitigation

`interface::tauri_commands::allow_file_preview` owns the exact-file Tauri SDK
grant for selected files and materialized Messaging previews. Profile image,
generic OSS file and Social image pickers call it before returning success.
SDK errors propagate; no caller grants a selected file's directory.

## How to detect a recurrence

Run the source ownership check from the selected worktree:

```bash
.local/acceptance/python-venv/bin/python3 -m unittest \
  tooling.acceptance.gates.chat.native_product_closure_static_test.NativeProductClosureStaticTests.test_product_file_controls_share_the_visible_user_path
```

Use a current-source Native Runtime Cell and its qualified process-scoped
chooser. Observe HTTP 200 and actual PNG decoding for a valid selected file,
retry after an empty selection, and a fresh selected file. Stage a neighboring
file without selecting it and require HTTP 403 with no image decoding.
Exercise Profile and both OSS picker paths. Keep this supporting experiment
separate from the complete native Chat product Gate.
