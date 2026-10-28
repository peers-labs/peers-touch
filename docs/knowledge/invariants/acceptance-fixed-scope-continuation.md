---
kind: invariant
title: Fixed Acceptance scope retains original proof across bounded requests
status: active
owns:
  - tooling/acceptance/core/execution_graph.py
  - tooling/acceptance/core/execution_budget.py
  - tooling/acceptance/core/scope_ownership.py
  - tooling/acceptance/core/execution_session.py
  - tooling/acceptance/core/execution_identity.py
  - tooling/acceptance/core/input_artifacts.py
  - tooling/acceptance/input_owners/
  - tooling/acceptance/tests/test_execution_identity.py
  - tooling/acceptance/tests/test_input_artifact_lifecycle.py
  - tooling/acceptance/tests/test_scope_ownership.py
  - tooling/acceptance/tests/test_machine_dev_input_owner.py
  - tooling/acceptance/tests/test_workflow_input_owner.py
  - tooling/acceptance/core/operation_observer.py
  - tooling/acceptance/core/evidence_store.py
  - tooling/acceptance/core/proof.py
  - tooling/acceptance/core/evidence.py
  - tooling/acceptance/core/gate.py
  - tooling/acceptance/core/redaction.py
  - tooling/acceptance/station_access_evidence.py
  - tooling/acceptance/tests/test_prerequisite_aggregate_contract.py
  - tooling/acceptance/tests/test_go_source_input_owner.py
  - tooling/acceptance/gates.yaml
  - tooling/scripts/acceptance-run.py
  - tooling/scripts/acceptance-plan.py
  - tooling/scripts/acceptance-validate.py
  - tooling/scripts/acceptance-report.py
  - tooling/scripts/acceptance-gap-detect.py
  - tooling/scripts/acceptance-coverage-report.py
related:
  - docs/architecture/engineering/acceptance/execution-budget.md
  - docs/knowledge/invariants/acceptance-scope-is-runner-owned.md
  - docs/knowledge/invariants/acceptance-suite-runtime-reuse.md
detected: 2026-10-23
---

# Fixed Acceptance scope and original proof

E2E preparation uses the same fixed graph; its source/Catalog/implementation
checks and manual entry contract are owned by
[e2e-execution-hook.md](../../architecture/engineering/acceptance/e2e-execution-hook.md).
Development prerequisite validation reads the current request's original
functional manifest and inventory, checks current source, result and cleanup,
and retains `NOT_APPLICABLE`. It cannot consume formal proof as functional
completion or promote a functional result to formal `PROVEN`.

## What must hold

The unique Runner resolves the complete required scope before execution.
Domain exclusions resolve every registered Capability, Feature product area
and capability relationship, Registry requirement and Domain validation Gate.
The selected catalog supplies its own contracts. Domain profiles consume
capabilities without reassigning their owner domain; shared Infra remains
included. Unresolved Feature references remain explicit registration gaps,
never inferred domain ownership from a Gate or command prefix.
Scope artifacts retain every ownership source and all contract digests.
Correcting a scope-resolution defect must preserve the old Session and
obligation ledger. A different resolved set requires an explicit per-Gate
reconciliation against the existing exclusion authorization and a fresh
Session with the unchanged policy and no proof transfer; resume cannot
silently shrink the original set.
Only explicit dependsOn creates a proof dependency; equal commands or environment
names never authorize reuse. The compiler rejects cycles, missing or excluded
dependencies and repeated selections. Structural prerequisite judgments retain
the original producer identity and cannot replace native/UI/receiver/negative proof.

