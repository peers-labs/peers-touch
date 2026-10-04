# Atelier Applet

Atelier is the personal Agent workbench applet. It does not own the multi-agent
orchestration engine; the backend source of truth remains the Station agent
subserver and peers-touch orchestration layer.

Current state:

- `applet.manifest.json` declares the runtime permissions needed by the Desktop
  applet gateway for `atelier.*` projection methods and the `atelier` station
  service binding.
  - `frontend/` is a Lynx official applet shell. It loads
    `/v1/workspace` through the Station-bundled `atelier` service binding,
    validates the projection snapshot shape, subscribes to `atelier.projection.event`, applies
  projection patches with event dedupe and stale-seq rejection, and renders
  loading / empty / reconciling / degraded / disconnected / auth-denied / error
  / ready states. The current product UI is a controlled single-column
  projection surface: task organizer, stream detail, Project Health / TaskGraph
  / Todo fallback, Context, Artifacts, Artifact Preview, and Gates panels stack
  as read-only projection sections with budget, run target, and replay metadata
  visible. New task creation currently calls `atelier.project.createFromGoal`
  as a create-from-goal shortcut and requires explicit `agentIds` from
  launch/global config; this is not the target draft Project flow. The target
  product flow remains `Project{state:draft}` first, with the first user
  message performing contract formation. Atelier does not infer Agents from
  model or flow state.
  Projection updates arrive through the generic
  `events.subscribe('atelier.projection.event')` Host topic. Desktop owns the
  single actor-scoped `/events/stream` connection, cursor, reconnect, and
  `Resync` handling. Atelier receives canonical invalidations and reloads the
  authoritative `/v1/workspace` snapshot; it never opens or configures a
  feature-owned Station stream.
  The new-task form includes a run target selector. The direct model path writes
  only `run.kind=model` / `run.model`; the agents path writes only
  `run.kind=agents` / `run.agentIds` and optional `run.flowId`. Both branches are
  Station-owned intents: the applet does not invoke providers, run models,
  orchestrate agents, execute CLI, or persist model preferences.
  The stream rail includes an Artifacts tray above the composer; selecting a
  tray card opens the same read-only metadata preview used by the right rail.
  Negotiation stream blocks render projected voices, evidence references, and
  evidence-less objections as concerns.
  Gates render projected summary, check details, and related artifact IDs as
  read-only metadata.
  Task lifecycle actions call `atelier.task.setStatus` / `atelier.task.purge`;
  purge remains a Station-validated second step after `deleted`, and the Lynx UI
  requires a second confirm tap before invoking purge. The composer sends text through
  `atelier.message.send`; decision options call
  `atelier.escalation.resolve`. Station remains responsible for user-message
  projection, interrupt-resolved events, and orchestration resume. Artifact
  preview is metadata-only: body refs, hashes, sizes, path lists, and
  Host-owned safe text / sandbox manifest intents may be shown, while raw URL,
  iframe, image, HTML, diff body, patch, and artifact body rendering remain
  outside the applet.
- The richer browser prototype remains under
  `packages/prototypes/desktop/applets/atelier/` and is the UX reference until
  the official Lynx UI is fully productized.
- `contracts/atelier-projection.contract.json` is the current machine-readable
  product contract for `atelier-projection/v0`; the projection contract gate
  reads it before checking TypeScript, Go, Rust, manifest, and capability drift.
- `pnpm applets:build` produces `apps/desktop/applets-dist/peers.atelier` and
  writes the real bundle integrity into the dist manifest. The source manifest
  keeps its pending integrity placeholder; `pnpm run
  applet:atelier-desktop-injection-gate` verifies that the Desktop package
  index, dist manifest integrity, and Atelier service binding are valid.
