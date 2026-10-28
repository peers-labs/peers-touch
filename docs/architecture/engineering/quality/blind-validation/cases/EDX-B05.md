# EDX-B05: Complete a Normal OAuth Login

## Starting Context

The Desktop has a reachable, selected Station and at least one configured OAuth
provider. The user starts a normal account login.

## User Goal

Understand the current login state, cancel while waiting if needed, retry a
failure, and continue after success.

## Required Sources

- `apps/desktop/src/pages/login/views/LoginFormView.tsx:127-205`
- `apps/desktop/src/pages/login/views/LoginFormView.tsx:373-465`
- `apps/desktop/src/pages/login/LoginPage.oauth.test.ts:13-42`
- `docs/client/common/ui-identity/modules/auth/README.md:35-79`
- `docs/client/common/ui-identity/interaction.md:20-73`

## States To Walk

- idle;
- opening the browser;
- waiting for completion;
- initializing the account;
- success;
- user cancellation;
- error and retry;
- focus after cancellation or failure.

## Review Boundary

Review only the bounded OAuth action lifecycle after Station readiness. Do not
audit provider backend behavior, PIN setup, account switching, or unrelated
page styling.

Return the report required by `rubric.md`.