A Session retains the full scope, graph, source and policy across finite requests.
Only a unique request-work expiry with successful owned cleanup permits one explicit
new bounded request. Every other result must be DONE/PROVEN or the original
undispatched stop projection with no acquired run or measured work. An earlier
failure, prerequisite block or incomplete proof requires repair even when the request
later expires. Operation, mixed, cleanup or publication expiry still requires
qualified owner repair; UNKNOWN remains NEEDS_JUDGMENT. No auto-extension or infinite
continuation is allowed. The cancelled Gate restarts its full entry and windows.
The OS lock and single-use request sequence reject concurrent or stale continuation.
A crash without actual cleanup proof cannot resume.

Prior completion is a reference to the original DURABLE producer, never a copied
report. Reuse revalidates complete inventory/hash, source, definition, policy,
current runtime/provider/oracle/action-plan contract, DONE/PROVEN and cleanup.
Missing identities or invalid references return the item to pending scope. Source
change invalidates all old proof. Failed, blocked or cancelled work remains unproven.
Every report accounts for the full required set and separates validation, origin
cost and actual dispatch; absence of a manifest cannot be repaired by a PASS label.
Each request begins with the full dispatch set and zero validated Gates. Original
proof revalidation belongs to each Gate entry after source capture and before new
run acquisition, never to a global barrier. After complete validation and stable
source readback, Session record_reuse moves exactly that pending Gate to validated.
First requests, repaired or changed candidates, duplicate and incomplete results
cannot make this transition. Accepted validation cost is not new dispatch cost.

