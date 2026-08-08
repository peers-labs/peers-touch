#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/official-applet');
const evidencePath = process.env.PEERS_ATELIER_COMPLETION_READINESS_AUDIT_EVIDENCE_PATH
  ? path.resolve(process.env.PEERS_ATELIER_COMPLETION_READINESS_AUDIT_EVIDENCE_PATH)
  : path.join(evidenceDir, 'atelier-completion-readiness-audit.json');
const fullE2EEvidencePath = process.env.PEERS_ATELIER_COMPLETION_READINESS_AUDIT_FULL_E2E_PATH
  ? path.resolve(process.env.PEERS_ATELIER_COMPLETION_READINESS_AUDIT_FULL_E2E_PATH)
  : 'tooling/acceptance/evidence/applets/official-applet/atelier-full-e2e.json';
const evidenceRoot = process.env.PEERS_ATELIER_COMPLETION_READINESS_AUDIT_EVIDENCE_ROOT
  ? path.resolve(process.env.PEERS_ATELIER_COMPLETION_READINESS_AUDIT_EVIDENCE_ROOT)
  : process.cwd();
const projectionContractGateSourcePath = path.resolve('tooling/scripts/atelier-projection-contract-gate.mjs');
const canonicalIdeLaunchEvidencePath = 'tooling/acceptance/evidence/applets/official-applet/atelier-full-e2e-ide-launch.json';
const canonicalProviderRuntimeEvidencePath = 'tooling/acceptance/evidence/applets/official-applet/atelier-full-e2e-provider-runtime.json';

