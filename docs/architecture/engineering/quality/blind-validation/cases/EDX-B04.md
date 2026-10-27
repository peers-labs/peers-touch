# EDX-B04: Recover When the Selected Station Is Offline

## Starting Context

The Desktop login screen has a selected Station, but its probe reports
`offline`. Login actions are disabled. The same Station becomes reachable a
moment later.

## User Goal

Recover without losing the selected Station or credentials, then continue
login.

## Required Sources

- `apps/desktop/src/pages/login/views/LoginFormView.tsx:97-178`
- `apps/desktop/src/pages/login/views/LoginFormView.tsx:330-371`
- `apps/desktop/src/pages/login/views/LoginFormView.tsx:614-671`
- `apps/desktop/src/store/stationGate.ts:21-73`
- `apps/desktop/src/components/common/StationPicker.tsx:50-177`
- `docs/client/mobile/lifecycle.md:137-166`
- `docs/client/common/ui-identity/interaction.md:20-73`

## States To Walk

- reachability check in progress;
- selected Station offline;
- Station recovers without changing its URL;
- retry or refresh;
- choose another Station;
- login controls become available.

## Review Boundary

Review the visible recovery path and the state handoff between the notice,
Station picker, and login controls. Use the Mobile lifecycle only for the
shared product outcome, not for component parity.

Return the report required by `rubric.md`.
