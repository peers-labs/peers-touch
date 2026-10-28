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

When X Config operator login is enabled, the same private env file may
also provide the allowlisted `OAUTH_OPERATOR_LOGIN_*` site, audience, callback,
key ID, signing key, and redeem-secret values. The signing key and redeem
secret are synchronized as Secret values; they are never printed or passed in
argv.

Additional operator consoles beyond the generic single-site block use
site-scoped variables `OAUTH_OPERATOR_LOGIN_<SITE>_{AUDIENCE,CALLBACK_URL,
SIGNING_KEY_ID,SIGNING_PRIVATE_KEY_B64,REDEEM_SECRET_B64,ALLOW_PRIVATE_HTTP}`,
where `<SITE>` is the upper-snake-cased site ID. The site must also be present
in `apps/oauth2-client/config/sites.json`. Site-scoped secrets are passed to
Vercel through stdin with the same visibility rules; the standard sync script's
single-site value model does not cover them.

Operator callbacks must be HTTPS with no fragment. Plain HTTP is accepted only
when the site sets `allow_private_http`/`..._ALLOW_PRIVATE_HTTP=1` and the
callback host is an IP literal on loopback, RFC1918 private, or link-local
IPv4 (IPv6 accepts loopback only); DNS names, public IPs, credentials, query,
and fragment remain forbidden. Private-HTTP callbacks carry only a one-time
handoff challenge; the signed assertion is exchanged server-to-server over
the redeem channel and integrity never depends on the browser transport.

### 5. Deploy And Verify Preview

1. From clean source, prepare a temporary upload artifact outside Git:

   ```bash
   python3 tooling/skills/pt-oauth2-client-2-vercel/scripts/prepare_artifact.py \
     --repo-root . \
     --output-dir /tmp/peers-oauth-vercel-artifact
   ```

   The artifact keeps `apps/oauth2-client` at the reviewed Root Directory,
   copies the neutral `packages/github-repository` module under that app for
   direct CLI upload, and rewrites only the artifact-local Go `replace`.
   Repository source remains the single owner.
2. Deploy that artifact with the OAuth local configuration and explicit
   Preview target:

   ```bash
   vercel -A apps/oauth2-client/vercel.json deploy \
     /tmp/peers-oauth-vercel-artifact \
     --project peers-touch-oauth \
     --target=preview \
     --yes
   ```

   The explicit target is mandatory because Vercel treats a new Project's
   first deployment as Production when no target is supplied. Do not invoke
   Vercel CLI from `apps/oauth2-client`; its configured Root Directory would be
   applied twice.
3. Capture the immutable Preview deployment URL, deployment ID, and source
   commit from structured CLI output and `vercel inspect`.
4. Point the pre-approved stable verification domain at that exact Preview.
5. Inspect the stable domain and require it to resolve to the same deployment
   ID before and after live OAuth verification.
6. Run deterministic HTTP checks. When the candidate is an ephemeral Preview but
   Provider callbacks are registered against the stable Production domain,
   pass that domain with `--stable-base-url` so the redirect `redirect_uri` is
   compared against the registered origin instead of the Preview host:

