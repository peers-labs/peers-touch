# Message Publishing Acceptance Plan Review

Review the frozen Plan Version at
`docs/architecture/domains/chat/messaging/execution-plans/20261015-message-publishing-acceptance-v4/plan.md`
and its four Task Slices.

Use these sources:

- `docs/architecture/domains/chat/messaging/message-publishing.md`
- `docs/architecture/domains/chat/messaging/design.md`
- `docs/architecture/domains/chat/messaging/decisions.md`
- `docs/architecture/domains/bot/product-definition.md`
- `docs/architecture/domains/bot/design.md`
- `docs/architecture/domains/bot/decisions.md`
- `docs/architecture/domains/bot/integration.md`
- `docs/api/message-publishing.md`
- `docs/architecture/engineering/acceptance/design.md`
- `docs/architecture/engineering/acceptance/decisions.md`

Check:

1. Each Task closes one vertical dependency boundary and is small enough to
   finish as one bounded execution.
2. Conversation remains the sole publishing, receipt, notification-row, and
   delivery owner; Bot remains an optional product identity only.
3. The owner-only v1 public product does not accidentally gain multi-target
   grant management. Default-change replay is proved as a conditional Station
   receipt invariant.
4. The runtime topology is exactly one Station and one macOS Native owner
   client, with one Suite provisioning run and attach-only scenarios.
5. Source, functional, and formal evidence remain distinct; HTTP or Station
   readback never replaces native receiver evidence.
6. Registry narrowing does not suppress legitimate Chat impact or select the
   unrelated two-Station matrix; bounded completion proves the dedicated
   capability while full Chat Domain proof stays in `full`.
7. Security, replay, notification, aggregation, restart, partial-history,
   locate, human-chat regression, and cleanup obligations are complete.
8. Scope, non-goals, authorization, deletion, and unproven platform claims are
   explicit.

Return findings first, ordered by severity with file and contract references,
then one verdict: `PASS`, `CONDITIONAL_PASS`, or `CHANGES_REQUIRED`.
