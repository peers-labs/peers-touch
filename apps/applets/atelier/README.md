# Atelier Applet

Atelier is the personal Agent workbench applet. It does not own the multi-agent
orchestration engine; the backend source of truth remains the Station agent
subserver and peers-touch orchestration layer.

Current state:

- `applet.manifest.json` declares the runtime permissions needed by the Desktop
  applet gateway for `atelier.*` projection methods.
- The production Lynx frontend package is not scaffolded yet; the current UI
  implementation lives under `packages/prototypes/desktop/applets/atelier/`.
- `integrity.files.main.lynx.bundle` is a pending placeholder until the real
  Atelier applet bundle is produced.
