---
name: pt-oauth2-client-2-vercel
description: Publishes and verifies apps/oauth2-client on Vercel. Use for oauth2-client-2-vercel, deploy/publish oauth2-client to Vercel, or 发布 OAuth2 client server.
---

# OAuth2 Client To Vercel

## Invoke When

- Publishing or republishing `apps/oauth2-client` to Vercel.
- Preparing Vercel Preview or Production configuration for the OAuth2 broker.
- Checking whether a new OAuth provider is ready for Vercel publication.

Do not use this Skill for local-only broker development, provider application
ownership, or encryption-key rotation.

## Core Rules

- Operate the repository and browser yourself. Pause only for external login,
  CAPTCHA, or a provider platform's final confirmation to create or rotate an
  OAuth credential.
- Treat `tooling/skills/pt-oauth2-client-2-vercel/references/provider-catalog.json`
  as the only provider deployment context. Never override it at runtime or use
  chat memory as provider truth.
- Read the sibling `env/peers-touch-infra/oauth2-client-test/runtime.env`
  in place. Never copy it into this repository or print its values. Missing
  values are completed through a separately bound env-repository task, then
  this publishing run resumes; the source worktree never writes across roots.
- Send Vercel environment values through stdin. Never put secrets in argv,
  command text, logs, evidence, shell history, or generated files.
- Production must use `OAUTH_STORAGE_DRIVER=github`. Memory is local-only.
- Keep `api/**/index.go` as the Vercel Function entrypoints. Do not deploy
  `cmd/server` as one monolithic Go Framework server.
- Establish a stable HTTPS broker domain before registering provider callback
  URLs. Never register an ephemeral Preview URL.
- Verify Preview before Production. An environment change always requires a
  new deployment.
- Run key rotation only as a separately requested maintenance operation.

Read [application operations](../../../apps/oauth2-client/README.md),
[OAuth architecture](../../../docs/architecture/domains/identity/oauth-login-broker/README.md),
and [Vercel deployment context](./references/vercel.md) before external
operations. Read the provider catalog before provider discovery.

## Workflow

### 1. Bind Source And External State

1. Resolve and verify the repository root and current Plan/declaration when the
   project workflow requires them.
2. Use the pinned Vercel CLI version `62.1.0`. By default the sync script runs
   `npx --yes vercel@62.1.0`; an explicitly selected standalone binary must
   report the same version. Update the pin, reference, and tests together after
   checking current official CLI documentation.
3. Run `vercel whoami`. If authentication needs a browser login or CAPTCHA,
   hand over only that interaction, then resume.
4. Require `git check-ignore -q .vercel/project.json` to pass before linking;
   Vercel's machine-local project metadata must never dirty tracked source.
5. Run monorepo-aware CLI commands from the repository root. Discover the
   linked Vercel project with `vercel link --repo`; create or link it only when
   the user's deployment authorization covers that project.
6. Inspect project settings and require Root Directory
   `apps/oauth2-client`. Fix the setting before deployment.
7. Resolve the stable HTTPS domain and current deployment behind it. Record
   the previous target for rollback.
8. Inspect Preview protection. Provider callbacks and unauthenticated health
   checks must reach the candidate; otherwise return
   `PREVIEW_PROTECTION_BLOCKED` before changing aliases.

Do not infer a project, team, domain, or provider application from local names.

### 2. Discover Providers And Preflight

Run from the repository root:

```bash
python3 tooling/skills/pt-oauth2-client-2-vercel/scripts/preflight.py \
  --repo-root . \
  --env-file ../env/peers-touch-infra/oauth2-client-test/runtime.env \
  --base-url https://oauth.example.com \
  --return-to peers-touch://oauth/callback \
  --return-to http://127.0.0.1/callback
```

The script discovers providers and wiring from:

- `internal/domain/oauth/valueobject/provider.go`;
- `internal/infrastructure/provider/*`;
- `api/oauth/*/{start,callback}/index.go`;
- `config/sites*.json`;
- `internal/bootstrap/config.go`;
- provider tests.

It compares every discovered provider with the catalog. Any unknown provider,
missing route/adapter/test/env prefix, or catalog mismatch is
`PROVIDER_CATALOG_DRIFT` and blocks publication.
Every Provider enabled in `config/sites.json` is mandatory for this
publication. An explicit `--provider` set may not omit an enabled Provider.

When a new provider appears:

1. Query that provider's current official OAuth documentation.
2. Determine its credential model, callback rules, scopes, PKCE/client
   assertion behavior, refresh behavior, and identity evidence.
