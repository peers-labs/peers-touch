from __future__ import annotations

from .node_connectivity_postgres import (
    NodeConnectivityPostgresProcessProvisioner,
)


class NodeConnectivitySharedAccessProvisioner(
    NodeConnectivityPostgresProcessProvisioner
):
    environment_id = "node-connectivity-shared-access"
    gate_id = "NCP-G05"
    service_id = "access-postgres"
    client_ids = ("access-node-a", "access-node-b")
    attestation_producer = (
        "node-connectivity-shared-access-provisioner"
    )
    failure_label = "Shared Access"
