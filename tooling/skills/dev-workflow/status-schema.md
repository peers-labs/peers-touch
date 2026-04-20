# Dev Workflow Status Schema

The workflow state is tracked in `.dev-workflow/<session-id>/status.json`.

## Schema

```json
{
  "session_id": "YYYYMMDD-HHmmss",
  "task": {
    "title": "string — short task description",
    "description": "string — full task description from user",
    "issue_number": "number | null — linked GitHub issue"
  },
  "current_phase": "planning | coding | review | release | completion",
  "phases": {
    "planning": {
      "status": "pending | in_progress | completed | skipped",
      "started_at": "ISO 8601 | null",
      "completed_at": "ISO 8601 | null"
    },
    "coding": {
      "status": "pending | in_progress | completed | skipped",
      "started_at": "ISO 8601 | null",
      "completed_at": "ISO 8601 | null",
      "branch": "string | null",
      "commits": ["string — commit hashes"]
    },
    "review": {
      "status": "pending | in_progress | completed | skipped",
      "started_at": "ISO 8601 | null",
      "completed_at": "ISO 8601 | null",
      "pr_number": "number | null",
      "pr_url": "string | null",
      "checks_passed": "boolean | null"
    },
    "release": {
      "status": "pending | in_progress | completed | skipped",
      "started_at": "ISO 8601 | null",
      "completed_at": "ISO 8601 | null",
      "version": "string | null",
      "release_url": "string | null"
    },
    "completion": {
      "status": "pending | in_progress | completed",
      "started_at": "ISO 8601 | null",
      "completed_at": "ISO 8601 | null"
    }
  },
  "context": {
    "platforms": ["station | desktop | mobile | proto"],
    "scopes": ["string — affected module scopes"],
    "base_branch": "main"
  },
  "checkpoints": {
    "execution_plan": {
      "presented": false,
      "approved": false,
      "approved_at": "ISO 8601 | null"
    }
  },
  "history": [
    {
      "timestamp": "ISO 8601",
      "phase": "string",
      "action": "string",
      "detail": "string"
    }
  ]
}
```

## Initial State

When creating a new session:

```json
{
  "session_id": "<generated>",
  "task": { "title": "", "description": "", "issue_number": null },
  "current_phase": "planning",
  "phases": {
    "planning":   { "status": "in_progress" },
    "coding":     { "status": "pending" },
    "review":     { "status": "pending" },
    "release":    { "status": "pending" },
    "completion": { "status": "pending" }
  },
  "context": { "platforms": [], "scopes": [], "base_branch": "main" },
  "checkpoints": {
    "execution_plan": { "presented": false, "approved": false }
  },
  "history": []
}
```

## Phase Transitions

```
planning (approved) → coding → review → release (optional) → completion
                                  ↑         |
                                  └─────────┘ (if release skipped)
```

- `planning` → `coding`: Only after checkpoint approval
- `coding` → `review`: Only after commits pushed
- `review` → `release`: Only after PR merged
- `review` → `completion`: If release is skipped
- `release` → `completion`: After tag and release created