3. Add or update its version-controlled catalog context and verification rules.
4. Add deterministic tests for discovery, preflight, and redirect verification.
5. Commit provider context and functional support together.

Apple onboarding must model Services ID/client ID, issuer/team ID, key ID,
private key custody, and short-lived ES256 client-secret JWT generation. Never
reduce it to a static `client_id/client_secret` pair.

If preflight reports missing env keys:

1. Open the Provider's official console and create or inspect the exact
   application/key only when authorized.
2. Pause only for login, CAPTCHA, or the platform's final credential-creation
   confirmation.
3. Start a separately bound env-repository task for
   `peers-touch-infra/oauth2-client-test/runtime.env`, persist the missing
   values under its local encryption and file-mode rules, commit that repository
   when authorized, then resume this publishing run.
4. Never write the sibling repository from the OAuth2 source worktree and
   never place a credential value in chat, argv, or a temporary repository
   file.

### 3. Prepare Stable Callback Configuration

For each selected provider, derive:

```text
OAUTH_BASE_URL=https://<stable-domain>
OAUTH_<PROVIDER>_REDIRECT_URI=https://<stable-domain>/api/oauth/<provider>/callback
OAUTH_ALLOWED_RETURN_TO=<approved exact destinations>
OAUTH_STORAGE_DRIVER=github
```

Open provider consoles and verify exact callback registrations. Perform browser
work directly. Pause only when login/CAPTCHA or final credential creation
confirmation cannot be automated.

### 4. Sync Vercel Environment

Dry-run first:

```bash
python3 tooling/skills/pt-oauth2-client-2-vercel/scripts/sync_vercel_env.py \
  --repo-root . \
  --env-file ../env/peers-touch-infra/oauth2-client-test/runtime.env \
  --base-url https://oauth.example.com \
  --return-to peers-touch://oauth/callback \
  --return-to http://127.0.0.1/callback \
  --environment preview \
  --environment production \
  --dry-run
```

Then apply the same reviewed inputs:

```bash
python3 tooling/skills/pt-oauth2-client-2-vercel/scripts/sync_vercel_env.py \
  --repo-root . \
  --env-file ../env/peers-touch-infra/oauth2-client-test/runtime.env \
  --base-url https://oauth.example.com \
  --return-to peers-touch://oauth/callback \
  --return-to http://127.0.0.1/callback \
  --environment preview \
  --environment production \
  --apply
```

The sync allowlist excludes `ADDR`, plaintext `OAUTH_ADMIN_PASSWORD`, and
Vercel system variables. It emits key names, environment, visibility, and
status only.

### 5. Deploy And Verify Preview

1. From the monorepo root, deploy the linked project with
   `vercel deploy --target=preview --yes`. The explicit target is mandatory
   because Vercel treats a new Project's first deployment as Production when
   no target is supplied. Do not invoke Vercel CLI from
   `apps/oauth2-client`; the Project Root Directory already selects it.
2. Capture the immutable Preview deployment URL, deployment ID, and source
   commit from structured CLI output and `vercel inspect`.
3. Point the pre-approved stable verification domain at that exact Preview.
4. Inspect the stable domain and require it to resolve to the same deployment
   ID before and after live OAuth verification.
5. Run deterministic HTTP checks:

```bash
python3 tooling/skills/pt-oauth2-client-2-vercel/scripts/verify_deployment.py \
  --repo-root . \
  --base-url https://oauth.example.com
```

6. For each selected Provider, start one run-bound verifier. It captures the
   admin baseline, verifies that the configured GitHub persistence repository
   is private, opens an ephemeral loopback receiver, emits the Provider
   authorization URL, and waits. Open that URL in the browser and complete
   consent:

```bash
python3 tooling/skills/pt-oauth2-client-2-vercel/scripts/verify_deployment.py \
  --repo-root . \
  --env-file ../env/peers-touch-infra/oauth2-client-test/runtime.env \
  --base-url https://oauth.example.com \
  --run-live-provider github \
  --timeout 600
```

   The verifier accepts only the HMAC-signed callback carrying its unique
   receiver ID and challenge, then requires that Provider's aggregate login
   count to advance. Repeat it for Google and any other selected Provider.

7. On the final Provider run, also authenticate every GitHub record envelope
   with the configured AES-256-GCM key ring:

```bash
python3 tooling/skills/pt-oauth2-client-2-vercel/scripts/verify_deployment.py \
  --repo-root . \
  --env-file ../env/peers-touch-infra/oauth2-client-test/runtime.env \
  --base-url https://oauth.example.com \
  --run-live-provider google \
  --timeout 600 \
  --verify-github-storage
```