const requiredEvidence = [
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-projection-contract-gate.json',
    expectedGate: 'atelier:projection-contract-gate',
    expectedEvidenceClass: 'STATIC_CONTRACT_GATE',
    requiredProves: [
      'Atelier projection contract JSON, codegen, official generated contract, and prototype generated contract remain aligned',
      'TaskGraph evidenceRefResolution contract metadata is generated and consumed before unresolved refs are displayed',
      'Atelier P4 readiness slice documentation and ledger entries remain synchronized with NOT_READY boundaries',
    ],
    requiredDoesNotProve: ['complete Host + Station + applet E2E'],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
    expectedGate: 'atelier:bridge-runtime-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: [
      'browser Atelier bridge runtime validates projection snapshots and malformed projection events fail closed',
      'browser Atelier bridge runtime preserves last valid projection during stale seq, malformed patch, event apply failures, stale snapshot success/failure responses after fresher projection events or local model intents, and current snapshot failure typed recovery',
      'browser Atelier bridge runtime keeps fresh snapshot responses reconciling until refreshed projection subscribe settles and maps rejected refreshed subscribe to typed recovery',
      'browser Atelier bridge runtime keeps initial projection subscription reconciling until Host subscribe ack settles and maps rejected ack to typed recovery',
      'browser Atelier bridge runtime ignores stale initial subscription ack resolve or rejection after subscription replacement',
      'browser Atelier applet bridge ignores late subscribe rejections after release without listener delivery duplicate unsubscribe or unhandled rejection',
      'browser Atelier applet bridge release-before-late subscribe reject source unit matrix covers listener delivery duplicate unsubscribe and unhandled rejection isolation',
      'browser Atelier prototype typed subscription rejection sanitized cause source unit matrix preserves recovery code and strips execution-shaped fields',
      'browser Atelier prototype projection event typed subscription rejection reason sanitization source unit matrix strips execution-shaped reason text before message and cause construction',
      'browser Atelier prototype projection event typed subscription rejection code whitelist source unit matrix keeps only known recovery codes in Error.cause',
      'browser Atelier applet bridge typed subscription rejection reason and warning sanitization source unit matrix strips execution-shaped fields',
      'browser Atelier bridge runtime bounds dedupe cache and still rejects stale replay after eviction',
      'browser Atelier bridge runtime manages projection subscription lifecycle, topic correlation, cleanup, release-before-reject cleanup, typed recovery mapping, and structured Host error-code recovery taxonomy',
      'browser Atelier bridge runtime maps current non-snapshot Host failures to auth-denied, disconnected, and generic error recovery without mutating projection state',
      'browser Atelier applet bridge rejects malformed non-snapshot provider, feedback, memory, rerun, workspace, artifact body, and artifact preview responses',
      'browser Atelier applet bridge rejects execution-shaped fields in every non-snapshot Host typed response before runtime ownership can observe them',
      'browser Atelier bridge runtime rejects decimal and unsafe projection event/replay sequence numbers before state or cursor use',
      'browser Atelier prototype rejects task purge intents unless projected task status is deleted before runtime calls',
      'browser Atelier prototype marks unresolved TaskGraph artifact and gate evidence refs before display',
      'browser Atelier prototype recovery view matrix covers generated view status, retry, severity, and symbol taxonomy',
      'browser Atelier prototype recovery view source unit matrix covers generated severity symbol and retry taxonomy',
      'browser Atelier prototype render consumes status action policy for empty create-project and retry affordances',
      'browser Atelier prototype status action policy keeps primary action and visibility flags mutually consistent',
      'browser Atelier prototype status action policy matrix is exhaustive against generated view statuses',
      'browser Atelier prototype status action policy source unit matrix covers every generated view status without execution payload fields',
      'browser Atelier bridge runtime snapshot clone fails closed for executable capability values, forbidden capability keys or paths, and circular projection references before JSON cloning',
      'browser Atelier bridge runtime snapshot clone rejects non-plain projection objects before JSON cloning while preserving plain and null-prototype projection dictionaries',
      'browser Atelier bridge runtime snapshot clone rejects undefined array values and non-finite projection numbers before JSON cloning while preserving finite numbers and omittable optional object fields',
      'browser Atelier bridge runtime snapshot clone only omits registered optional undefined object fields and rejects required or unregistered undefined object fields before JSON cloning',
      'browser Atelier bridge runtime snapshot clone rejects prototype pollution keys before JSON cloning while preserving safe null-prototype projection dictionaries',
      'browser Atelier bridge runtime snapshot clone rejects sparse projection array holes before JSON cloning while preserving dense projection arrays',
      'browser Atelier bridge runtime snapshot clone rejects symbol-keyed or non-enumerable own projection properties before JSON cloning',
      'browser Atelier bridge runtime snapshot clone rejects accessor own projection properties before Object.entries or JSON cloning can invoke them',
      'browser Atelier bridge runtime snapshot clone isolates accepted projections from source snapshot mutations after cloning',
      'browser Atelier mock runtime getSnapshot clones status and state so external snapshot mutations cannot pollute runtime state',
      'browser Atelier mock runtime construction clones seed state so seed mutations cannot pollute runtime state',
      'browser Atelier mock runtime async action returns cloned snapshots so async return mutations cannot pollute runtime state',
      'browser Atelier mock runtime transition state is cloned on ownership transfer so returned projection mutations cannot pollute runtime state',
      'browser Atelier bridge runtime clones accepted Host projections on ownership transfer so Host projection mutations cannot pollute runtime state',
      'browser Atelier bridge runtime clones accepted projection event patches on ownership transfer so event patch mutations cannot pollute runtime state',
      'browser Atelier bridge runtime ignores released projection subscription callbacks by subscription generation so released Host callbacks cannot mutate runtime state',
      'browser Atelier bridge runtime ignores pre-cleanup projection subscription callbacks until cleanup contract is validated so malformed subscriptions cannot mutate runtime state',
      'browser Atelier bridge runtime ignores stale projection refresh results after newer projection revisions so stale refresh failures cannot overwrite current runtime status',
      'browser Atelier bridge runtime guards non-promise projection refresh settlement so synchronous projection events keep current runtime status',
      'browser Atelier bridge runtime guards subscription recovery status against stale projection refresh success so auth-denied surfaces remain fail-closed',
      'browser Atelier bridge runtime guards subscription setup and cleanup recovery status against stale projection refresh success so disconnected surfaces remain fail-closed',
      'browser Atelier bridge runtime guards non-snapshot call status settlement against projection recovery revisions so auth-denied surfaces remain fail-closed',
      'browser Atelier bridge runtime guards non-snapshot call failure settlement against projection recovery revisions so auth-denied surfaces remain fail-closed',
      'browser Atelier prototype page surface unit matrix covers every generated view status so loading empty disconnected and auth-denied states stay mutually exclusive',
        'browser Atelier prototype default shell is synced to the official single-column projection shape without app-level left or right rails',
    ],
    requiredDoesNotProve: [
      'real Desktop Host event stream producer behavior',
      'real Station SSE network failure matrix',
      'real cross-restart cursor recovery',
      'real Desktop product window UI',
      'real provider, feedback, memory, rerun, workspace, artifact body, or artifact preview backend side effects',
      'complete Host + Station + applet E2E',
    ],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    expectedGate: 'atelier:official-frontend-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: [
      'official Atelier frontend uses service binding for Station-owned methods',
      'official Atelier frontend keeps workspace/artifact preview Host intents out of Station service binding',
      'official Atelier frontend controlled loading, empty, recovery, and status taxonomy coverage is exhaustive against generated contract statuses',
      'official Atelier frontend render consumes status action policy for empty create-project and retry affordances',
      'official Atelier frontend status action policy keeps primary action and visibility flags mutually consistent',
      'official Atelier frontend status action policy matrix is exhaustive against generated view statuses and recovery kinds',
      'official Atelier frontend status action policy source unit matrix covers every generated view status and recovery kind without execution payload fields',
      'official Atelier frontend projection subscription source unit matrix covers rejected subscribe cleanup release idempotence and late payload isolation',
      'official Atelier frontend projection stream subscribe reject source unit matrix covers Station stream cleanup late payload isolation and no unhandled rejection',
      'official Atelier frontend active typed subscription rejection source unit matrix covers recovery delivery cleanup idempotence and late event isolation',
      'official Atelier frontend typed subscription rejection code taxonomy source unit matrix covers auth-denied and disconnected recovery classification',
      'official Atelier frontend malformed typed subscription rejection source unit matrix covers fail-closed generic recovery and projection-event isolation',
      'official Atelier frontend typed subscription rejection sanitized cause source unit matrix preserves recovery code and strips execution-shaped fields',
      'official Atelier frontend typed subscription rejection reason diagnostic and warning sanitization source unit matrix strips execution-shaped fields',
      'official Atelier frontend typed subscription rejection code whitelist source unit matrix keeps only known recovery codes in Error.cause',
      'official Atelier frontend recovery transitions clear every transient workbench action field before auth-denied disconnected or error surfaces',
      'official Atelier frontend page surface unit matrix covers every generated view status so loading empty disconnected and auth-denied states stay mutually exclusive',
        'official Atelier frontend single-column recovery-state layout keeps loading empty disconnected and auth-denied surfaces above the projection content rail without app-level side rails',
      'official Atelier frontend recovery view unit matrix covers every generated recovery kind with contract-owned tone retry and label keys',
      'official Atelier frontend status pill unit matrix covers every generated view status with contract-owned tone and label keys',
      'official Atelier frontend status notice unit matrix covers every generated notice kind with contract-owned title and detail keys',
      'official Atelier frontend centered state unit matrix covers loading and empty states with contract-owned title and detail keys',
      'official Atelier frontend classifies structured Host and service error codes through generated recovery taxonomy before legacy message fallback',
      'official Atelier frontend rejects malformed service and Host capability responses through executable public client fixtures',
      'official Atelier frontend rejects decimal and unsafe projection event/replay sequence numbers before reducer or cursor use',
      'official Atelier frontend rejects task purge intents unless projected task status is deleted before service calls',
      'official Atelier frontend marks unresolved TaskGraph artifact and gate evidence refs before display',
      'official Atelier frontend keeps artifact preview metadata-only and safe-text bounded without raw iframe/image/html/diff rendering',
      'official Atelier frontend preserves projection-only forbidden capability boundaries for provider, shell, file, memory, artifact, gate, and attachment writes',
    ],
    requiredDoesNotProve: [
      'real Desktop product window UI',
      'real Desktop Host capability producer behavior',
      'real Station projection stream failure matrix',
      'real auth recovery or reconnect behavior against Station',
      'real artifact body fetch or Host sandbox renderer E2E',
      'complete Host + Station + applet E2E',
    ],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-official-status-ui-gate.json',
    expectedGate: 'atelier:official-status-ui-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: [
      'official Atelier status UI unit matrix covers loading empty disconnected auth-denied error reconciling degraded and ready statuses from generated contract',
      'official Atelier status UI page surface keeps loading empty typed recovery status notice global error and main content mutually exclusive where required',
      'official Atelier status UI action policy exposes create-project only for empty workspaces and retry only for retryable recovery kinds',
      'official Atelier status UI render wiring consumes status action policy for empty create-project and projection-only retry affordances',
      'official Atelier status UI retry boundary reloads Station projection only and does not expose execution provider gate artifact memory shell file or input_snapshot actions',
      'official Atelier status UI copy and tone are contract-owned through generated label keys and i18n catalogs',
    ],
    requiredDoesNotProve: [
      'real Desktop product window UI',
      'real Desktop Host failure producer behavior',
      'real Station projection stream failure matrix',
      'real auth recovery or reconnect behavior against Station',
      'post-ready applet UI actions',
      'complete Host + Station + applet E2E',
    ],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-sdk-lynx-bridge-unit-gate.json',
    expectedGate: 'atelier:sdk-lynx-bridge-unit-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: [
      'Applet SDK Lynx bridge unit matrix unwraps canonical object and string envelopes before applet capability consumers observe results',
      'Applet SDK Lynx bridge unit matrix preserves canonical Host error envelopes as AppletError with code details and requestId',
      'Applet SDK Lynx bridge unit matrix covers bridge.invoke and legacy bridge.call fallback without exposing provider runtime execution',
      'Applet SDK Lynx bridge unit matrix normalizes synchronous legacy bridge.call throws as AppletError before applet capability consumers observe failures',
      'Applet SDK Lynx bridge unit matrix unwraps legacy bridge.call string envelopes before applet capability consumers observe results',
      'Applet SDK Lynx bridge unit matrix preserves legacy bridge.call string error envelopes as AppletError before applet capability consumers observe failures',
      'Applet SDK Lynx bridge unit matrix covers lynx.requireModule bridge injection fallback when NativeModules is absent',
      'Applet SDK Lynx bridge unit matrix tolerates delayed Host bridge injection before readiness timeout',
      'Applet SDK Lynx bridge unit matrix fails closed when the Lynx bridge is not available',
      'Applet SDK Lynx bridge event receiver long-polls events.subscribe without params and backs off malformed event envelopes',
      'Applet SDK Lynx bridge event receiver retries events.subscribe after canonical Host error envelopes without dispatching invalid events',
      'Applet SDK Lynx bridge event receiver retries events.subscribe after string canonical Host error envelopes without dispatching invalid events',
      'Applet SDK pending Host event replay buffers unmatched events by topic with a bounded retained tail',
      'Applet SDK destroy tears down bridge event subscription and clears local handlers before stale Host events can be retained',
      'Applet SDK local event unsubscribe removes topic handlers before stale Host events can be delivered',
      'Applet SDK local event unsubscribe preserves sibling same-topic handlers for subsequent Host events',
      'Applet SDK local event dispatch snapshots same-topic handlers so self-unsubscribe cannot skip sibling handlers',
      'Applet SDK local event dispatch snapshots same-topic handlers so newly registered handlers wait for subsequent Host events',
      'Applet SDK pending Host event replay snapshots queued events so reentrant unmatched Host events remain buffered',
    ],
    requiredDoesNotProve: [
      'real Desktop Host Lynx bridge injection',
      'real Desktop Host event stream producer behavior',
      'real Station SSE topic registration or Gateway delivery',
      'real applet product-window UI',
      'complete Host + Station + applet E2E',
    ],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-message-send-ingress-controlled-gate.json',
    expectedGate: 'atelier-message-send-ingress-controlled-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: [
      'Station Atelier SendMessage persists only text user-message event metadata',
      'Station official Atelier /v1/messages ingress rejects run, attachments, inputSnapshot, and input_snapshot fields',
      'Atelier message send remains Station-owned message append intent and does not expose run/provider/runtime/input_snapshot actions',
    ],
    requiredDoesNotProve: [
      'real Agent reply E2E',
      'real provider execution',
      'real Run input_snapshot write',
      'real Desktop Host + Station + applet message send E2E',
    ],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-feedback-submit-ingress-controlled-gate.json',
    expectedGate: 'atelier-feedback-submit-ingress-controlled-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: [
      'Station official Atelier /v1/feedback/submit ingress rejects execution-shaped memory, rerun, provider, attachment, and input_snapshot fields',
      'Station Atelier SubmitFeedback persists Station-owned policy hint event metadata derived from allowed signal taxonomy',
      'Atelier feedback submit remains Station-owned review intent and does not expose memory.write, rerun execution, provider, runtime, or input_snapshot actions',
    ],
    requiredDoesNotProve: [
      'real Planner/Risk/Verifier feedback consumption',
      'real memory write E2E',
      'real rerun task creation E2E',
      'real Desktop Host + Station + applet feedback submit E2E',
    ],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-confirmation-ingress-controlled-gate.json',
    expectedGate: 'atelier-confirmation-ingress-controlled-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: [
      'Station official Atelier memory and rerun confirmation ingress rejects execution-shaped fields',
      'Station confirmation requests remain reference-only taskId/feedbackId intents',
      'Station service tests keep memory writes and rerun creation Station-owned after durable feedback review lookup',
    ],
    requiredDoesNotProve: [
      'real memory write E2E from Desktop Host + applet',
      'real rerun task creation E2E from Desktop Host + applet',
      'real Planner/Risk/Verifier feedback consumption',
      'complete Host + Station + applet E2E',
    ],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-confirmation-outcome-controlled-gate.json',
    expectedGate: 'atelier-confirmation-outcome-controlled-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: [
      'Station memory confirmation outcome writes review-derived long-term memory through MemoryService',
      'Station memory confirmation outcome emits an audit event and is idempotent by feedbackId',
      'Station rejects non-candidate feedback before memory write',
      'Station rerun confirmation outcome creates a new Station-owned collaboration task from the durable feedback intent',
      'Station rerun confirmation outcome clones provider plan/nodes, emits an audit event, and is idempotent by feedbackId',
      'Station rejects non-rerun feedback before task creation',
    ],
    requiredDoesNotProve: [
      'real memory write E2E from Desktop Host + applet',
      'real Planner/Risk/Verifier consumption of confirmed memory',
      'real rerun task creation E2E from Desktop Host + applet',
      'real executor/provider recovery for the confirmed rerun task',
      'complete Host + Station + applet E2E',
    ],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-feedback-memory-consumption-controlled-gate.json',
    expectedGate: 'atelier-feedback-memory-consumption-controlled-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: [
      'Station feedback policy records planner/risk/verifier feed taxonomy for memory candidates',
      'Station confirmed Atelier feedback memory is retrievable by MemoryService search for planner/risk/verifier queries',
      'Station prompt memory snapshot includes the confirmed memory as a relevant item for consumer assembly',
      'Applet feedback and confirmation payloads remain intent/reference-only and do not write memory directly',
    ],
    requiredDoesNotProve: [
      'real Planner/Risk/Verifier model consumption in a live provider run',
      'real memory write E2E from Desktop Host + applet',
      'real rerun task creation E2E from Desktop Host + applet',
      'real executor/provider recovery for confirmed rerun tasks',
      'complete Host + Station + applet E2E',
    ],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-workspace-open-controlled-gate.json',
    expectedGate: 'atelier-workspace-open-controlled-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: [
      'Desktop gateway accepts only canonical pt-workspace://task/<taskId>?workspace=<workspaceId> workspace open intents',
      'Desktop gateway rejects non-contract workspace URI shapes before native resolver or IDE launch',
      'Desktop gateway response remains Host-intent-only and does not expose file, shell, execute, run, or openExternalUrl fields',
      'Atelier applet workspace.open remains a Host UI intent rather than provider/runtime execution',
    ],
    requiredDoesNotProve: [
      'real IDE launch',
      'real workspace resolver',
      'real sandbox runtime',
      'real Desktop product window UI',
      'complete Host + Station + applet E2E',
    ],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-task-lifecycle-controlled-gate.json',
    expectedGate: 'atelier-task-lifecycle-controlled-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: [
      'Station Atelier SetTaskStatus persists workbench lifecycle status without mutating execution status',
      'Station Atelier PurgeTask rejects non-deleted tasks through the public service',
      'Station Atelier PurgeTask removes task-owned durable indexes through the public service',
      'Atelier task lifecycle remains Station-owned and does not expose applet execution actions',
    ],
    requiredDoesNotProve: [
      'real Desktop Host + Station + applet task lifecycle E2E',
      'real product-window task menu interaction',
      'real cross-device lifecycle synchronization',
      'real user confirmation modal UX',
    ],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-runtime-log-stream-controlled-gate.json',
    expectedGate: 'atelier-runtime-log-stream-controlled-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: [
      'controlled Host sandbox CDP console capture normalization',
      'ordered log/warn/error evidence from a local sandbox harness',
    ],
    requiredDoesNotProve: [
      'real Run runtime stream',
      'real provider/executor lifecycle',
      'atelier.logs.subscribe applet capability',
      'runtime.logs.subscribe applet capability',
      'complete Host + Station + applet E2E',
    ],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-artifact-renderer-controlled-gate.json',
    expectedGate: 'atelier-artifact-renderer-controlled-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: [
      'Desktop Host adapter builds controlled host_sandbox_visual_surface descriptors for markdown/web/image/diff preview kinds',
      'Desktop Host markdown renderer runtime consumes safe text and returns metadata-only render evidence without exposing raw body text',
      'Desktop Host diff renderer runtime consumes safe diff text and returns metadata-only render evidence without exposing raw patch text or enabling patch apply',
      'Desktop Host web renderer runtime consumes safe HTML and returns metadata-only render evidence without exposing raw HTML or enabling scripts/network/navigation',
      'Desktop Host image renderer runtime consumes Host-owned image metadata and returns metadata-only render evidence without exposing raw bytes/path/url/base64',
      'Desktop Host artifact preview renderer policy keeps scripts, network, external navigation, file access, and patch apply disabled',
      'Desktop Host artifact preview renderer surfaces remain Host-owned and not applet-renderable',
    ],
    requiredDoesNotProve: [
      'real iframe/image/html/diff rendering in a live Desktop webview',
      'real artifact blob fetch from Station storage',
      'real Console Logs runtime stream',
      'real attachment Host Storage runtime',
      'complete Host + Station + applet E2E',
    ],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-artifact-renderer-live-controlled-gate.json',
    expectedGate: 'atelier-artifact-renderer-live-controlled-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: [
      'controlled Host-owned live sandbox DOM render harness for markdown/web/image/diff preview kinds',
      'live sandbox renderer emits metadata-only evidence without raw body/html/diff/image bytes',
      'live sandbox renderer blocks script, iframe, external URL, inline event handler, file access, and patch apply surfaces',
      'live sandbox renderer keeps rendered surfaces Host-owned and not applet-renderable',
    ],
    requiredDoesNotProve: [
      'real Desktop product-window webview renderer',
      'real artifact blob fetch from Station storage',
      'real Console Logs runtime stream',
      'real attachment Host Storage runtime',
      'complete Host + Station + applet E2E',
    ],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-artifact-body-fetch-controlled-gate.json',
    expectedGate: 'atelier-artifact-body-fetch-controlled-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: [
      'Station-owned Atelier artifact body fetch returns owned safe-text bodies through canonical artifact:// bodyRef',
      'Station artifact body fetch enforces actor-owned task scope, canonical bodyRef, active retention, fetchable text kinds, and body hash checks',
      'Station artifact body fetch truncates safe text by maxBytes without exposing file/path/url/html/iframe/image execution channels',
    ],
    requiredDoesNotProve: [
      'real Desktop product-window artifact body fetch',
      'live Desktop webview iframe/image/html/diff rendering',
      'real Station artifact blob production by provider/executor',
      'Console Logs runtime stream',
      'attachment Host Storage runtime',
      'complete Host + Station + applet E2E',
    ],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-host-storage-attachment-controlled-gate.json',
    expectedGate: 'atelier-host-storage-attachment-controlled-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: [
      'controlled Host-owned attachment byte staging behind host-storage opaque refs',
      'host-storage attachment metadata normalization with mime/size/sha256',
      'controlled host-storage ref readback without exposing raw path/url/body/base64 fields to applet evidence',
    ],
    requiredDoesNotProve: [
      'real Desktop Host Storage runtime',
      'real user attachment picker or upload flow',
      'applet attachment upload capability',
      'Run input_snapshot write capability from applet',
      'real provider/executor consumption of Host Storage attachments',
      'complete Host + Station + applet E2E',
    ],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-host-storage-attachment-browser-controlled-gate.json',
    expectedGate: 'atelier-host-storage-attachment-browser-controlled-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: [
      'controlled browser File API attachment intake metadata normalization',
      'Host-owned staging converts browser attachment metadata into host-storage opaque refs',
      'browser attachment intake evidence excludes raw path/url/body/base64/bytes/write fields',
      'applet upload and input_snapshot write capabilities remain unexposed',
    ],
    requiredDoesNotProve: [
      'real Desktop Host Storage runtime',
      'real native file picker integration',
      'real user attachment upload flow',
      'Run input_snapshot write capability from applet',
      'real provider/executor consumption of Host Storage attachments',
      'complete Host + Station + applet E2E',
    ],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-direct-run-execution-evidence-controlled-gate.json',
    expectedGate: 'atelier-direct-run-execution-evidence-controlled-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: [
      'controlled DirectRun execution evidence remains a Station-owned read-only projection',
      'controlled DirectRun evidence exposes only canonical evidence refs and status fields',
      'Station service-level DirectRun evidence is derived from durable DirectRun/artifact/gate/budget indexes without raw input snapshot or artifact body fields',
      'official applet client and browser prototype runtime do not expose DirectRun execution/write actions',
    ],
    requiredDoesNotProve: [
      'real Desktop CodingProvider worker execution',
      'real provider/model quality',
      'real streaming reply UX',
      'complete Host + Station + applet E2E',
    ],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-budget-surface-controlled-gate.json',
    expectedGate: 'atelier-budget-surface-controlled-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: [
      'Station DirectRun budget usage aggregation is backed by agent_task_budget_usages service-level tests',
      'Station provider billing reconciliation is backed by BudgetUsageReconciler service-level tests',
      'Station budget circuit breaker blocks DirectRun before provider calls for time/token/money budget exhaustion',
      'Station budget DecisionCard recovery resolves a reference-only human decision intent through Station orchestration',
      'budgetSurface remains a read-only applet projection with no budget write/halt/resume surface',
    ],
    requiredDoesNotProve: [
      'real provider implementations populate external billing in production',
      'real DecisionCard budget recovery from Desktop Host + applet',
      'real provider/live stream behavior',
      'complete Host + Station + applet E2E',
    ],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-full-e2e-runtime-inputs-controlled-gate.json',
    expectedGate: 'atelier:full-e2e-runtime-inputs-controlled-gate',
    expectedEvidenceClass: 'READINESS_AUDIT',
    requiredProves: ['full E2E runtime input validation has an executable controlled matrix for missing, invalid, and present inputs'],
    requiredDoesNotProve: ['full Host + Station + applet E2E'],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-full-e2e-preflight-controlled-gate.json',
    expectedGate: 'atelier:full-e2e-preflight-controlled-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: ['full E2E preflight records missing runtime inputs in isolated evidence'],
    requiredDoesNotProve: ['real Desktop Host launch'],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-full-e2e-fail-closed-controlled-gate.json',
    expectedGate: 'atelier:full-e2e-fail-closed-controlled-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: ['full E2E runner missing runtime input branch exits non-zero and writes isolated NOT_READY evidence'],
    requiredDoesNotProve: ['real Desktop Host launch'],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-full-e2e-final-evidence-controlled-gate.json',
    expectedGate: 'atelier:full-e2e-final-evidence-controlled-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: ['full E2E runner validates current-launch Desktop ready, workspace open, IDE launch, and provider runtime evidence before ok=true'],
    requiredDoesNotProve: ['real Desktop Host launch'],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-source-dist-integrity-policy-gate.json',
    expectedGate: 'atelier:source-dist-integrity-policy-gate',
    expectedEvidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    requiredProves: [
      'Atelier source manifest keeps pending bundle integrity placeholder instead of pretending to be generated dist truth',
      'Atelier desktop dist manifest remains the runtime integrity truth and matches generated main.lynx.bundle sha256',
      'Atelier release-stamped manifest policy keeps source/dist service bindings permissions platform permissions and skills unchanged',
      'Atelier release-stamped manifest policy forbids execution persistence and privileged producer capability expansion',
    ],
    requiredDoesNotProve: [
      'real signed release artifact stamping',
      'real Desktop Host loading stamped source manifest',
      'complete Host + Station + applet E2E',
    ],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-desktop-injection-gate.json',
    expectedEvidenceClass: 'REAL_PRODUCT_PATH',
    requiredDoesNotProve: ['real Desktop product window UI renders peers.atelier'],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-real-product-gates-aggregate.json',
    expectedGate: 'atelier:real-product-gates',
    expectedEvidenceClass: 'REAL_PRODUCT_PATH',
    requiredProves: ['bounded aggregate wrapper runs all Atelier real-product and product-window child gates to clean exit'],
    requiredDoesNotProve: ['global Atelier readiness'],
  },
  {
    path: 'tooling/acceptance/evidence/applets/official-applet/atelier-full-e2e-preflight.json',
    expectedGate: 'atelier:full-e2e-preflight',
    expectedEvidenceClass: 'READINESS_AUDIT',
    requiredProves: [
      'final E2E run prerequisites are machine-audited before attempting a readiness claim',
      'final side evidence source instrumentation gaps are machine-audited before full E2E runtime handoff',
    ],
    requiredDoesNotProve: ['global Atelier readiness'],
  },
];