Deterministic local reuse requires an owner-declared closed executionInputs contract.
The child inherits only the standard tool environment and declared environmentKeys,
whose actual values are hashed per Gate; Runner injects artifact/authority context.
Unrelated observer variables cannot invalidate qualified proof. Changed declared input
invalidates that Gate and its consumers. Additional material inputs require an owner
identityProbe with exact owner/argv/timeout and a closed Gate/Owner observation binding
runtime, provider, oracle, action-plan and fixture digests. Runner observes after
existing equipment succeeds and before product command, after cleanup before
sealing, and on resume. Actual same-run Environment/Runtime Cell references and
original prerequisite proofs form one immutable input-artifacts record.
Workspace/Gate/run/path, complete inventory membership and hashes must qualify.
Post-cleanup and resume retain those original refs, never reprovision or replace
them with current latest. The concrete Owner verifies material current inputs
alongside original equipment; an old READY record cannot prove current runtime.
The read-only probe receives no credentials, lease descriptors or capabilities.
Drift prevents current-input proof.
Probe output contains no raw configuration, credentials, endpoint or device handle.
The existing launcher owns its children under the original deadline. Probes are read-only;
they cannot provision, reset, extend a lease, authorize a resource or renew time.
Current probes are run only after original completion and prerequisite validation.
Live or opaque inputs without a qualified owner remain fresh. Source input owners must
bind actual tools and declared installed dependency code; dependency links escaping
the declared installation boundary remain unqualified, never traverse build directories.
Source owners reject non-local, provisioned, Runtime Cell and ephemeral inputs.
Domain/Infra structural validation must not read latest or current runtime proof.
Only requested proof assessment consumes the existing fail-closed evidence reader.
Structure reports use not-evaluated and null missing-gate fields, never empty
sets that could imply zero proof gaps. The capability validator rejects proof
sets in structure mode and missing proof sets in proof mode. Qualified structure
Gates bind their actual Python/sh tools and PyYAML installation; that source
qualification never supplies product proof.
Concrete source qualification binds the real Python executable, stdlib,
explicitly selected installed package code/metadata/bytecode and effective
import paths. Actual loaded native libraries and OS build are inputs; an
unsupported platform remains unqualified. Unknown script/shim delegates or
unclosed package dependencies cannot qualify by wrapper or version alone.
The installed Python Owner resolves distribution requirements with the
installed `packaging` parser, itself included in the closure. Platform markers,
version constraints and inherited extras must resolve actual installed code
and metadata; missing, incompatible, direct-URL or shared namespace inputs
reject qualification. Single-file modules also bind actual cached bytecode
or its absence. Material package drift invalidates the original proof.
System Make needs its actual developer-tool delegate and libraries, not just
the native launcher. Self-validation temporary fixtures can qualify only
after their real tools and packages are closed; complete command and cleanup
proof remain required. No partial unittest completion is a passed Gate.
The concrete Node source owner additionally binds actual native Node and
libraries, exact repository import origins, resolved package roots, manifests
and transitive code. Optional absence and resolution paths are material inputs.
It must not scan all workspace node_modules or admit escaping package links,
native addons, configured loaders or other unqualified toolchains. A Gate
requiring pnpm, Cargo, Go or live host state stays fresh without its own closure;
empty environmentKeys cannot stand in for that missing identity.
MachineDev's original self-check and its Runner regression use their concrete
Owner for actual tools, temporary parent identity/permissions, negative port
and all canonical Station candidate port states through the original APIs.
Generic Node closure cannot substitute for these host inputs. Observation sends
no application request, holds no listener and reads no real Profile/registry.
The full unchanged MachineDev command and original cleanup still decide proof.
Changed port state changes oracle/fixture identity; changed commands or product
equipment cannot enter this two-command self-check boundary.
The architecture metadata Owner is limited to the reviewed registry command.
It additionally binds the real pnpm installation and loaded module/library
images, effective configuration and workspace metadata, rustup proxy/settings,
current and temporary fixture parent Cargo delegates and libraries, actual
configuration include bytes/absence and both client no-deps metadata results.
Gate and probe explicitly disable Node compile caches and automatic pnpm
package-manager switching, including temporary fixtures. Native pnpm inputs need
their actual process image observation; a generic Node source probe cannot
admit them. Package-manager redirection, external pnpm hooks, fixture-specific
rustup overrides and unsupported configuration include forms reject
qualification. This closure never grants build, Go, Profile or live input reuse.
The native image Owner indexes each accepted image basename once within the
current bounded observation. Delayed transitions consult only those already
accepted names. This local derived set does not retain installation identities
between calls, change output, skip bytes or admit unknown delayed images.
Installed pnpm bin environment observations accept only the reviewed Node shell
template and its actual installed manifest/bin pair. The requested real bin
reports its inherited cwd, PATH, injected NODE_PATH, Node image and globalPaths,
then exits before tool code executes. Lookup names, links, file bytes, absence
and broken links are material environment inputs; unselected package directory
contents remain unqualified and are not recursively scanned. Unknown templates,
other Node/bin selections or observation drift reject. This environment-only
record cannot grant tool execution, native addon, generated workspace output,
build receipt or Gate qualification.
Concrete tool-version observations preserve the original pnpm/Node cache
selection and actual bin NODE_PATH. Native and pnpm platform observations retain
every actual OS field as JSON-native arrays before persistence. Exact JSON
roundtrip equality is required; digest equality cannot replace full build
receipt identity, and consumers cannot coerce old receipts. Real native
producer output must exercise unchanged build reuse and material drift.
Synchronous resolution/load hooks retain
actual loaded CJS/ESM file bytes and optional resolution failures; the delegated
dlopen call supplies native addon/library samples. Native-load samples cannot
be relabeled exit, and nonzero commands remain nonzero. Concurrent sample
fragments bind actual PID/thread, sample sequence, fragment sequence and full
sample hash. Each complete pipe write stays within the POSIX 512-byte atomic
bound; no shared mutex may survive a terminated Worker. The sole consumer
rejects missing, duplicate, changed or identity-mismatched fragments. Original
two-second output protection, process deadline and output bounds stay fixed;
transport integrity does not grant input completeness.
Post-load observations retain present, absent, changed or unreadable state
alongside loaded file/source hashes. A producer's temporary-file deletion
cannot throw from terminal sampling or replace the actual exit. A lifetime
gap marks the sample incomplete; the version helper rejects it instead of
granting generated-output provenance. Real deletion and restored-mtime
mutation regressions must preserve terminal samples and qualification refusal.
Each sample binds actual PID and thread identity. Node thread data carries the
same-PID caller entry into its asynchronous internal loader, which has no CLI
argv[1]. Keep explicit incomplete initialization/registration samples and end
synchronous loading observation before the unchanged asynchronous registration:
valid async CommonJS null source cannot pass Node's synchronous hook validator.
The same public asynchronous adapter observes actual registrar modules and
dependencies before the original unchanged registration, then restores runtime
observation in finally, including after original registration errors.
AsyncLocalStorage suppresses inner observations only within the same delegated
resolve/load chain; repeated registration records the final actual result once,
never intermediate transformations. Registrar and runtime inventories share
one byte-recording owner and the original 4096-entry bound. It verifies pre/post
file bytes for both sync and async loads. Each async event contains only that
actual load and uses the existing
bounded atomic output; no cumulative per-load full-inventory emission. Real
transferred options, transformed-source hashes, null-source CJS, cache selection
and original exits must remain unchanged. The public resolve adapter awaits
the original nextResolve with the same context and preserves its result/error
object. The unique CJS Owner emits one actual resolution or failure, retaining
specifier, parent URL, result URL/conditions or original error code. Resolution
and failure share the existing 8192-item inventory and fixed output protection.
No cumulative modules or failures are resent for these events. Real default
and custom resolution failures must retain original errors and exits; actual
loads may link to prior same-PID/thread/entry resolution. Registrar byte samples
remain incomplete. Real repeated registration, unchanged result, failure before
and after normal registration, transform, CJS null-source and exit regressions
must pass without duplicate runtime events or altered original errors.
Registration lifetime, internal-loader termination, compiler and cache
provenance remain incomplete; partial async input
records never grant complete tool, build or Gate qualification.
An ordinary Worker inherits the real same-PID caller and separate actual file
entry through Node's constructor-time thread-data snapshot. Restore caller
data immediately after the unchanged constructor. Creation, initialization
and terminal samples stay incomplete; a thread is not a separately allowed
CLI. Real workerData/result and exit tests must observe this boundary.
Ordinary Worker synchronous hooks retain actual loaded file/source bytes and
terminal file presence without installing synchronous hooks in the internal
asynchronous loader. Material loading does not close forced termination or
change incomplete/cache qualification. Preserve transferred arguments,
workerData, async CJS null-source behavior and original zero/nonzero exits.
Additional actual formats, including native TypeScript, retain format and
loaded bytes without interrupting the tool; unclosed compiler provenance stays
incomplete. Real transferred options, transformed ESM, async null-source CJS
and original zero/nonzero exits must preserve cache selection and reject
complete input qualification. A missing loader lifetime cannot become a
complete main-process sample.
This unregistered supporting observer reads only loaded files and explicitly
keeps full tool/cache/build qualification UNPROVEN; version imports cannot stand
in for complete build/config or generated-workspace producer closure.
The full development-workflow command has its own concrete Owner. It reuses
the metadata-only pnpm/Cargo observations and binds actual shell utilities,
the reviewed macOS SHA-256 stdin filter's real Perl interpreter, imported
module bytes and resolution, and native XS images/libraries. Unknown checksum
selections and configured Perl loaders reject; a wrapper hash is insufficient.
Actual temporary-parent permissions/identity, disposable Git configuration and
initialization templates are fixture inputs. Every workflow fixture disables
machine Hooks before its first commit. Conditional Git configuration, signing
and fsmonitor execution require another Owner. Original Node/Plan/skill-check
checks, ten-second probe and cleanup stay intact; no Profile, product equipment
or ephemeral input receives this qualification.
Git enumeration additionally binds its actual toolchain delegate, hashed
configuration and local exclusion file. Only an exact sysconfig-owned Python
framework file may cross an installation-tree link boundary; no external
directory or workspace build tree is admitted by that file exception.
Installation traversal carries each resolved parent and reads entry metadata
once; only symbolic links resolve their target. Current names, bytes, modes,
bytecode, links, exclusions and repeated-target references remain in the digest.
An optimization must prove identical installed-tree digests and rejection
boundaries, without retaining an inventory cache or increasing probe limits.
The installation Owner alone owns four full-byte reader threads and at most
eight submitted, unconsumed reader tasks, each reading at most 32 files in
sequence. Every file still contributes its actual complete bytes; task grouping
does not cache identities or skip reads. Inventory traversal stays sorted and
single-owner; deterministic reduction preserves link and reference identity.
Success, read failure, boundary rejection and cancellation cancel queued work
and join active readers before returning. No worker may outlive its observation.
Same-size and restored-mtime file mutation must still change material identity.
Successful probe termination remains in the current work/publish phase. Request
cancellation unwinds work before using the Gate's original fixed cleanup tail.
Concrete source owners reuse the bounded OperationObserver for installation,
platform, executable and configuration stages. These samples never renew the
parent probe timeout or prove product progress. An input launch failure retains
its actual typed diagnostic and at most 64 KiB of each captured output stream.
The Runner seals this supporting failure through its normal redacting writer;
entry validation retains the same diagnostic in the request report. Do not
replace an unobserved transient timeout cause with a passing replay.
Input owner cleanup failure or interrupted cleanup retains its typed failure,
stops dispatch even without stop-on-failure, and cannot become reuse PENDING.
Gate entry validation consumes and seals a complete repair-required Session stop;
the old clean request cannot be replayed after this resource failure.
An original consumer must reference the same original prerequisite manifests that
the current request revalidated. Request ordering finishes attempted incomplete roots
and their necessary producers first, then unstarted roots, then unrelated fresh work.
Dependencies are visited per root: an unstarted aggregate cannot promote a completed
prefix ahead of an independent interruption. The frozen graph and full obligation
stay intact. Session scheduling reads the original report ArtifactRefs across the
continuous source/graph/context candidate, validates hash, full scope, source, graph,
policy and stop, and retains the latest actual observation per Gate. A subsequent
not-dispatched result cannot erase earlier execution; a new actual failure supersedes
earlier completion. Candidate changes reset this ordering history. Historical
observations supply ordering and original candidate refs, never accepted proof.
Only current entry validation can populate the current report with original reuse;
a freshly executed prerequisite with a different manifest invalidates its old consumer.
Unvisited candidates remain UNPROVEN in that request.
Business aggregate readers use the same original prerequisite refs and current
Runner envelope. They must not query latest independently, accept duplicate context
identities or treat absent cleanup as not-required. Original manifest and complete
inventory hashes, source, current/sealed result equality, scans and requested Runtime
Cell must all qualify. Aggregate reports retain the original ArtifactRef. A matching
SHA local snapshot is not a reason to reject complete proof; remote sync and release
clean-source requirements remain separately owned.
The concrete prerequisite toolchain Owner closes only the seven registered local
aggregate commands, actual Python/sh inputs and original producer manifests.
Provider/oracle/fixture digests retain every original reference and sealed material
input. Original inventory, source, proof, cleanup and scans must revalidate before
command, after cleanup and on resume. No latest replacement, missing prerequisite,
Profile, live producer or ephemeral input receives this qualification.
The Station API AST command has a concrete Go source Owner. Bind the actual
native Go/compiler/assembler/linker, resolved standard-package files, installed
module bytes and manifests, workspace metadata, effective configuration and
telemetry mode. Disable persistent Go settings, automatic toolchain downloads,
network module resolution and CGO in both command and probe; verify build-cache
results. Unknown shims, external replacements, unresolved packages, native
objects and product equipment reject qualification. Retain the original
ten-second probe and 120-second command protection. The observer never installs
or chooses a replacement toolchain.

