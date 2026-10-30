# AI Provider Control Plane

Station's existing Dashboard is the administrator entry point for Provider,
model, credential, access and CLI installation management. Agent remains the
business owner. Dashboard authenticates administrators with its own session
and delegates through an Agent management port; actor JWTs never authorize
shared resource mutations.

## Resource ownership

Provider, model and credential records have explicit `actor` or `station`
ownership. Station records have no actor owner. Existing personal records
remain private and are consumed only when the administrator enables personal
Providers. Managed deployments disable that policy by default.

Shared and personal resources use the same Provider services and model
contracts. A shared Provider ID takes precedence over a personal record with
the same ID; preferences continue to use `(provider_id, model_id)`. No
credentials, commands or installation details belong in the ordinary
consumer projection.

Administrators configure an allow list per Provider. Each grant names a model
or all models and a specific actor PTID or all authenticated actors. No grant
means no use. Provider disable, model disable and grant revocation are checked
again before each dispatch, including resumed and committed tool
continuations. A running upstream request may finish; later dispatches cannot
reuse revoked authority.

Unconfigured catalog entries remain readable in the administrator editor with
empty grants and revision zero. Reads never materialize a Provider. Save the
Provider configuration before writing its access grants.

Custom model configuration requires a supported context window greater than
one token. Zero is a catalog inheritance marker only when that exact catalog
model supplies a valid window. Invalid explicit create or update values fail
before persistence; partial updates preserve the existing context. The
administrator model editor requires the model's supported token count rather
than silently creating an unusable model.

## Execution authority

The consumer catalog, runtime admission and Provider dispatch resolve the same
effective owner. Models, runtime discovery snapshots and credential records
are loaded for that owner. Session, conversation, workspace and preferences
always retain the requesting actor.

Runtime snapshots retain the effective Provider revision and capability
source. Provider and credential changes invalidate stale snapshots. Access is
revalidated separately so revocation does not depend on a client refresh.
Queries by storage UUID must verify both the logical Provider identity and
the authorized owner.

Credentials are write only in the control plane and encrypted at rest using
the existing Station secret envelope and KEK provider. Agent owns persistence
of its encrypted envelopes. Neither administrator read projections nor actor
APIs return decrypted shared credentials. Missing or unusable KEK fails closed.

Container deployments explicitly pass `PT_SECRET_KEK` or `PT_SECRET_KEK_FILE`
through the Station Compose service. The deployment secret store owns stable
key material outside source control; a configured file must be available in a
persistent or secret mount. Preserve the same key across recreation and database
restoration. Startup migrates legacy Provider credentials to encrypted envelopes
and refuses to start if that migration requires an unavailable key.

## CLI ownership

One Station installation owns the managed Node runtime, tool packages and
executable wrappers. Installation is independent of actor identity and
authorization. Only administrators start jobs. Jobs are deduplicated per
adapter, report monotonic phase progress, verify staged binaries and activate
them atomically. Failed installation preserves the previously active version.

Execution and discovery use isolated HOME, XDG, tool configuration, cache and
temporary directories. Shared wrappers do not set HOME. The executor builds
an explicit environment and never inherits the Station account's login or
Provider credentials. Machine PATH binaries follow the same execution
isolation rules. These directories isolate application state; they do not
constitute an operating system sandbox against hostile executable code.

The administrator UI retains TRAE CLI, Codex, Cursor and Claude Code. Missing
adapters expose install actions, the option background shows progress, and
failure exposes retry plus an official installation link. TRAE remains manual
until an accepted installer is available.

## Desktop and Federation

Ordinary Desktop Settings exposes authorized Providers and models as read
only consumption data. Default model and session parameters are personal.
Personal Provider management is available only under the Station policy.
Installation, shared credential editing and access management have no
ordinary Desktop command path.

Federation management belongs in Dashboard. Desktop's internal Federation
runtime may consume topology and identity projections for communication, but
Settings exposes no Federation management section.

The existing Station runtime default is the account scoped authority.
Desktop's app global `model-registry.json` must not remain a default selection
source. Account switches clear stale projections and discard late responses.

## Verification obligations

Verify only affected functionality: administrator authentication and mutation,
consumer allow lists, actual shared Provider dispatch, UUID ownership,
model-specific denial, grant revocation, stale revision rejection, personal
policy, account defaults, CLI HOME/cache separation, installer progress and
failure recovery, and wide/narrow management layouts. Source checks and
functional observations are reported separately.