const finalEvidenceRequirements = [
  {
    id: 'full-host-station-applet-e2e',
    status: 'MISSING',
    requiredEvidence: 'A clean full Host + Station + applet E2E run driven through the real Desktop Host, real Station service binding, and official applet package.',
    operatorNextAction: {
      primaryCommand: 'pnpm run atelier:full-e2e',
      prerequisiteCommands: [
        'pnpm run atelier:controlled-gates',
        'pnpm run atelier:real-product-gates',
        'pnpm run atelier:full-e2e-preflight',
      ],
      requiredRuntimeInputs: [
        'PEERS_ATELIER_FULL_E2E_STATION_URL',
        'PEERS_ATELIER_FULL_E2E_DESKTOP_APP',
        'PEERS_ATELIER_FULL_E2E_IDE',
        'PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE',
      ],
      expectedEvidencePaths: [
        'tooling/acceptance/evidence/applets/official-applet/atelier-full-e2e.json',
      ],
      acceptanceCriteria: [
        'atelier-full-e2e.json is ok=true with evidenceClass=REAL_PRODUCT_PATH',
        'Desktop Host, Station handshakes, post-ready applet action, real IDE launch, and provider/runtime quality all pass in one current launch',
      ],
    },
  },
  {
    id: 'post-ready-applet-ui-actions',
    status: 'MISSING',
    requiredEvidence: 'Current-launch applet UI actions after Desktop ready, beginning with atelier.workspace.open evidence bound to launchId/sessionId/taskId/workspaceUri/IDE target.',
    operatorNextAction: {
      primaryCommand: 'pnpm run atelier:full-e2e',
      prerequisiteCommands: ['pnpm run atelier:full-e2e-preflight'],
      requiredRuntimeInputs: [
        'PEERS_ATELIER_FULL_E2E_STATION_URL',
        'PEERS_ATELIER_FULL_E2E_DESKTOP_APP',
        'PEERS_ATELIER_FULL_E2E_IDE',
      ],
      expectedEvidencePaths: [
        'tooling/acceptance/evidence/applets/official-applet/atelier-full-e2e-desktop-ready.json',
        'tooling/acceptance/evidence/applets/official-applet/atelier-full-e2e-workspace-open.json',
      ],
      acceptanceCriteria: [
        'workspace.open evidence launchId/sessionId match Desktop ready evidence',
        'workspace.open remains Host intent and does not claim real IDE launch by itself',
      ],
    },
  },
  {
    id: 'real-ide-launch',
    status: 'MISSING',
    requiredEvidence: 'Independent atelier-full-e2e-ide-launch.json evidence from the real Desktop Host workspace resolver proving IDE launch for atelier.workspace.open.',
    operatorNextAction: {
      primaryCommand: 'pnpm run atelier:full-e2e',
      prerequisiteCommands: ['pnpm run atelier:full-e2e-preflight'],
      requiredRuntimeInputs: [
        'PEERS_ATELIER_FULL_E2E_DESKTOP_APP',
        'PEERS_ATELIER_FULL_E2E_IDE',
      ],
      expectedEvidencePaths: [
        'tooling/acceptance/evidence/applets/official-applet/atelier-full-e2e-ide-launch.json',
      ],
      acceptanceCriteria: [
        'IDE launch evidence is independent current-launch Desktop Host evidence',
        'IDE launch evidence proves launchOwner=desktop_host and does not expose file/shell/execute/openExternalUrl to the applet',
      ],
    },
  },
  {
    id: 'production-provider-runtime-quality',
    status: 'MISSING',
    requiredEvidence: 'Independent atelier-full-e2e-provider-runtime.json Station-owned evidence for the configured provider profileRef, proving provider runtime, model quality, streaming UX, artifact persistence, and trace/checkpoint/resume without applet execution exposure.',
    operatorNextAction: {
      primaryCommand: 'pnpm run atelier:full-e2e',
      prerequisiteCommands: ['pnpm run atelier:full-e2e-preflight'],
      requiredRuntimeInputs: [
        'PEERS_ATELIER_FULL_E2E_STATION_URL',
        'PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE',
      ],
      expectedEvidencePaths: [
        'tooling/acceptance/evidence/applets/official-applet/atelier-full-e2e-provider-runtime.json',
      ],
      acceptanceCriteria: [
        'provider/runtime evidence is Station-owned and bound to the configured providerProfileRef',
        'provider runtime, model quality, streaming UX, artifact persistence, and trace/checkpoint/resume are proven without exposing provider/runtime/artifact/trace controls to the applet',
      ],
    },
  },
];

