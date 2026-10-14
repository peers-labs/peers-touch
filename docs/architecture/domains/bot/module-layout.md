# Bot Module Layout

```text
model/domain/bot/bot.proto
apps/station/app/subserver/bot/
  application/registry/
  domain/
  infrastructure/
  handler_management.go
  subserver.go
```

The module intentionally has no ingress, normalization, limiter, delivery sink,
system-grant store, or event DTO. Those owners live under:

```text
model/domain/chat/{content,publishing,command}.proto
apps/station/app/subserver/conversation/application/publishing/
apps/station/app/subserver/conversation/infrastructure/persistence/
```
