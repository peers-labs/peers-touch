from __future__ import annotations

from .node_connectivity_postgres import (
    NodeConnectivityPostgresProcessProvisioner,
)


class NodeConnectivityAgentFencingProvisioner(
    NodeConnectivityPostgresProcessProvisioner
):
    environment_id = "node-connectivity-agent-fencing"
    gate_id = "NCP-G06-AGENT"
    service_id = "agent-postgres"
    client_ids = ("agent-node-a", "agent-node-b")
    attestation_producer = (
        "node-connectivity-agent-fencing-provisioner"
    )
    failure_label = "Agent Fencing"
