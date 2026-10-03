# Vercel Deployment Context

Use these sources as the deployment authority. Re-open them before changing
Vercel behavior because CLI and runtime limits change over time.

## Official Sources

- Go runtime and `api/*.go` Functions:
  https://vercel.com/docs/functions/runtimes/go
- Monorepo projects and Root Directory:
  https://vercel.com/docs/monorepos
- Environment scopes, Secret/Config visibility, and redeploy semantics:
  https://vercel.com/docs/environment-variables
- CLI environment values over stdin:
  https://vercel.com/docs/cli/env
- Function limits, `includeFiles`, and maximum duration:
  https://vercel.com/docs/functions/limitations
- `vercel.json` schema and `functions` configuration:
  https://vercel.com/docs/project-configuration/vercel-json

## Project Interpretation

- The reviewed Vercel CLI pin is `62.1.0`. Update it together with the script
  tests after re-reading the official CLI docs.
- The Vercel Project Root Directory is `apps/oauth2-client`.
- Invoke Vercel CLI from the monorepo root. Use `vercel link --repo`; do not
  combine an `apps/oauth2-client` working directory with the same configured
  Root Directory.
- Use `vercel deploy --target=preview --yes` for Preview. A new Project's first
  deployment is Production when no target is supplied.
- `go.mod` and `vercel.json` are therefore project-root files for Vercel.
- `api/**/index.go` files remain the deployed Functions. `cmd/server` is only
  the local server entrypoint.
- `config/sites.json` must be included in every Go Function bundle.
- Environment changes affect only new deployments. Re-run Preview deployment
  after every sync.
- Preview protection must not intercept provider redirects or health checks on
  the verification domain.
- Use one stable HTTPS verification domain for callback registration. Do not
  register ephemeral Preview deployment URLs as provider callbacks.
- Sync the same approved values to Preview and Production before building the
  Preview candidate that may later be promoted.
- Promoting a Preview creates a new Production deployment. Capture that new
  deployment ID and rerun every production check; never describe it as the
  already-verified Preview artifact.