Sole request-work expiry is ADMINISTRATIVE_PREEMPTION / REQUEST_PREEMPTED, not a
business hang or performance failure. Owner/mixed/exit expiry stays distinct.
Operation heartbeats prove only owner liveness. Samples and stream backpressure are
bounded, deadlines never renew, and observer workers stop before publication.
On macOS requested O_NONBLOCK on /dev/fd does not prove the actual descriptor mode:
the CLI owns and restores stderr mode; the observer checks actual nonblocking mode.

No uniform Gate work cap is implied. Request limits, Catalog protection from actual
command start, explicit owner limits, business windows and performance objectives
remain distinct. Cleanup replaces the unwound work alarm and fixes one tail shared
by termination, descendant confirmation and resource cleanup. Nested cancellation
retains its actual earlier owner. Missing performance objectives remain UNPROVEN.

Early initialization, owner SIGINT and publication failures still produce full-scope
UNPROVEN observations. SIGINT is OWNER_INTERRUPTED. Independently sealed stop
observations never rewrite sealed Gate results; dispatch counts use acquired runs.
Sole request expiry during pre-acquisition source capture uses the normal aggregate
and Session terminal, with no manufactured Gate run and cleanup not-required.
The same rule applies during entry validation when actual probe cleanup is confirmed;
failed or interrupted probe cleanup retains the typed repair-required diagnostic.
Before-entry and in-capture expiry both retain the original manifest needed for
canonical continuation. Independent diagnostic Sessions expose their sealed manifest
too; their repair-required state and missing cleanup cannot become clean exhaustion.

