# EDX-H05: Wait For An Applet To Become Ready

## Starting Context

The Desktop Applet runtime has created a Host surface. The Applet may emit
`lifecycle.reportReady`, may remain silent while Host content exists, or may
fail before readiness.

## User Goal

Know when the opened Applet is actually ready for interaction and avoid a false
completion state when readiness has not been established.

## Required Sources

- `apps/desktop/src/applet/LynxContainer.tsx:23-39`
- `apps/desktop/src/applet/LynxContainer.tsx:54-75`
- `apps/desktop/src/applet/LynxContainer.tsx:77-142`
- `apps/desktop/src/applet/LynxContainer.tsx:144-209`
- `apps/desktop/src/pages/AppletRuntimePage.tsx:212-238`
- `docs/architecture/platform/applet-runtime/applet-lifecycle-architecture.md:100-127`
- `docs/architecture/platform/applet-runtime/development-runtime-readiness-report.md:815-823`

## States To Walk

- Host slot bound and loading;
- Applet reports ready;
- Host content exists but the Applet does not report ready;
- readiness deadline passes;
- Host reports an error;
- retry after timeout or error;
- product-shell rendered evidence is emitted.

## Review Boundary

Review the visible readiness meaning and the claim emitted by this product
surface. Do not judge Applet business content, release certification or
third-party package authorship.

Return the JSON ReviewResult required by `rubric.md`.
