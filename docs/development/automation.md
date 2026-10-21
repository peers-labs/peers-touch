# Development Automation

> **Status**: active
> **Audience**: human developers and development agents
> **Owner**: Developer Infrastructure

Humans and agents use the same development knowledge, commands, architecture,
and evidence rules. Automation may execute or surface those rules; it may not
define a parallel project.

## Command Layers

1. **Make** is the normal macOS/Linux command index.
2. **`tooling/dev.ps1`** is the Windows-native adapter.
3. **`tooling/devctl/`** owns cross-platform Profile, diagnostic, Station, and
   Desktop lifecycle behavior.
4. **Specialist scripts** own only the capability named by their directory and
   must not become an alternative project-wide entrypoint.

Run `make help` or `tooling/dev.ps1 help` to discover current commands.

## Agent Layers

- [AGENTS.md](../../AGENTS.md) defines agent behavior, safety, scope, and Skill
  routing.
- `tooling/skills/` contains project-owned executable procedures.
- Optional IDE Hooks provide relevant context and diagnostics.
- Host adapters translate TRAE, Cursor, Codex, or another host into the same
  repository operations.

Agent layers consume:

- this shared Dev knowledge base;
- product and architecture sources;
- platform and coding standards;
- path-owned operational knowledge.

They do not create product truth, runtime permission, verification success, or
delivery authorization.

## Install Agent Integration

Humans using an AI development host may install project Skills and the optional
advisory Hook:

```bash
make skills IDE=trae
make skills IDE=cursor
make skills IDE=codex
```

Audit the selected host with:

```bash
make agent-integration-audit IDE=<host>
```

A missing Hook means automatic context is unavailable. It does not block
ordinary development; the agent must read the same sources directly.

## CI

CI reruns deterministic checks and selected evidence on a clean host. It does
not replace local functional verification, and local PASS files do not replace
CI or formal Acceptance.

Workflow files under `.github/workflows/` are consumers of repository command
contracts. They must call the same canonical owners instead of reimplementing
Profile, build, verification, or release semantics.

## Ownership Rule

When automation and documentation disagree:

1. Verify current source behavior.
2. Identify the governing product, architecture, or platform source.
3. Correct the command implementation and its public guide in the same change.
4. Remove the stale path rather than adding a compatibility alias.
