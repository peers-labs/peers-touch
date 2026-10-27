# EDX-H03: Recover From An Applet Materialization Failure

## Starting Context

The Desktop user opens an installed Applet from the product shell. Bundle
materialization, integrity validation or runtime loading fails before the Lynx
surface is mounted.

## User Goal

Understand that the Applet did not open, retry the same Applet when the failure
is recoverable, or leave without losing product-shell navigation.

## Required Sources

- `apps/desktop/src/store/applets.ts:337-420`
- `apps/desktop/src/pages/AppletRuntimePage.tsx:240-321`
- `apps/desktop/src/applet/AppletContainerShell.tsx:53-124`
- `docs/architecture/platform/applet-runtime/applet-lifecycle-architecture.md:100-127`
- `docs/client/common/ui-identity/interaction.md:55-80`

## States To Walk

- Applet projection loading;
- bundle materializing;
- load succeeds and the surface starts;
- load fails before the surface starts;
- user retries the requested Applet;
- user exits to the Applet list.

## Review Boundary

Review the visible failure and recovery route for pre-surface Applet loading.
Do not audit bundle cryptography, resource policy or post-mount Lynx errors.

Return the JSON ReviewResult required by `rubric.md`.