Public inventory comes only from actual closed ArtifactRef values, and public graph
metadata from the unique compiler's closed ExecutionGraph. A role containing auth,
key or token cannot delete its typed value. Payload field heuristics and all secret
text/known-value scans remain effective. Secret public identity, extra payload,
mutation or digest/hash loss rejects publication. Every manifest reader and writer
validates every inventory entry; no business whitelist or historical repair exists.
Immutable JSON byte audit reconstructs a complete ExecutionGraph through that
same validator before treating only its closed subtree as public metadata.
The marker alone, extra/missing fields, changed digest or invalid dependency
cannot bypass payload heuristics. Every key and value still receives text and
known-credential scanning. Ordinary dict input to the writer remains payload;
serialized validation never supplies producer provenance or skips a file.

## Why this is non-negotiable

A proof label cannot replace original evidence. Coverage, Gap, capability
assessment, prerequisite, business aggregate and resume use the same
`core/proof.py` reader. Failed, malformed or empty source-report assertions,
missing terminal cleanup, invalid scans, conflicting current result fields and
finalizer authority changes reject proof. Business owns required observations.
Every unique JSON artifact containing this Gate's canonical report must qualify,
including when sourceArtifact is absent or redirected. Supporting arrays and
scalars remain data; sealed result identity cannot conflict with the Gate.
Evidence Store blocking locks use finite OS attempts with at most 60 seconds
of protection; an earlier execution owner still cancels with its original type.
Stage-bound wait/hold/attempt/failure observations are bounded diagnostics,
not performance or product proof. Release keeps the acquiring stage identity.
Failed acquisition and cancellation close the attempted descriptor.
Coverage must render and count every declared Feature regardless of display
order. Cross-capability domain relationships remain valid and visible; the
declared product_area groups one counted Feature. Without it, multiple
relationships use the shared group, never last-writer selection or rejection.
Core self-validation remains separately counted. One report may share
its current source and unique-Gate assessments, never persist an input cache.