Enable Weixin in this command only when its source config, env credentials,
reviewed callback, and catalog rules all pass.

### 6. Promote Or Deploy Production

Proceed only when Preview health, HTTP contract, every selected real callback,
and GitHub encrypted persistence pass.

- Promote the verified Preview with `vercel promote <preview-url> --yes`, or
  deploy with `vercel deploy --prod --yes` when promotion is not appropriate.
- Preview promotion creates a new Production deployment. Capture its new
  deployment ID and rerun every HTTP, live Provider, and GitHub persistence
  check against the stable Production domain.
- If any environment value changed after the candidate build, redeploy before
  promotion or Production verification.
- On failure after an alias change, restore the recorded previous deployment.

Never silently continue from a protected Preview, callback mismatch, missing
provider credential, unknown provider, failed GitHub envelope check, or memory
storage configuration.

## Failure Semantics

| Code | Meaning | Required action |
|---|---|---|
| `PROVIDER_CATALOG_DRIFT` | Source and provider context disagree | Research official docs and update catalog/tests with provider code |
| `PROVIDER_NOT_ENABLED` | A requested Provider is disabled in `config/sites.json` | Enable and review its runtime config before syncing or deploying |
| `PROVIDER_SELECTION_INCOMPLETE` | An enabled Provider was omitted from publication | Include every enabled Provider or disable it in reviewed runtime config |
| `PREFLIGHT_FAILED` | Source config or required env keys are incomplete | Return redacted env delta; do not sync |
| `VERCEL_CLI_UNAVAILABLE` | Neither the pinned standalone CLI nor `npx` is available | Install the pinned CLI, then rerun dry-run |
| `VERCEL_CLI_VERSION_UNSUPPORTED` | Standalone CLI differs from the reviewed pin | Use the pinned version or update source/reference/tests together |
| `PREVIEW_PROTECTION_BLOCKED` | Provider or health traffic cannot reach Preview | Correct protection policy; do not promote |
| `LIVE_CALLBACK_RECEIVER_MISMATCH` | Callback is not bound to this verifier's receiver ID and challenge | Reject it and restart that Provider flow |
| `LIVE_CALLBACK_SIGNATURE_INVALID` | Broker callback signature does not verify | Keep Production blocked and investigate |
| `LIVE_PROVIDER_CALLBACK_UNPROVEN` | Real consent did not produce durable identity | Keep Production blocked |
| `GITHUB_STORAGE_REPOSITORY_NOT_PRIVATE` | The configured persistence repository is public | Stop before OAuth and move storage to a private repository |
| `GITHUB_ENVELOPE_INVALID` | Repository data is absent or not the expected envelope | Keep Production blocked and investigate |
| `GO_TOOLCHAIN_UNAVAILABLE` | The local verifier cannot run the broker's canonical AES-GCM codec | Install the repository Go toolchain before persistence verification |
| `GITHUB_ENVELOPE_AUTHENTICATION_FAILED` | A stored envelope cannot be decrypted with the configured key ring | Keep Production blocked and investigate |
| `GITHUB_ENVELOPE_PLAINTEXT_SECRET` | Secret material appears in repository payload | Stop, revoke affected credentials, and escalate |

## Output

Return one redacted evidence object containing:

- repository HEAD and Vercel project/team identifiers;
- Root Directory, stable domain, Preview URL, and Production URL;
- provider discovery and catalog delta;
- env key names, Config/Secret visibility, targets, and missing-key delta;
- health, HTTP method, redirect, callback, admin, and GitHub envelope results;
- deployment IDs and whether Production was promoted or rebuilt;
- unproven providers or external steps;
- rollback action and cleanup result.

Never include environment values, authorization codes, OAuth state, tokens,
private keys, password material, ciphertext, or raw upstream bodies.

## Anti-Patterns

- Copying or sourcing `runtime.env` into repository files.
- Passing secret values with `--value`, command substitution, or `echo`.
- Publishing an unknown provider while promising to document it later.
- Treating the provider catalog as implementation truth instead of comparing it
  with source.
- Using Preview URLs as permanent provider callbacks.
- Promoting before real callback and GitHub persistence proof.
- Treating a `200` health response as OAuth acceptance.
- Using `OAUTH_STORAGE_DRIVER=memory` on Vercel.
- Running key rotation as part of ordinary deploy verification.
- Replacing the independent Go Functions with `cmd/server`.
