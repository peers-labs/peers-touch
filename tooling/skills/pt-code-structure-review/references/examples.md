# Code Structure Review Examples

These examples calibrate rule interpretation. They are not templates that force
every implementation into the same layer count.

## 1. Mixed-Owner Handler

### Reject

```ts
export async function createGroup(request: Request) {
  const token = request.headers.get('authorization');
  const actor = decodeToken(token);
  if (actor.role !== 'owner') throw new Error('forbidden');
  const row = await db.insert('groups', await request.json());
  groupCache.set(row.id, row);
  await eventBus.publish({ type: 'group.created', row });
  return new Response(JSON.stringify(row));
}
```

Why it blocks:

- `STRUCT-02`: authorization and group policy have writable owners in the
  handler.
- `STRUCT-03`: transport, policy, persistence, cache, eventing, and response
  rendering are interleaved.
- `STRUCT-06`: partial failure after the insert has no explicit transaction or
  recovery semantics.
- `STRUCT-09`: policy and failure behavior require private dependency patching.

### Accept

```ts
export async function createGroupHandler(request: Request) {
  const command = parseCreateGroupRequest(request);
  const result = await createGroup.execute(command);
  return groupResponse(result);
}
```

The application service may coordinate authorization, repository, and event
ports. The split is justified because those owners and failure boundaries
already exist.

## 2. Mechanical Layering

### Reject

```ts
class AgeRuleStrategy {
  evaluate(age: number) {
    return age >= 18;
  }
}

class AgeRuleService {
  constructor(private readonly strategy = new AgeRuleStrategy()) {}
  execute(age: number) {
    return this.strategy.evaluate(age);
  }
}

class AgeRuleManager {
  constructor(private readonly service = new AgeRuleService()) {}
  run(age: number) {
    return this.service.execute(age);
  }
}
```

`STRUCT-07` blocks this when there is one fixed rule and no external boundary.
The classes add navigation and invalid construction states without owning
variability.

### Accept

```ts
export const isAdult = (age: number): boolean => age >= 18;
```

Short code is not automatically better. This is better because the domain rule
is pure, complete, and has no additional lifecycle.

## 3. Explicit Lifecycle

### Reject

```ts
export function getProfile(id: string) {
  refreshProfileInBackground(id).catch(() => undefined);
  return profileCache.get(id);
}
```

`STRUCT-06` blocks: a getter starts hidden I/O, suppresses failure, and has no
shutdown or retry owner.

### Accept

```ts
export async function refreshProfile(
  id: string,
  signal: AbortSignal,
): Promise<RefreshResult> {
  return profileRefresh.run({ id, signal });
}
```

The name, return type, and cancellation input expose the side effect.

## 4. Half Cutover

### Reject

```ts
export async function saveMessage(message: Message) {
  await newStore.save(message);
  try {
    await legacyStore.save(message);
  } catch {
    // Keep the new path working.
  }
}
```

`STRUCT-08` and `STRUCT-06` block: two writers can diverge and the fallback
suppresses the failed half of the operation.

### Acceptable Staged Migration

A dual write may pass only when an accepted migration contract names:

- the canonical writer;
- reconciliation and rollback semantics;
- bounded compatibility duration;
- divergence telemetry;
- the exact removal Gate.

The review finding must cite that contract as the applied exception.

## 5. Large Declarative Data (`STRUCT-SIGNAL-FILE-LINES`)

### Accept

```ts
export const countryCallingCodes = {
  AD: '+376',
  AE: '+971',
  // Hundreds of static entries.
} as const;
```

A file-line signal may fire. It does not establish `STRUCT-03` or `STRUCT-07`
because the file remains one cohesive, declarative mapping with no hidden
control flow.

## 6. Deep Declarative Shape (`STRUCT-SIGNAL-INDENT-DEPTH`)

A deeply nested static configuration may cross the indentation threshold while
remaining one explicit data shape. Confirm that the depth comes from
declarative structure rather than interleaved control flow, cleanup, or partial
failure. The signal alone does not establish `STRUCT-03` or `STRUCT-06`.

## 7. Change Locality

### Reject

```text
UI role switch
Gateway role switch
Service role switch
Cache warmer role switch
Report generator role switch
```

If all five switches implement the same authorization policy, `STRUCT-01`,
`STRUCT-02`, and `STRUCT-05` block. A role change has an artificial five-owner
radius.

### Accept

One domain policy returns a typed decision. Each outer layer adapts that
decision to its own protocol without restating role semantics.

## 8. Test Boundary

### Reject

```ts
export async function expireInvite(id: string) {
  if (Date.now() > globalThis.invites[id].expiresAt) {
    await fetch(`/internal/invites/${id}`, { method: 'DELETE' });
  }
}
```

`STRUCT-09` blocks because time, state, and network are uncontrolled globals.
`STRUCT-06` also applies because failure and retry behavior are hidden.

### Accept

```ts
export function expireInvite(
  invite: Invite,
  now: Instant,
): ExpiryDecision {
  return now.isAfter(invite.expiresAt)
    ? { kind: 'expire', inviteId: invite.id }
    : { kind: 'keep' };
}
```

An application owner performs the resulting deletion through an injected port.

## 9. Import Fan-Out (`STRUCT-SIGNAL-IMPORT-FANOUT`)

A composition root may import many concrete owners in order to construct the
application graph. Confirm that it only wires dependencies and does not own
their policies. Unique dependency fan-out alone does not establish
`STRUCT-03`, `STRUCT-04`, or `STRUCT-05`.

## 10. Non-Blocking Taste

The following do not block without a concrete rule consequence:

- renaming `result` to `response`;
- splitting one cohesive 140-line file into two files;
- replacing a clear `switch` with a dispatch map;
- introducing or removing a private helper;
- changing import order;
- preferring classes over functions, or functions over classes.

Record such feedback as `PASS_WITH_SUGGESTIONS` only when it offers a concrete,
local improvement. Otherwise return `PASS`.
