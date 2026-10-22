# Module 5: Provider and Model Acceptance

> Architecture: `peers-design.md`
> Updated: 2026-10-18

## 1. Provider List

### AC-1.1 Mixed list

Given Direct and CLI providers exist, Provider Settings renders one list with no
persistent type tabs. Each row shows identity, type, and enabled state.

### AC-1.2 Usable filter

`Show usable only` defaults on, persists, and includes only Providers whose
shared readiness projection is `ready`.

### AC-1.3 Scroll ownership

At wide and narrow Settings sizes:

- Provider list owns one vertical scroll container.
- The scrollbar is the shared thin 6px treatment.
- The Settings section host does not create a second Provider scrollbar.
- No horizontal overflow exists.

## 2. Direct Provider

### AC-2.1 Configuration

API key and Base URL save through Station and survive Provider reselection.
Check reports authoritative success or failure.

### AC-2.2 Custom model CRUD

Add, edit, enable/disable, and remove remain available for Direct models. Each
successful mutation refreshes Provider detail and Agent available models.

### AC-2.3 No bulk mutation

Direct Provider detail exposes no Enable All or Disable All operation.

## 3. CLI Provider

### AC-3.1 Dedicated schema

Selecting a CLI Provider mounts `CliProviderDetail` only. API key, Base URL,
custom model Add/Edit/Delete, model switches, and bulk actions are absent.

### AC-3.2 Capability-driven fields

Default model is shown. Startup args, environment, timeout, and Refresh appear
only when their corresponding Station capability is true.

Registered command, workspace policy, and runtime capability facts are read-only.

### AC-3.3 Save and restore

Save submits one complete `ProviderRuntimeConfig`. Restore Defaults resets the
local form to `default_runtime_config`; Save persists it. Invalid environment
syntax is rejected locally, and invalid/secret runtime config is rejected by
Station.

### AC-3.4 Enable persistence

Disabling and re-enabling a CLI Provider preserves default model, startup args,
environment, and timeout.

### AC-3.5 Check

Check is executed by Station against the registered binary. Missing binaries
return unavailable/install guidance without any Desktop subprocess.

## 4. CLI Model Discovery

### AC-4.1 Real TRAE catalog

For a Station host with `traecli 0.200.19`, Refresh executes
`traecli debug models` and returns the supported visible models, including:

- slug/display name;
- description;
- context window;
- input/runtime capabilities;
- default and supported reasoning levels.

### AC-4.2 Shared catalog

After successful discovery, the same actor-scoped catalog is visible in:

- CLI Provider detail;
- Agent available models;
- composer selection;
- runtime admission.

### AC-4.3 Failure preservation

Timeout, invalid output, unsupported output, or process failure does not replace
the prior valid catalog.

### AC-4.4 Actor isolation

Actor A and Actor B may discover different model catalogs for the same Provider.
One actor's refresh must not affect the other actor's Provider detail or runtime
admission.

## 5. Composite Model Identity

### AC-5.1 Duplicate IDs

Given `codex-cli/default` and `trae-cli/default` both exist:

- choosing TRAE selects `trae-cli/default`;
- the selected check appears only on the TRAE row;
- Model Service saves both Provider and model;
- Agent default/fallback remains on the configured pair;
- Cron override resolves the configured pair.

No consumer selects the first `default` by list order.

### AC-5.2 Legacy bare ID

A legacy bare model ID resolves only if exactly one available model matches.
Ambiguous bare IDs fall back to the configured composite default.

## 6. Security and Process Lifecycle

- Registered argv is executed without shell parsing.
- Discovery output is bounded.
- Discovery and execution timeouts terminate the process group.
- Environment cannot override Station-owned keys or carry secret-like keys.
- Model metadata cannot leak base instructions or other unapproved CLI fields.

## 7. Required Evidence

- Station Agent package tests.
- Desktop full unit/contract suite and TypeScript check.
- Generated Go/Desktop/Mobile TypeScript contracts are current.
- `git diff --check`.
- Exact-source Native Settings screenshots at wide and narrow widths.
- Native Check, Save/Restore, Refresh, disable/re-enable, duplicate-model
  selection, and one real TRAE Agent turn.

Static tests and direct CLI output prove contract behavior only. They do not
upgrade Native product behavior to proven.
