---
kind: pitfall
title: Desktop message projection copies drift across commands
status: active
owns:
  - apps/desktop/src-tauri/src/interface/tauri_commands/messaging.rs
  - apps/desktop/src/services/im-service.ts
  - apps/desktop/src/services/im-service.test.ts
referenced-by:
  - docs/knowledge/README.md
related:
  - docs/architecture/domains/chat/messaging/design.md
detected: 2026-10-14
---

# Desktop message projection copies drift across commands

## Symptom

Opening a real Native Desktop interaction thread failed after the thread reply
had already committed and synchronized:

```text
undefined is not an object (evaluating 'message.mentions.map')
```

The root row reported one reply on both clients, but the thread panel could not
render it. Local message search had the same latent failure shape.

## Root cause

Paged history used one Rust message serializer while thread and search commands
maintained separate inline JSON copies. Adding typed mention metadata updated
the primary serializer and the TypeScript projection, but the copied command
serializers omitted `mentions` and `mention_all`. The unchecked Tauri generic
claimed those fields existed, so TypeScript reached `undefined.map` at runtime.

## Mitigation

### What was done in code

- Replaced hand-built message JSON with
  `MessagingMessageProjectionOutput`, one typed Rust `Serialize` DTO.
- Routed conversation summary, history, thread, and search through the same DTO
  conversion.
- Replaced the trusted TypeScript cast with `parseMessagingMessageWire`, one
  fail-closed runtime decoder shared by every retrieval path.
- Deleted the duplicated thread, search, message, attachment, mention, and
  reaction serializers.

### What guards against regression

- Rust test
  `message_projection_output_is_the_complete_renderer_contract` verifies the
  complete serialized shape, including mention metadata.
- `apps/desktop/src/services/im-service.test.ts` runs the same decoder against
  history, thread, and search, and proves missing mention metadata fails closed.
- Native Chat thread and Direct lifecycle Gates retain real Thread and Search
  product journeys.

## How to detect a recurrence

Run:

```bash
rg -n 'message_projection_json|attachment_projection_json' \
  apps/desktop/src-tauri/src/interface/tauri_commands/messaging.rs

cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml \
  --bin peers-touch-desktop \
  message_projection_output_is_the_complete_renderer_contract

pnpm --dir apps/desktop exec vitest run src/services/im-service.test.ts
```

The grep must return no hits. New message retrieval commands must return
`MessagingMessageProjectionOutput` and pass values through
`parseMessagingMessageWire`; they must not define another message wire mapper.

## Crosswalks

- `docs/architecture/domains/chat/messaging/design.md` defines the canonical
  Desktop renderer projection boundary.
