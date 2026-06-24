# peers.note Contracts

This directory documents the applet product contract. It does not replace proto source files.

## Proto Source

```text
model/domain/note/v1/note.proto
```

## Service Binding

```typescript
sdk.network.request({
  service: 'note',
  method: 'GET',
  path: '/v1/notes'
})
```

The applet frontend must not know or construct a backend base URL.

## HTTP Mapping

```text
GET    /v1/notes
GET    /v1/notes/{note_id}
POST   /v1/notes
PATCH  /v1/notes/{note_id}
DELETE /v1/notes/{note_id}
POST   /v1/notes/{note_id}:restore
GET    /v1/notes:search?q=
```

## Error Mapping

Service errors must be returned through the Station API error envelope. Applet-visible errors are normalized by Host Gateway into typed applet errors with locale message keys.