A bounded process cannot promise arbitrary full workloads finish before its deadline.
Forcing a full rerun repeats an already proved prefix; shrinking required scope or
renaming old PASS hides missing proof. Applying payload heuristics to public IDs can
destroy the references needed to audit even a legitimately completed producer.

## How to verify

Run `test_proof`, `acceptance-coverage-report-test.py`,
`acceptance-gap-detect-test.py`, `acceptance-validate-test.py`,
`test_prerequisite_aggregate_contract` and Runner regressions. A false assertion
must produce nonzero Gate execution and UNPROVEN output. Pass labels with no
manifest must be rejected for every tier and contract deliverable. New domains
must appear in both denominator and detail. Qualify positive legacy/platform
and enforced-finalizer cases, then independently mutate inventory, source,
cleanup, scans and current material fields to prove rejection.
Omit sourceArtifact from a real sealed inventory with false/empty/non-boolean
canonical assertions and require rejection. Measure a real held OS lock, then
cancel its contender through an earlier owner deadline; confirm the typed
failure, untouched holder, no contender descriptor and terminal observer.
Non-main-thread and standalone callers must not enter unbounded OS lock waits.

Run bounded test_execution_session, test_execution_graph, test_execution_budget,
test_evidence_store, test_redaction and the actual Runner/Planner/Reporter/Gap tests.
Run the validator tests with an unavailable Evidence Store and malformed runtime
envelope in structure mode; no evidence read is allowed and proof remains
not-evaluated. Requested proof must still reject malformed or stale evidence,
and callers cannot interchange structure and proof input sets.
Run `test_scope_ownership`: a real Runner using a separate synthetic Catalog
must exclude Feature-only, Registry-only and Domain validation Gates before
their commands can mutate state. Keep shared owners and unmapped Infra,
reject duplicate IDs/fields and missing Gate references, bind Feature changes
to the frozen identity, and retain unresolved Feature references without
guessing business ownership from names.
Use a real synthetic Runner across two requests: no downstream mutation after the
first expiry, no repeat of validated completion, full scope, original runId and costs,
and complete rerun of the cancelled Gate. Reject concurrent/stale continuation,
source/policy/graph/hash drift, missing cleanup and mixed/unknown expiry.
Combine an earlier actual failure or prerequisite block with later request expiry;
the Session must require repair and reject direct continuation. Only undispatched
results referencing that exact stop, without a manifest or work, remain clean.
Change unrelated versus declared inputs independently, verify original prerequisite
identity, prove pending-first dispatch with an unqualified completed prefix, and fill
a real stderr pipe to prove heartbeat backpressure cannot block owner cleanup.
Add an independent expensive unrelated probe and an interrupted Gate: the latter
must complete before unrelated entry validation, with unchanged budgets and scope.
Cancel that later probe, confirm child extinction and clean exhaustion without a
new Gate run, then revalidate its original candidate in the next request. Verify
Session rejects duplicate, incomplete, first-request and changed-candidate reuse.
Run `test_execution_identity`: two real requests must preserve the original manifest
only while owner inputs match; changed fixture inputs rerun the producer, input change
during work prevents proof, and wrong IDs, missing axes, duplicate fields, failed or
timed-out probes reject reuse. Changed executable or installed code bytes must change
the observation without exposing values. Reject dependency links outside the declared
installation root and retain absence of package code in excluded Vitest result caches.
Run `test_input_owner_diagnostics`: a real timed-out child must be gone, while
the original launch timeout, configured limit and emitted owner stage survive
in a same-run supporting artifact. The canonical Runner must stop downstream,
retain the full scope and keep the Session repair-required.
Run `test_input_artifact_lifecycle` with a real registered synthetic Provisioner
and canonical Runner. Equipment must precede the probe and command; cleanup
must release its actual resource. Both post-cleanup and resume probes must read
the same original references, and material drift must force fresh equipment.
Wrong Gate/run, missing or mutated original equipment must reject. Cancel a probe
after equipment and prove both child extinction and resource release under the
unchanged tail, with no product command or downstream dispatch.
Run `test_prerequisite_aggregate_contract` through the real Evidence Store. Replacing
latest must retain the bound original producer. Missing/failed cleanup, changed
artifact bytes, conflicting current refs, repeated context fields/identities,
changed source and a missing requested Runtime Cell must reject proof. A missing
original prerequisite cannot be filled by latest. Complete matching SHA snapshots
can aggregate; empty aggregate scope remains unproven.
Run `test_go_source_input_owner`: same-size/restored-mtime changes to resolved
standard and installed module files change identity; module metadata and
installation additions remain material. Reject duplicate/incomplete/native
packages, external workspace/replacement/standard inputs, escaping links and
foreign or product-equipped commands. Qualify the complete original AST Gate
with actual before/after observations and successful child cleanup; version
strings and a passing dependency list are not the complete Gate.
Run `test_node_input_owner` against real Node resolution: changing transitive
package bytes or the package link target changes identity; optional installation
differs from absence; missing required dependencies, escaping code links, native
addons, configured loaders and unsupported tools reject qualification.
Run `test_machine_dev_input_owner` with a real independent canonical listener:
port drift must change oracle/fixture digests without stopping or adopting the
listener; observation after owner cleanup must see the released port. Reject
foreign Gate IDs, changed commands and product equipment before observation.
Qualify the unchanged complete MachineDev command with matching before/after
inputs under the original support allowance; focused regressions alone cannot
provide its formal proof.
Run `test_workflow_input_owner` through the actual Perl delegate and XS modules.
Same-size/restored-mtime checksum script mutation and temporary-parent mode
changes must change identity. Reject foreign commands, configured metadata or
Perl loaders, unknown checksum shims and product equipment. Qualify the complete
workflow command with matching before/after inputs under the original support
allowance; partial Node, Plan or skill-check results are not complete proof.
Run `test_installed_inputs`: complete bytes, modes, links, repeated-target
references and exclusions retain the original digest; a controlled reader
barrier observes four overlapping reads and no more than eight pending tasks.
All files must be read; same-size/restored-mtime mutation changes identity.
Read errors, cancellation, escaping or broken links and non-file resources
retain their failure with no surviving reader threads. The explicit Python
framework file exception cannot admit an external directory.
Inject cleanup failure at the public Launcher boundary before work, before seal,
and during resume. Require failed cleanup, full scope, no downstream mutation,
repair-required Session and rejection of the old resume reference. Cancel a real
probe by request deadline and prove its PID is gone within the fixed cleanup tail.
Probe-only timeout with confirmed cleanup must still permit subsequent request
work. Reject source-owner binding to non-local or provisioned Gates.
Exercise the real source-owner CLI with an installed package: changed declared
dependency bytes and changed native executable bytes must each change runtime
identity. Reject an unknown shim even when its delegate is a valid executable.
Do not use aggregate/latest evidence or live local runtime Gates as source-only
qualification workloads.
Run four real requests with opaque independent Gates: successive interruptions must
advance the never-started frontier without repeating completed prefixes. The final
request reruns opaque completion with a new manifest before QUALIFIED. Reject corrupt
earlier report bytes, and reset ordering independently for source, graph and context
changes.
Expire the real Runner immediately before and during its next source capture.
Verify unchanged full scope, no acquired next Gate or downstream mutation, clean
Session sealing, original producer reuse and successful canonical second request.

The actual writer must preserve auth/key/token role refs and compiler mappings,
recompute graph digests, reject unknown public payload and preserve secret redaction,
including encoded values. Mutated inventory bytes must reject DURABLE publication
and read. Existing required-finalizer publication and authoritative proof contracts
remain mandatory; plain manifest visibility cannot substitute for their authority.
Exercise writer → immutable bytes → Runner audit → log publication → finalize.
Direct and child writers must preserve a validated graph byte-for-byte, including
auth/key/token Gate IDs. A valid graph beside ordinary sensitive payload cannot
shield that payload; resolved credentials inside a valid graph must still fail
audit without rewriting the registered artifact. Invalid graph markers, extra
fields, missing identity, graph digest drift and dependency drift remain scanned.