const requiredRealProductAggregateGates = [
  {
    script: 'applet:atelier-real-product-gate',
    evidence: ['tooling/acceptance/evidence/applets/official-applet/atelier-real-product-gate.json'],
    expectedEvidenceClass: 'REAL_PRODUCT_PATH',
    requiredProves: ['/v1/workspace'],
    requiredDoesNotProve: ['arbitrary network failure outside controlled pre-replay/post-replay Station SSE EOF'],
  },
  {
    script: 'applet:atelier-product-window-gate',
    evidence: ['tooling/acceptance/evidence/applets/official-applet/atelier-product-window-gate.json'],
    expectedGate: 'applet:atelier-product-window-gate',
    expectedEvidenceClass: 'REAL_PRODUCT_PATH',
    requiredProves: ['packaged peers.atelier renders inside the normal Desktop product shell'],
    requiredDoesNotProve: ['complete Host + Station + applet E2E'],
  },
  {
    script: 'applet:atelier-product-window-failure-matrix-gate',
    evidence: ['tooling/acceptance/evidence/applets/official-applet/atelier-product-window-failure-matrix-gate.json'],
    expectedGate: 'applet:atelier-product-window-failure-matrix-gate',
    expectedEvidenceClass: 'REAL_PRODUCT_PATH',
    requiredProves: ['official peers.atelier reports controller.subscribe-rejected diagnostics from the real Desktop product window UI'],
    requiredDoesNotProve: ['complete Host + Station + applet E2E'],
  },
  {
    script: 'applet:atelier-product-window-cross-restart-gate',
    evidence: ['tooling/acceptance/evidence/applets/official-applet/atelier-product-window-cross-restart-gate.json'],
    expectedGate: 'applet:atelier-product-window-cross-restart-gate',
    expectedEvidenceClass: 'REAL_PRODUCT_PATH',
    requiredProves: ['Desktop Gateway persists the Atelier projection cursor to the product-window storage root'],
    requiredDoesNotProve: ['complete Host + Station + applet E2E'],
  },
  {
    script: 'applet:atelier-decision-product-window-gate',
    evidence: ['tooling/acceptance/evidence/applets/official-applet/atelier-decision-product-window-gate.json'],
    expectedGate: 'applet:atelier-decision-product-window-gate',
    expectedEvidenceClass: 'REAL_PRODUCT_PATH',
    requiredProves: ['official peers.atelier submits a decision option through /v1/escalations:resolve service binding inside the real Desktop product window UI'],
    requiredDoesNotProve: ['complete Host + Station + applet E2E'],
  },
  {
    script: 'applet:atelier-live-resume-product-window-gate',
    evidence: ['tooling/acceptance/evidence/applets/official-applet/atelier-live-resume-product-window-gate.json'],
    expectedGate: 'applet:atelier-live-resume-product-window-gate',
    expectedEvidenceClass: 'REAL_PRODUCT_PATH',
    requiredProves: ['Station ResolveCollaborationInterrupt wakes an in-flight LiveResumeBroker waiter'],
    requiredDoesNotProve: ['complete Host + Station + applet E2E'],
  },
  {
    script: 'applet:atelier-artifact-gate-product-window-gate',
    evidence: ['tooling/acceptance/evidence/applets/official-applet/atelier-artifact-gate-product-window-gate.json'],
    expectedGate: 'applet:atelier-artifact-gate-product-window-gate',
    expectedEvidenceClass: 'REAL_PRODUCT_PATH',
    requiredProves: ['official peers.atelier submits the Station-projected sandbox preview target through atelier.artifact.preview.open and receives a Desktop Host-owned rendered sandbox surface descriptor'],
    requiredDoesNotProve: ['complete Host + Station + applet E2E'],
  },
  {
    script: 'applet:atelier-artifact-body-fetch-product-window-gate',
    evidence: ['tooling/acceptance/evidence/applets/official-applet/atelier-artifact-body-fetch-product-window-gate.json'],
    expectedGate: 'applet:atelier-artifact-body-fetch-product-window-gate',
    expectedEvidenceClass: 'REAL_PRODUCT_PATH',
    requiredProves: ['official peers.atelier fetches the Station-owned safe text artifact body through /v1/artifact/body/fetch service binding in the normal Desktop product window'],
    requiredDoesNotProve: ['complete Host + Station + applet E2E'],
  },
  {
    script: 'applet:atelier-artifact-gate-recovery-product-window-gate',
    evidence: ['tooling/acceptance/evidence/applets/official-applet/atelier-artifact-gate-recovery-product-window-gate.json'],
    expectedGate: 'applet:atelier-artifact-gate-product-window-gate',
    expectedEvidenceClass: 'REAL_PRODUCT_PATH',
    requiredProves: ['Station fixture keeps the blocking gate pending and does not grant applet artifact/gate production or execution capability'],
    requiredDoesNotProve: ['complete Host + Station + applet E2E'],
  },
  {
    script: 'applet:atelier-artifact-gate-recovery-variants-product-window-gate',
    evidence: [
      'tooling/acceptance/evidence/applets/official-applet/atelier-artifact-gate-recovery-accept-risk-product-window-gate.json',
      'tooling/acceptance/evidence/applets/official-applet/atelier-artifact-gate-recovery-continue-product-window-gate.json',
      'tooling/acceptance/evidence/applets/official-applet/atelier-artifact-gate-recovery-cancel-product-window-gate.json',
    ],
    expectedGate: 'applet:atelier-artifact-gate-product-window-gate',
    expectedEvidenceClass: 'REAL_PRODUCT_PATH',
    requiredProves: ['Station fixture keeps the blocking gate pending and does not grant applet artifact/gate production or execution capability'],
    requiredDoesNotProve: ['complete Host + Station + applet E2E'],
  },
];

