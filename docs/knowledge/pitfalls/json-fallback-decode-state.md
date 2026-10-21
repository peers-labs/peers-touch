---
kind: pitfall
title: JSON fallback decoders must isolate destination state
status: active
owns:
  - apps/station/app/subserver/social/infrastructure/secure_content_reset_store.go
referenced-by:
  - docs/knowledge/README.md
related:
  - docs/architecture/shared/security/secure-content/decisions.md
detected: 2026-10-18
---

# JSON fallback decoders must isolate destination state

## Symptom

The `fiveArm` Secure Content schema pre-audit rejected a valid structured
public Image attachment with `RESET_OBJECT_REFERENCE_AMBIGUOUS: empty`.
No reset mutation ran.

## Root cause

Go's JSON decoder may partially populate its destination before returning a
type error. The reset owner first tried the legacy `[]string` shape, then
reused that partially populated slice while parsing the structured attachment
shape. The residual empty string was later validated as an OSS key.

## Mitigation

### What was done in code

- Each reviewed JSON shape decodes into its own destination.
- The structured attachment branch creates its identifier list only after its
  decode succeeds.
- Empty or malformed identifiers remain rejected; the fix does not weaken the
  object-reference allowlist.

### What guards against regression

`TestExtractLegacyAttachmentKeysIsolatesFallbackDecodeState` uses the current
structured Image attachment shape and requires the exact canonical OSS key.

## How to detect a recurrence

```bash
cd apps/station
go test ./app/subserver/social/infrastructure \
  -run TestExtractLegacyAttachmentKeysIsolatesFallbackDecodeState
```

Review fallback parsers for destinations reused after a failed decode.

## Crosswalks

- SC-D23 requires unknown object-reference shapes to fail before reset.
- The safe fix isolates parser state without accepting an unknown shape.
