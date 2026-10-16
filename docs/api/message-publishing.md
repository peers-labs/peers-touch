# Message Publishing API

> Status: current
> Architecture: [Message Publishing And Event Aggregation](../architecture/domains/chat/messaging/message-publishing.md)

Scripts, CI, tools, services, and Bots publish through the same API. A Bot
registration is optional. The owner creates a publishing grant through the
authenticated management API and receives its secret once.

## Publish

```http
POST /message-ingress/{publishing_id}
Authorization: Bearer {secret}
Content-Type: application/json
Idempotency-Key: {stable-command-id}
```

The body is proto-JSON for `PublishMessageRequest`.

```json
{
  "content": {
    "text": {
      "text": "Build passed"
    }
  },
  "source_context": {
    "program": "ci",
    "workspace": "peers-touch"
  }
}
```

Structured task event:

```json
{
  "command_id": "build-284-state-7",
  "content": {
    "event": {
      "event_type": "ci.build.state",
      "source_event_id": "build-284",
      "subject": {
        "kind": "build",
        "id": "284",
        "execution_id": "attempt-7"
      },
      "severity": "MESSAGE_EVENT_SEVERITY_INFO",
      "title": "Build passed",
      "task_state": {
        "revision": "3",
        "state": "REPORTED_TASK_STATE_COMPLETED"
      }
    }
  }
}
```

`Idempotency-Key` and `command_id`, when both supplied, must match. Omitted
targets resolve to the grant default only on the first submission. Replay uses
the frozen original target.

Response:

```json
{
  "command_id": "build-284-state-7",
  "message_id": "publishing-message:...",
  "conversation_id": "...",
  "conversation_event_id": "...",
  "event_sequence": "42",
  "outcome": "PUBLISH_MESSAGE_OUTCOME_ACCEPTED"
}
```

Replay returns the same committed identifiers with
`PUBLISH_MESSAGE_OUTCOME_REPLAYED`.

## Management

JWT-authenticated owner endpoints:

- `POST /message-publishing/grants/create`
- `POST /message-publishing/grants/list`
- `POST /message-publishing/grants/rotate-secret`
- `POST /message-publishing/grants/revoke`

Bot management delegates to these same grants.

## Errors

- `400`: malformed or unsupported content
- `401`: unknown, expired, revoked, disabled, or invalid credential
- `404`: owner-scoped management resource not found
- `409`: idempotency conflict or incompatible committed target
- `413`: request exceeds the edge limit
- `429`: per-grant rate limit exhausted
- `500`: internal publication failure

Credential failures are deliberately indistinguishable. Clients should use a
short timeout and retain the same command ID when retrying a lost response.