const requiredProductWindowFailureMatrixScenarios = [
  {
    scenario: 'auth-denied',
    expectedErrorKind: 'auth-denied',
    expectedRetryable: false,
    expectedRetryDelayMs: null,
  },
  {
    scenario: 'disconnected',
    expectedErrorKind: 'disconnected',
    expectedRetryable: true,
    expectedRetryDelayMs: 500,
  },
  {
    scenario: 'timeout',
    expectedErrorKind: 'disconnected',
    expectedRetryable: true,
    expectedRetryDelayMs: 500,
  },
];

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'required controlled evidence JSON descriptors validate ok/status, expected gate, expected evidenceClass, claimBoundary.readiness=NOT_READY, and selected semantic anchors',
    'scripted real-product aggregate child evidence descriptors validate ok, expected gate, REAL_PRODUCT_PATH evidenceClass, claimBoundary.readiness=NOT_READY, and selected semantic anchors',
    'final readiness remains blocked until full Host + Station + applet E2E evidence is present',
  ],
  doesNotProve: [
    'full Host + Station + applet E2E',
    'real IDE launch',
    'production provider/model/runtime quality',
    'global Atelier readiness',
  ],
};

const readyClaimBoundary = {
  readiness: 'READY',
  proves: [
    'required controlled evidence JSON descriptors validate ok/status, expected gate, expected evidenceClass, claimBoundary.readiness=NOT_READY, and selected semantic anchors',
    'scripted real-product aggregate child evidence descriptors validate ok, expected gate, REAL_PRODUCT_PATH evidenceClass, claimBoundary.readiness=NOT_READY, and selected semantic anchors',
    'final full E2E evidence is present as ok=true REAL_PRODUCT_PATH and covers Desktop Host, Station handshakes, applet UI action, real IDE launch, and provider/runtime quality',
  ],
  doesNotProve: [
    'post-merge production deployment health',
  ],
};