```bash
python3 tooling/skills/pt-oauth2-client-2-vercel/scripts/verify_deployment.py \
  --repo-root . \
  --env-file ../env/peers-touch-infra/oauth2-client-test/runtime.env \
  --base-url https://oauth-preview.example.com \
  --stable-base-url https://oauth.example.com \
  --timeout 30
```

   The `--env-file` is mandatory once operator login is enabled for the site
   (see "Operator-Locked Start" below). The verifier proves:

   - **Health contract** — `GET /api/healthz` is HTTP 200 with the exact JSON
     object `{"status":"ok","version":"<major.minor.patch>"}`. The body must
     contain exactly those two keys, `status` must equal `ok`, and `version`
     must match `^\d+\.\d+\.\d+$` (mirrors the Go handler's `semverRegexp`).
     A bare 200 or `{"status":"ok"}` is a contract failure.
   - **GET-only method contract** — every health, admin, start, and callback
     route rejects POST with HTTP 405 and `Allow: GET`.
   - **Ambiguous callback rejection** — a callback carrying both `code` and
     `error` returns HTTP 400 `invalid_callback_result`.
   - **Provider start redirects** — each start returns a 3xx to the catalog
     authorization host over HTTPS with a nonempty `state`, the registered
     stable callback as `redirect_uri`, and PKCE S256 parameters when the
     catalog requires them.

7. **Operator-Locked Start.** When the env binds
   `OAUTH_OPERATOR_LOGIN_SITE_ID` to the requested `--site-id`, the deployed
   site is operator-locked and consumer self-service login is disabled. The
   verifier resolves the bound operator admin callback from
   `OAUTH_OPERATOR_LOGIN_CALLBACK_URL` and asserts both sides of the contract:

   - a bare `…/start?site_id=<id>` without a bound `return_to` is rejected
     with HTTP 400 `operator_handoff_binding_mismatch` before any session is
     persisted;
   - a bound start whose `return_to` matches the operator callback
     scheme/host/path exactly, carries an empty fragment, and includes exactly
     `receiver_challenge` (32 decoded bytes) and a
     `^[A-Za-z0-9_-]{16,128}$` `login_attempt_id` succeeds with the Provider
     302. The report records `startEntry: "operator-handoff"`; a direct site
     reports `"direct"`.

   The operator callback must be HTTPS with no fragment, or a flag-enabled
   private-IP HTTP callback under the exact gating rules in §4. Missing
   operator env keys block with `OPERATOR_LOGIN_CONFIG_INCOMPLETE`; a
   malformed callback blocks with `OPERATOR_LOGIN_CALLBACK_URL_INVALID`.

8. For each selected Provider on a direct (non-operator-locked) site, start
   one run-bound verifier. It captures the
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

   `--run-live-provider` models the consumer self-service flow and therefore
   does not apply to an operator-locked site; combining them fails closed with
   `OPERATOR_LOGIN_LIVE_PROVIDER_UNSUPPORTED`. Operator login is proven through
   its own admin/operator handoff and signed-assertion journey, not this
   loopback receiver.

9. On the final Provider run, or standalone against any candidate, also
   authenticate every GitHub record envelope with the configured AES-256-GCM
   key ring:

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

`--verify-github-storage` is independent of consumer consent and can run
standalone, which is the required persistence proof for an operator-locked
candidate where `--run-live-provider` is rejected:

```bash
python3 tooling/skills/pt-oauth2-client-2-vercel/scripts/verify_deployment.py \
  --repo-root . \
  --env-file ../env/peers-touch-infra/oauth2-client-test/runtime.env \
  --base-url https://oauth-preview.example.com \
  --stable-base-url https://oauth.example.com \
  --verify-github-storage \
  --timeout 30
```

### 6. Promote Or Deploy Production

Proceed only when Preview health, HTTP contract, the applicable login proof
(real consumer Provider callbacks on a direct site, or the operator handoff and
signed-assertion journey on an operator-locked site), and GitHub encrypted
persistence pass.

- Promote the verified Preview with `vercel promote <preview-url> --yes`, or
  deploy with `vercel deploy --prod --yes` when promotion is not appropriate.
- Preview promotion creates a new Production deployment. Capture its new
  deployment ID and rerun every HTTP, the applicable login proof, and GitHub
  persistence check against the stable Production domain.
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
| `HEALTH_CONTRACT_FAILED` | `/api/healthz` is not 200 with exactly `{"status":"ok","version":"<semver>"}` | Treat as a broken or wrong build; do not promote on a bare 200 |
| `HTTP_METHOD_CONTRACT_FAILED` | A GET-only route accepted POST or returned the wrong `Allow` | Fix the Function method handling before promotion |
| `CALLBACK_CONTRACT_FAILED` | An ambiguous Provider callback was not rejected with `invalid_callback_result` | Keep Production blocked and investigate |
| `PROVIDER_START_CONTRACT_FAILED` | Start redirect host, scheme, state, or registered `redirect_uri` is wrong | Reconcile stable callback config and catalog; redeploy |
| `PROVIDER_PKCE_CONTRACT_FAILED` | A catalog S256 Provider start omitted the PKCE challenge/method | Fix Provider start construction; do not promote |
| `OPERATOR_LOGIN_CONFIG_INCOMPLETE` | An operator-locked site is missing operator callback/audience/key/redeem env | Complete the allowlisted operator env through the env-repository task |
| `OPERATOR_LOGIN_CALLBACK_URL_INVALID` | The operator callback is not HTTPS, or is plain HTTP outside the flag-enabled private-IP-literal gate, or carries a fragment/query/credentials | Correct the callback and its `ALLOW_PRIVATE_HTTP` gating, then resync |
| `OPERATOR_START_BINDING_FAILED` | A bare start was accepted or a bound start was rejected unexpectedly | Investigate operator-lock enforcement; keep Production blocked |
| `OPERATOR_LOGIN_LIVE_PROVIDER_UNSUPPORTED` | Consumer `--run-live-provider` was requested on an operator-locked site | Prove operator login through its own handoff/assertion journey instead |
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
- start entry (`direct` vs `operator-handoff`) and the registered callback base
  the Provider `redirect_uri` was asserted against;
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
- Asserting the Provider `redirect_uri` against the ephemeral Preview host
  instead of the registered stable domain (omit `--stable-base-url`).
- Running the consumer `--run-live-provider` flow against an operator-locked
  site, or accepting a bare operator start that should be binding-rejected.
- Promoting before real callback and GitHub persistence proof.
- Treating a `200` health response as OAuth acceptance.
- Using `OAUTH_STORAGE_DRIVER=memory` on Vercel.
- Running key rotation as part of ordinary deploy verification.
- Replacing the independent Go Functions with `cmd/server`.
