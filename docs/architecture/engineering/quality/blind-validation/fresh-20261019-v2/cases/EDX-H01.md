# EDX-H01: Attach A Connected Connector To An Agent

## Starting Context

The Desktop user is editing an Agent. One Connector account is connected.
Resource discovery may return zero or several current tool manifests, and the
Agent may have zero or several current bindings.

## User Goal

Understand whether the connected service is usable by this Agent and attach its
available tools when possible.

## Required Sources

- `apps/desktop/src/components/agent/AgentConnectorsPanel.tsx:76-143`
- `apps/desktop/src/components/agent/AgentConnectorsPanel.tsx:146-260`
- `apps/desktop/src/components/agent/AgentConnectorsPanel.tsx:264-310`
- `apps/desktop/src/components/agent/AgentConnectorsPanel.tsx:326-400`
- `docs/architecture/domains/agent/modern-chat-agent/experience-contract.md:210-220`
- `docs/architecture/domains/agent/modern-chat-agent/experience-contract.md:245-253`
- `docs/architecture/domains/agent/modern-chat-agent/decisions.md:947-979`
- `docs/client/common/ui-identity/interaction.md:25-43`
- `docs/client/common/ui-identity/interaction.md:55-74`

## States To Walk

- disconnected Connector;
- connection pending, failed, expired or revoked;
- connected Connector with no current resource tool manifest;
- connected Connector with current manifests and no Agent binding;
- bound Connector with ready, degraded, unavailable or unknown readiness;
- bind or unbind mutation failure.

## Review Boundary

Review only the visible connection, resource, binding and readiness meaning in
the Agent Connector panel. OAuth credentials, provider-specific metadata and
ToolCall execution are outside this case.

Return the JSON ReviewResult required by `rubric.md`.