function readJson(relativePath) {
  const absolutePath = path.resolve(evidenceRoot, relativePath);
  assert.ok(existsSync(absolutePath), `missing evidence: ${relativePath}`);
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

function assertString(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.ok(value.trim(), `${label} must be non-empty`);
  return value;
}

function readIndependentFinalEvidence(relativePath, label, expectedPath) {
  const evidencePath = assertString(relativePath, `${label} evidence path`);
  assert.ok(
    evidencePath.startsWith('tooling/acceptance/evidence/applets/official-applet/'),
    `${label} evidence path must stay under official applet evidence root`,
  );
  assert.equal(evidencePath, expectedPath, `${label} evidence path must be ${expectedPath}`);
  return {
    path: evidencePath,
    document: readJson(evidencePath),
  };
}

function assertIndependentEvidenceNotSynthetic(evidence, evidencePath) {
  assert.notEqual(evidence.syntheticOnly, true, `${evidencePath} must not be syntheticOnly`);
  assert.notEqual(evidence.controlledOnly, true, `${evidencePath} must not be controlledOnly`);
  assert.notEqual(evidence.controlledFixture, true, `${evidencePath} must not be controlledFixture`);
  assert.notEqual(evidence.evidenceClass, 'CONTROLLED_LOCAL_UPSTREAM', `${evidencePath} must not be controlled local evidence`);
  assert.notEqual(evidence.readiness, 'controlled_local_upstream', `${evidencePath} must not use controlled local readiness marker`);
}

function validateWorkspaceOpenAggregateEvidence(document) {
  const workspaceOpen = document.postReadyActions?.workspaceOpen;
  assert.equal(workspaceOpen?.status, 'PASS', `${fullE2EEvidencePath} must prove post-ready applet workspace action`);
  assert.equal(workspaceOpen.action, 'atelier.workspace.open', `${fullE2EEvidencePath} workspace open aggregate must prove atelier.workspace.open action`);
  assert.equal(workspaceOpen.mode, 'host_intent', `${fullE2EEvidencePath} workspace open aggregate must remain a Host intent`);
  assert.equal(workspaceOpen.accepted, true, `${fullE2EEvidencePath} workspace open aggregate must be accepted by Host intent`);
  assert.equal(workspaceOpen.opened, false, `${fullE2EEvidencePath} workspace open aggregate must not claim IDE opened`);
  assert.equal(workspaceOpen.realIdeLaunchProven, false, `${fullE2EEvidencePath} workspace open aggregate must not claim real IDE launch`);
  assert.equal(workspaceOpen.ideHintRedacted, true, `${fullE2EEvidencePath} workspace open aggregate must redact IDE hint`);
  assert.equal(workspaceOpen.ideTargetMatchesConfigured, true, `${fullE2EEvidencePath} workspace open aggregate must prove IDE target matched configured input`);
  assert.equal(document.ideLaunch?.ideTargetMatchesConfigured, true, `${fullE2EEvidencePath} IDE launch aggregate must prove IDE target matched configured input`);
  const taskId = assertString(workspaceOpen.taskId, `${fullE2EEvidencePath} workspace open aggregate taskId`);
  const workspaceUri = assertString(workspaceOpen.workspaceUri, `${fullE2EEvidencePath} workspace open aggregate workspaceUri`);
  const parsedWorkspaceUri = new URL(workspaceUri);
  assert.equal(parsedWorkspaceUri.protocol, 'pt-workspace:', `${fullE2EEvidencePath} workspace open aggregate must use pt-workspace URI`);
  assert.equal(parsedWorkspaceUri.hostname, 'task', `${fullE2EEvidencePath} workspace open aggregate URI host must be task`);
  const taskPath = parsedWorkspaceUri.pathname.split('/').filter(Boolean);
  assert.equal(taskPath.length, 1, `${fullE2EEvidencePath} workspace open aggregate URI must include one task path segment`);
  assert.equal(decodeURIComponent(taskPath[0]), taskId, `${fullE2EEvidencePath} workspace open aggregate task path must match taskId`);
  assert.equal(parsedWorkspaceUri.searchParams.getAll('workspace').length, 1, `${fullE2EEvidencePath} workspace open aggregate must include one workspace query`);
  assertString(parsedWorkspaceUri.searchParams.get('workspace'), `${fullE2EEvidencePath} workspace open aggregate workspace query`);
  const serializedWorkspaceOpen = JSON.stringify(workspaceOpen);
  assert.equal(serializedWorkspaceOpen.includes('file://'), false, `${fullE2EEvidencePath} workspace open aggregate must not expose file URLs`);
  assert.equal(serializedWorkspaceOpen.includes('"shell"'), false, `${fullE2EEvidencePath} workspace open aggregate must not expose shell authority`);
  assert.equal(serializedWorkspaceOpen.includes('"openExternalUrl"'), false, `${fullE2EEvidencePath} workspace open aggregate must not expose openExternalUrl authority`);
}

function validateIndependentIdeLaunchEvidence(document, ideEvidence) {
  const evidence = ideEvidence.document;
  assertIndependentEvidenceNotSynthetic(evidence, ideEvidence.path);
  assert.equal(evidence.ok, true, `${ideEvidence.path} must be ok=true`);
  assert.equal(evidence.appletId, 'peers.atelier', `${ideEvidence.path} must prove peers.atelier`);
  assert.equal(evidence.launchId, document.desktopLaunch?.readyEvidence?.launchId, `${ideEvidence.path} launchId must match Desktop launch evidence`);
  assert.equal(evidence.sessionId, document.desktopLaunch?.readyEvidence?.sessionId, `${ideEvidence.path} sessionId must match Desktop launch evidence`);
  assert.equal(evidence.action, 'atelier.workspace.open', `${ideEvidence.path} must be bound to atelier.workspace.open`);
  assert.equal(evidence.taskId, document.postReadyActions?.workspaceOpen?.taskId, `${ideEvidence.path} taskId must match workspace open evidence`);
  assert.equal(evidence.workspaceUri, document.postReadyActions?.workspaceOpen?.workspaceUri, `${ideEvidence.path} workspaceUri must match workspace open evidence`);
  assert.equal(evidence.ideTargetRedacted, true, `${ideEvidence.path} must redact ideTarget`);
  assertString(evidence.ideTargetHash, `${ideEvidence.path} must include ideTargetHash`);
  assert.equal(document.ideLaunch?.ideTargetRedacted, true, `${ideEvidence.path} final aggregate must redact ideTarget`);
  assert.equal(document.ideLaunch?.ideTargetMatchesConfigured, true, `${ideEvidence.path} final aggregate must prove ideTarget matched configured input`);
  assert.equal(evidence.realIdeLaunchProven, true, `${ideEvidence.path} must prove real IDE launch`);
  assert.equal(evidence.launchOwner, 'desktop_host', `${ideEvidence.path} must be owned by Desktop Host`);
  assert.equal(document.ideLaunch?.launchOwner, evidence.launchOwner, `${ideEvidence.path} launchOwner must match final evidence`);
  assertString(evidence.resolver, `${ideEvidence.path} must include workspace resolver`);
  assert.equal(document.ideLaunch?.resolver, evidence.resolver, `${ideEvidence.path} resolver must match final evidence`);
  assertString(evidence.launchCommand, `${ideEvidence.path} must include launch command identifier`);
  assert.equal(evidence.appletFileShellExecuteExposed, false, `${ideEvidence.path} must not expose file/shell/execute to applet`);
  assert.equal(evidence.appletOpenExternalUrlExposed, false, `${ideEvidence.path} must not expose openExternalUrl to applet`);
  assertString(evidence.completedAt, `${ideEvidence.path} must include completedAt timestamp`);
}

function validateIndependentProviderRuntimeEvidence(document, providerEvidence) {
  const evidence = providerEvidence.document;
  assertIndependentEvidenceNotSynthetic(evidence, providerEvidence.path);
  assert.equal(evidence.ok, true, `${providerEvidence.path} must be ok=true`);
  assert.equal(evidence.appletId, 'peers.atelier', `${providerEvidence.path} must prove peers.atelier`);
  assert.equal(evidence.launchId, document.desktopLaunch?.readyEvidence?.launchId, `${providerEvidence.path} launchId must match Desktop launch evidence`);
  assert.equal(evidence.sessionId, document.desktopLaunch?.readyEvidence?.sessionId, `${providerEvidence.path} sessionId must match Desktop launch evidence`);
  assert.equal(evidence.owner, 'station', `${providerEvidence.path} must be Station-owned`);
  assert.equal(document.providerRuntime?.owner, evidence.owner, `${providerEvidence.path} owner must match final evidence`);
  assert.equal(evidence.scope, 'production-provider-runtime', `${providerEvidence.path} must use production-provider-runtime scope`);
  assert.equal(document.providerRuntime?.scope, evidence.scope, `${providerEvidence.path} scope must match final evidence`);
  assert.equal(evidence.providerProfileRefRedacted, true, `${providerEvidence.path} must redact providerProfileRef`);
  assertString(evidence.providerProfileRefHash, `${providerEvidence.path} must include providerProfileRefHash`);
  assert.equal(document.providerRuntime?.providerProfileRefRedacted, true, `${providerEvidence.path} final aggregate must redact providerProfileRef`);
  assert.equal(document.providerRuntime?.providerProfileRefMatchesConfigured, true, `${providerEvidence.path} final aggregate must prove providerProfileRef matched configured input`);
  assert.equal(evidence.providerRuntimeProven, true, `${providerEvidence.path} must prove provider runtime`);
  assert.equal(evidence.providerModelQualityProven, true, `${providerEvidence.path} must prove provider model quality`);
  assert.equal(evidence.streamingReplyUXProven, true, `${providerEvidence.path} must prove streaming reply UX`);
  assert.equal(evidence.artifactPersistenceProven, true, `${providerEvidence.path} must prove artifact persistence`);
  assert.equal(evidence.traceCheckpointResumeProven, true, `${providerEvidence.path} must prove trace/checkpoint/resume`);
  assert.equal(evidence.appletProviderInvokeExposed, false, `${providerEvidence.path} must not expose provider invoke to applet`);
  assert.equal(evidence.appletRuntimeExecuteExposed, false, `${providerEvidence.path} must not expose runtime execute to applet`);
  assert.equal(evidence.appletArtifactWriteExposed, false, `${providerEvidence.path} must not expose artifact writes to applet`);
  assert.equal(evidence.appletTraceCheckpointResumeExposed, false, `${providerEvidence.path} must not expose Trace/Checkpoint/Resume to applet`);
  assertString(evidence.completedAt, `${providerEvidence.path} must include completedAt timestamp`);
}

function assertSemanticAnchors(document, anchors, relativePath, fieldName, label) {
  if (anchors === undefined) {
    return;
  }
  const fallbackFieldName = fieldName === 'proves' ? 'coveredPaths' : 'notCovered';
  const candidates = [
    document[fieldName],
    document.claimBoundary?.[fieldName],
    document[fallbackFieldName],
  ].filter(Array.isArray);
  assert.ok(candidates.length > 0, `${relativePath} must include ${fieldName} array for ${label}`);
  const values = new Set(candidates.flat());
  for (const anchor of anchors) {
    assert.ok(values.has(anchor), `${relativePath} must include ${label}: ${anchor}`);
  }
}

function readRequiredP4ReadinessDocSyncSliceIds() {
  const source = readFileSync(projectionContractGateSourcePath, 'utf8');
  const registryMatch = source.match(/const p4ReadinessDocSyncSlices = \[([\s\S]*?)\n\];/);
  assert.ok(registryMatch, 'completion readiness audit must parse p4ReadinessDocSyncSlices registry from projection contract gate source');
  const sliceIds = Array.from(registryMatch[1].matchAll(/id:\s*'(?<id>P4-\d+)'/g), (match) => match.groups.id);
  assert.ok(sliceIds.length >= 57, 'completion readiness audit projection contract registry must include P4 documentation-ledger guards');
  assert.ok(sliceIds.includes('P4-298'), 'completion readiness audit projection contract registry must include P4-298');
  return sliceIds;
}

const requiredP4ReadinessDocSyncSliceIds = readRequiredP4ReadinessDocSyncSliceIds();

function validateProjectionContractDocSyncSelfCheck(document, relativePath) {
  if (document.gate !== 'atelier:projection-contract-gate') {
    return undefined;
  }
  assert.equal(
    document.docSyncSelfCheck?.status,
    'PASS',
    `${relativePath} docSyncSelfCheck.status must be PASS`,
  );
  assert.ok(
    document.docSyncSelfCheck.sliceCount >= 57,
    `${relativePath} docSyncSelfCheck.sliceCount must cover P4 documentation-ledger guards`,
  );
  for (const requiredSliceId of requiredP4ReadinessDocSyncSliceIds) {
    assert.ok(
      document.docSyncSelfCheck.trackedSliceIds?.includes(requiredSliceId),
      `${relativePath} docSyncSelfCheck.trackedSliceIds must include ${requiredSliceId}`,
    );
  }
  assert.deepEqual(
    document.docSyncSelfCheck.trackedSliceIds,
    requiredP4ReadinessDocSyncSliceIds,
    `${relativePath} docSyncSelfCheck.trackedSliceIds must match projection contract registry`,
  );
  assert.deepEqual(
    document.docSyncSelfCheck.missingAnchors,
    [],
    `${relativePath} docSyncSelfCheck.missingAnchors must be empty`,
  );
  for (const requiredDocument of [
    'docs/architecture/atelier/prototype/README.md',
    'tooling/acceptance/evidence/applets/official-applet/atelier-acceptance-evidence-report-2026-07-06.md',
    'tooling/acceptance/evidence/applets/official-applet/atelier-completion-audit-2026-07-06.md',
    'tmp/atelier-master-goal.md',
  ]) {
    assert.ok(
      document.docSyncSelfCheck.requiredDocuments?.includes(requiredDocument),
      `${relativePath} docSyncSelfCheck.requiredDocuments must include ${requiredDocument}`,
    );
    assert.ok(
      document.docSyncSelfCheck.notReadyBoundaryDocuments?.includes(requiredDocument),
      `${relativePath} docSyncSelfCheck.notReadyBoundaryDocuments must include ${requiredDocument}`,
    );
  }
  return {
    status: document.docSyncSelfCheck.status,
    sliceCount: document.docSyncSelfCheck.sliceCount,
    trackedSliceIds: document.docSyncSelfCheck.trackedSliceIds,
    requiredDocuments: document.docSyncSelfCheck.requiredDocuments,
    notReadyBoundaryDocuments: document.docSyncSelfCheck.notReadyBoundaryDocuments,
  };
}

function validateProductWindowFailureMatrixEvidence(document, relativePath) {
  if (relativePath !== 'tooling/acceptance/evidence/applets/official-applet/atelier-product-window-failure-matrix-gate.json') {
    return undefined;
  }
  assert.equal(
    document.gate,
    'applet:atelier-product-window-failure-matrix-gate',
    `${relativePath} must be the product-window failure matrix gate`,
  );
  assert.ok(Array.isArray(document.scenarios), `${relativePath} must include scenarios array`);
  const scenariosByName = new Map(document.scenarios.map((scenario) => [scenario?.scenario, scenario]));
  for (const requiredScenario of requiredProductWindowFailureMatrixScenarios) {
    const scenario = scenariosByName.get(requiredScenario.scenario);
    assert.ok(scenario, `${relativePath} must include ${requiredScenario.scenario} scenario`);
    assert.equal(
      scenario.expectedErrorKind,
      requiredScenario.expectedErrorKind,
      `${relativePath} ${requiredScenario.scenario} scenario must preserve expectedErrorKind`,
    );
    assert.equal(
      scenario.expectedRetryable,
      requiredScenario.expectedRetryable,
      `${relativePath} ${requiredScenario.scenario} scenario must preserve expectedRetryable`,
    );
    assert.equal(
      scenario.expectedRetryDelayMs,
      requiredScenario.expectedRetryDelayMs,
      `${relativePath} ${requiredScenario.scenario} scenario must preserve expectedRetryDelayMs`,
    );
    assert.equal(
      scenario.stationGateServer?.failureScenario,
      requiredScenario.scenario,
      `${relativePath} ${requiredScenario.scenario} scenario must bind Station gate failureScenario`,
    );
    assert.equal(
      scenario.productShellEvidence?.productShell,
      true,
      `${relativePath} ${requiredScenario.scenario} scenario must prove Desktop product shell`,
    );
    const controllerProperties = scenario.diagnostics?.controllerRejection?.properties;
    assert.equal(
      controllerProperties?.stage,
      'controller.subscribe-rejected',
      `${relativePath} ${requiredScenario.scenario} scenario must include controller.subscribe-rejected diagnostic`,
    );
    assert.equal(
      controllerProperties?.errorKind,
      requiredScenario.expectedErrorKind,
      `${relativePath} ${requiredScenario.scenario} controller diagnostic must preserve expected errorKind`,
    );
    assert.equal(
      controllerProperties?.retryable,
      requiredScenario.expectedRetryable,
      `${relativePath} ${requiredScenario.scenario} controller diagnostic must preserve retryable`,
    );
    assert.equal(
      controllerProperties?.retryDelayMs,
      requiredScenario.expectedRetryDelayMs,
      `${relativePath} ${requiredScenario.scenario} controller diagnostic must preserve retryDelayMs`,
    );
    assert.equal(
      scenario.diagnostics?.clientRejection?.properties?.stage,
      'client.subscribe-rejected',
      `${relativePath} ${requiredScenario.scenario} scenario must include client.subscribe-rejected diagnostic`,
    );
    assert.ok(
      Number.isInteger(scenario.diagnostics?.diagnosticCount) && scenario.diagnostics.diagnosticCount > 0,
      `${relativePath} ${requiredScenario.scenario} scenario must include diagnosticCount`,
    );
  }
  assert.equal(
    document.scenarios.length,
    requiredProductWindowFailureMatrixScenarios.length,
    `${relativePath} must not hide extra product-window failure matrix scenarios from audit`,
  );
  return {
    requiredScenarios: requiredProductWindowFailureMatrixScenarios.map((scenario) => scenario.scenario),
    scenarioCount: document.scenarios.length,
  };
}

function validateEvidence(descriptor) {
  const document = readJson(descriptor.path);
  const passed = document.ok === true || document.status === 'PASS';
  assert.equal(passed, true, `${descriptor.path} must be ok=true or status=PASS`);
  assert.equal(
    document.claimBoundary?.readiness,
    'NOT_READY',
    `${descriptor.path} must preserve claimBoundary.readiness=NOT_READY`,
  );
  if (descriptor.expectedGate !== undefined) {
    assert.equal(document.gate, descriptor.expectedGate, `${descriptor.path} must use gate=${descriptor.expectedGate}`);
  }
  assert.equal(
    document.evidenceClass,
    descriptor.expectedEvidenceClass,
    `${descriptor.path} must use evidenceClass=${descriptor.expectedEvidenceClass}`,
  );
  assertSemanticAnchors(document, descriptor.requiredProves, descriptor.path, 'proves', 'required proves anchor');
  assertSemanticAnchors(
    document,
    descriptor.requiredDoesNotProve,
    descriptor.path,
    'doesNotProve',
    'required doesNotProve anchor',
  );
  const docSyncSelfCheck = validateProjectionContractDocSyncSelfCheck(document, descriptor.path);
  const productWindowFailureMatrix = validateProductWindowFailureMatrixEvidence(document, descriptor.path);
  return {
    path: descriptor.path,
    ok: document.ok,
    status: document.status,
    gate: document.gate,
    readiness: document.claimBoundary?.readiness,
    evidenceClass: document.evidenceClass,
    docSyncSelfCheck,
    productWindowFailureMatrix,
    requiredProves: descriptor.requiredProves ?? [],
    requiredDoesNotProve: descriptor.requiredDoesNotProve ?? [],
  };
}

function semanticRequirementCount(descriptor) {
  return (descriptor.requiredProves?.length ?? 0) + (descriptor.requiredDoesNotProve?.length ?? 0);
}

function validateDescriptorSemanticRequirements() {
  const zeroRequiredDescriptors = requiredEvidence
    .filter((descriptor) => semanticRequirementCount(descriptor) === 0)
    .map((descriptor) => descriptor.path);
  const zeroRequiredAggregateDescriptors = requiredRealProductAggregateGates
    .filter((descriptor) => semanticRequirementCount(descriptor) === 0)
    .map((descriptor) => descriptor.script);

  assert.deepEqual(
    zeroRequiredDescriptors,
    [],
    'completion readiness audit descriptors must not include zero required semantic anchors',
  );
  assert.deepEqual(
    zeroRequiredAggregateDescriptors,
    [],
    'completion readiness aggregate descriptors must not include zero required semantic anchors',
  );

  return {
    status: 'PASS',
    requiredEvidenceDescriptorCount: requiredEvidence.length,
    requiredRealProductAggregateDescriptorCount: requiredRealProductAggregateGates.length,
    zeroRequiredDescriptors,
    zeroRequiredAggregateDescriptors,
  };
}

function validateRealProductAggregateCoverage() {
  const aggregate = readJson('tooling/acceptance/evidence/applets/official-applet/atelier-real-product-gates-aggregate.json');
  assert.equal(aggregate.ok, true, 'real-product aggregate evidence must be ok=true');
  assert.equal(aggregate.evidenceClass, 'REAL_PRODUCT_PATH', 'real-product aggregate evidence must be REAL_PRODUCT_PATH');
  assert.equal(aggregate.gate, 'atelier:real-product-gates', 'real-product aggregate evidence must use atelier:real-product-gates gate');
  assert.equal(
    aggregate.claimBoundary?.readiness,
    'NOT_READY',
    'real-product aggregate evidence must preserve claimBoundary.readiness=NOT_READY',
  );
  assert.ok(Array.isArray(aggregate.details), 'real-product aggregate evidence must contain child gate details');

  return requiredRealProductAggregateGates.map((requiredGate) => {
    const detail = aggregate.details.find((entry) => entry?.script === requiredGate.script);
    assert.ok(detail, `real-product aggregate must include child gate: ${requiredGate.script}`);
    assert.ok(Array.isArray(detail.evidence), `${requiredGate.script} aggregate detail must include evidence array`);
    const evidencePaths = new Set(detail.evidence.map((entry) => entry?.path).filter(Boolean));
    for (const requiredEvidencePath of requiredGate.evidence) {
      assert.ok(
        evidencePaths.has(requiredEvidencePath),
        `${requiredGate.script} aggregate detail must include evidence: ${requiredEvidencePath}`,
      );
    }
    return {
      script: requiredGate.script,
      evidence: requiredGate.evidence.map((requiredEvidencePath) => {
        const document = readJson(requiredEvidencePath);
        assert.equal(document.ok, true, `${requiredGate.script} child evidence must be ok=true: ${requiredEvidencePath}`);
        assert.equal(
          document.claimBoundary?.readiness,
          'NOT_READY',
          `${requiredGate.script} child evidence must preserve claimBoundary.readiness=NOT_READY: ${requiredEvidencePath}`,
        );
        if (requiredGate.expectedGate !== undefined) {
          assert.equal(
            document.gate,
            requiredGate.expectedGate,
            `${requiredGate.script} child evidence must use aggregate child gate=${requiredGate.expectedGate}: ${requiredEvidencePath}`,
          );
        }
        assert.equal(
          document.evidenceClass,
          requiredGate.expectedEvidenceClass,
          `${requiredGate.script} child evidence must use aggregate child evidenceClass=${requiredGate.expectedEvidenceClass}: ${requiredEvidencePath}`,
        );
        assertSemanticAnchors(
          document,
          requiredGate.requiredProves,
          requiredEvidencePath,
          'proves',
          'aggregate child required proves anchor',
        );
        assertSemanticAnchors(
          document,
          requiredGate.requiredDoesNotProve,
          requiredEvidencePath,
          'doesNotProve',
          'aggregate child required doesNotProve anchor',
        );
          const productWindowFailureMatrix = validateProductWindowFailureMatrixEvidence(document, requiredEvidencePath);
        return {
          path: requiredEvidencePath,
          ok: document.ok,
          gate: document.gate,
          readiness: document.claimBoundary?.readiness,
          evidenceClass: document.evidenceClass,
            productWindowFailureMatrix,
          requiredProves: requiredGate.requiredProves,
          requiredDoesNotProve: requiredGate.requiredDoesNotProve,
        };
      }),
    };
  });
}

function validateFullE2EFinalEvidence() {
  if (!existsSync(path.resolve(fullE2EEvidencePath))) {
    return {
      path: fullE2EEvidencePath,
      status: 'MISSING',
      missingFinalEvidence: finalEvidenceRequirements,
    };
  }

  const document = readJson(fullE2EEvidencePath);
  if (document.ok !== true) {
    return {
      path: fullE2EEvidencePath,
      status: 'NOT_READY',
      ok: document.ok,
      failureMode: document.failureMode,
      readiness: document.readiness,
      globalReady: document.globalReady,
      missingFinalEvidence: finalEvidenceRequirements.map((item) => ({
        ...item,
        blockingEvidence: {
          path: fullE2EEvidencePath,
          failureMode: document.failureMode ?? 'FULL_E2E_NOT_OK',
        },
      })),
    };
  }

  assert.equal(document.evidenceClass, 'REAL_PRODUCT_PATH', `${fullE2EEvidencePath} must be REAL_PRODUCT_PATH when ok=true`);
  assert.equal(document.gate, 'atelier:full-e2e', `${fullE2EEvidencePath} must be atelier:full-e2e`);
  assert.notEqual(
    document.syntheticOnly,
    true,
    `${fullE2EEvidencePath} ok=true evidence must not be syntheticOnly`,
  );
  assert.equal(document.readiness, 'NOT_READY', `${fullE2EEvidencePath} must leave final readiness decision to completion audit`);
  assert.equal(document.globalReady, false, `${fullE2EEvidencePath} must leave globalReady decision to completion audit`);
  assert.equal(document.runtimeHandshakes?.stationWorkspace?.status, 'PASS', `${fullE2EEvidencePath} must prove Station workspace handshake`);
  assert.equal(document.runtimeHandshakes?.providerCapabilities?.status, 'PASS', `${fullE2EEvidencePath} must prove Station provider capabilities handshake`);
  assert.equal(document.desktopLaunch?.status, 'PASS', `${fullE2EEvidencePath} must prove Desktop Host launch`);
  assert.equal(document.desktopLaunch?.readyEvidence?.stationUrlRedacted, true, `${fullE2EEvidencePath} Desktop ready aggregate must redact Station URL`);
  assert.equal(document.desktopLaunch?.readyEvidence?.stationUrlMatchesConfigured, true, `${fullE2EEvidencePath} Desktop ready aggregate must prove Station URL matched configured input`);
  validateWorkspaceOpenAggregateEvidence(document);
  assert.equal(document.ideLaunch?.status, 'PASS', `${fullE2EEvidencePath} must prove real IDE launch`);
  assert.equal(document.ideLaunch?.realIdeLaunchProven, true, `${fullE2EEvidencePath} must prove real IDE launch`);
  assert.equal(document.providerRuntime?.status, 'PASS', `${fullE2EEvidencePath} must prove provider/runtime quality`);
  assert.equal(document.providerRuntime?.providerRuntimeProven, true, `${fullE2EEvidencePath} must prove provider runtime`);
  assert.equal(document.providerRuntime?.providerModelQualityProven, true, `${fullE2EEvidencePath} must prove provider model quality`);
  assert.equal(document.providerRuntime?.streamingReplyUXProven, true, `${fullE2EEvidencePath} must prove streaming reply UX`);
  assert.equal(document.providerRuntime?.artifactPersistenceProven, true, `${fullE2EEvidencePath} must prove artifact persistence`);
  assert.equal(document.providerRuntime?.traceCheckpointResumeProven, true, `${fullE2EEvidencePath} must prove trace/checkpoint/resume`);
  const ideLaunchEvidence = readIndependentFinalEvidence(
    document.ideLaunch?.path,
    'real IDE launch',
    canonicalIdeLaunchEvidencePath,
  );
  validateIndependentIdeLaunchEvidence(document, ideLaunchEvidence);
  const providerRuntimeEvidence = readIndependentFinalEvidence(
    document.providerRuntime?.path,
    'provider/runtime quality',
    canonicalProviderRuntimeEvidencePath,
  );
  validateIndependentProviderRuntimeEvidence(document, providerRuntimeEvidence);
  assert.equal(
    document.claimBoundary?.readiness,
    'NOT_READY',
    `${fullE2EEvidencePath} ok=true evidence must keep claimBoundary.readiness=NOT_READY`,
  );
  assertSemanticAnchors(
    document,
    ['global Atelier readiness'],
    fullE2EEvidencePath,
    'doesNotProve',
    'final E2E required doesNotProve anchor',
  );

  return {
    path: fullE2EEvidencePath,
    status: 'PRESENT',
    ok: true,
    evidenceClass: document.evidenceClass,
    finalEvidence: finalEvidenceRequirements.map((item) => ({
      ...item,
      status: 'PRESENT',
      evidencePath: item.id === 'real-ide-launch'
        ? ideLaunchEvidence.path
        : item.id === 'production-provider-runtime-quality'
          ? providerRuntimeEvidence.path
          : fullE2EEvidencePath,
    })),
    missingFinalEvidence: [],
  };
}

function main() {
  const descriptorSelfCheck = validateDescriptorSemanticRequirements();
  const validatedEvidence = requiredEvidence.map(validateEvidence);
  const realProductAggregateCoverage = validateRealProductAggregateCoverage();
  const fullE2EFinalEvidence = validateFullE2EFinalEvidence();
  const missingFinalEvidence = fullE2EFinalEvidence.missingFinalEvidence;
  const readiness = missingFinalEvidence.length === 0 ? 'READY' : 'NOT_READY';
  const globalReady = readiness === 'READY';
  const activeClaimBoundary = globalReady ? readyClaimBoundary : claimBoundary;
  const document = {
    ok: true,
    evidenceClass: 'READINESS_AUDIT',
    readiness,
    globalReady,
    gate: 'atelier:completion-readiness-audit',
    descriptorSelfCheck,
    validatedEvidence,
    realProductAggregateCoverage,
    fullE2EFinalEvidence,
    finalEvidence: fullE2EFinalEvidence.finalEvidence ?? [],
    missingFinalEvidence,
    claimBoundary: activeClaimBoundary,
  };
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(document, null, 2)}\n`);
}

main();
