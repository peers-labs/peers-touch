# Applet Reviewed Evidence

Git-tracked Applet readiness evidence is limited to reviewed, redacted JSON and
Markdown attestations. Raw logs, absolute machine paths, secrets, generated
bundles, databases, screenshots, harnesses, and source fixtures are forbidden.

Regenerable output belongs in `.artifacts/applet-readiness/`. Deterministic test
inputs belong in `tooling/fixtures/applets/`.

Gate scripts may promote a stable JSON/Markdown summary into this directory only
after removing machine paths, raw stdout/stderr, secrets, transient URLs, and
generated payloads. When raw material is needed for audit, the summary records
its artifact-relative path and SHA-256 digest.
